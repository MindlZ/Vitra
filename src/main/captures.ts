import { app, nativeImage } from 'electron'
import { createHash } from 'crypto'
import { createReadStream, promises as fs, type Dirent } from 'fs'
import { Readable } from 'stream'
import { basename, extname, join } from 'path'
import { findSteamPath, readRegistryValue } from './paths'
import { getGame, getGames, getSettings } from './store'
import type { Capture, Game } from '../shared/types'

// served by opaque id, and only ids a listing handed out, so the renderer can't name a path

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif'])
// Game Bar's HDR .jxr stills always have a .png twin
const VIDEO_EXT = new Set(['.mp4', '.m4v', '.webm'])

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm'
}

const MAX_PER_GAME = 400

interface Known {
  path: string
  // Steam's own thumbnail
  thumb?: string
}

const known = new Map<string, Known>()

function idFor(path: string): string {
  return createHash('sha1').update(path.toLowerCase()).digest('hex').slice(0, 20)
}

function kindOf(file: string): Capture['kind'] | undefined {
  const ext = extname(file).toLowerCase()
  if (IMAGE_EXT.has(ext)) return 'image'
  if (VIDEO_EXT.has(ext)) return 'video'
  return undefined
}

async function readdirSafe(dir: string): Promise<Dirent[]> {
  try {
    return await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
}

// letters + digits only: also eats ®/™ and zero-width chars in window titles
function normalise(text: string): string {
  return text.normalize('NFKD').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
}

function keysOf(game: Game): Set<string> {
  const keys = new Set<string>([normalise(game.name)])
  const exes = [...(game.processHints ?? []), ...(game.exePath ? [basename(game.exePath)] : [])]
  for (const exe of exes) keys.add(normalise(exe.replace(/\.(exe|lnk|bat|cmd)$/i, '')))
  for (const key of keys) if (key.length < 3) keys.delete(key)
  return keys
}

function preferred(games: Game[]): Game | undefined {
  return [...games].sort(
    (a, b) => Number(b.installed) - Number(a.installed) || (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0)
  )[0]
}

// exact name/exe, else a start/end match of >= 8 chars that fits exactly one game.
// wrong screenshots on a page are worse than none
function resolveTitle(title: string, games: Game[]): Game | undefined {
  const key = normalise(title)
  if (key.length < 3) return undefined

  const exact = games.filter((game) => keysOf(game).has(key))
  if (exact.length) return preferred(exact)

  if (key.length < 8) return undefined
  const loose = games.filter((game) => {
    const name = normalise(game.name)
    if (name.length < 8) return false
    return name.startsWith(key) || name.endsWith(key) || key.startsWith(name) || key.endsWith(name)
  })
  const names = new Set(loose.map((game) => normalise(game.name)))
  return names.size === 1 ? preferred(loose) : undefined
}

let capturesDirCache: Promise<string> | undefined

// a moved Captures folder shows up as the AppCaptures known folder. cached: spawns reg
function capturesDir(): Promise<string> {
  capturesDirCache ??= readRegistryValue(
    'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders',
    '{EDC0FE71-98D8-4F4A-B920-C8DC133CB165}'
  ).then((moved) =>
    moved
      ? moved.replace(/%([^%]+)%/g, (whole, name: string) => process.env[name] ?? whole)
      : join(app.getPath('videos'), 'Captures')
  )
  return capturesDirCache
}

function steamIds(game: Game): string[] {
  if (game.steamAppId) return [game.steamAppId]
  const shortcut = game.id.match(/^steam:shortcut-(\d+)$/)
  if (!shortcut) return []
  // shortcuts can be filed under the 32-bit app id or the derived 64-bit game id
  const gameId = (BigInt(shortcut[1]) << 32n) | 0x02000000n
  return [shortcut[1], gameId.toString()]
}

interface Found {
  path: string
  thumb?: string
  source: Capture['source']
}

async function steamCaptures(game: Game): Promise<Found[]> {
  const ids = steamIds(game)
  if (!ids.length) return []
  const steamPath = await findSteamPath(getSettings().steamPath)
  if (!steamPath) return []

  const found: Found[] = []
  const userdata = join(steamPath, 'userdata')
  for (const account of await readdirSafe(userdata)) {
    if (!account.isDirectory() || !/^\d+$/.test(account.name)) continue
    for (const id of ids) {
      const dir = join(userdata, account.name, '760', 'remote', id, 'screenshots')
      for (const entry of await readdirSafe(dir)) {
        if (!entry.isFile() || !kindOf(entry.name)) continue
        found.push({
          path: join(dir, entry.name),
          thumb: join(dir, 'thumbnails', entry.name),
          source: 'steam'
        })
      }
    }
  }
  return found
}

// Game Bar: "<window title> <date> <time>", in the locale's date format
const STAMP =
  /\s+\d{1,4}[-_.]\d{1,2}[-_.]\d{1,4}\s+\d{1,2}[-_.]\d{1,2}[-_.]\d{1,2}(?:\s*[ap]m)?$/i

function gameBarTitle(file: string): string | undefined {
  const stem = file.slice(0, file.length - extname(file).length).replace(/\s*\(\d+\)$/, '')
  return STAMP.test(stem) ? stem.replace(STAMP, '') : undefined
}

async function gameBarCaptures(game: Game, games: Game[]): Promise<Found[]> {
  const dir = await capturesDir()
  const found: Found[] = []
  const verdicts = new Map<string, boolean>()
  for (const entry of await readdirSafe(dir)) {
    if (!entry.isFile() || !kindOf(entry.name)) continue
    const title = gameBarTitle(entry.name)
    if (!title) continue
    let mine = verdicts.get(title)
    if (mine === undefined) {
      mine = resolveTitle(title, games)?.id === game.id
      verdicts.set(title, mine)
    }
    if (mine) found.push({ path: join(dir, entry.name), source: 'gamebar' })
  }
  return found
}

async function folderCaptures(game: Game, games: Game[]): Promise<Found[]> {
  const videos = app.getPath('videos')
  const captures = await capturesDir()
  const roots = [videos, join(videos, 'NVIDIA'), captures]

  const found: Found[] = []
  for (const root of roots) {
    for (const entry of await readdirSafe(root)) {
      if (!entry.isDirectory()) continue
      const dir = join(root, entry.name)
      if (dir.toLowerCase() === captures.toLowerCase()) continue
      if (resolveTitle(entry.name, games)?.id !== game.id) continue
      for (const file of await readdirSafe(dir)) {
        if (file.isFile() && kindOf(file.name)) found.push({ path: join(dir, file.name), source: 'folder' })
      }
    }
  }
  return found
}

export async function listCaptures(gameId: string): Promise<Capture[]> {
  const game = getGame(gameId)
  if (!game) return []
  const games = getGames()

  const found = (
    await Promise.all([steamCaptures(game), gameBarCaptures(game, games), folderCaptures(game, games)])
  ).flat()

  const seen = new Set<string>()
  const captures: Capture[] = []
  await Promise.all(
    found.map(async (item) => {
      const id = idFor(item.path)
      if (seen.has(id)) return
      seen.add(id)
      try {
        const stat = await fs.stat(item.path)
        if (!stat.isFile() || stat.size === 0) return
        known.set(id, { path: item.path, thumb: item.thumb })
        captures.push({
          id,
          kind: kindOf(item.path)!,
          source: item.source,
          takenAt: stat.mtimeMs,
          name: basename(item.path)
        })
      } catch {
        // deleted since the readdir
      }
    })
  )

  return captures.sort((a, b) => b.takenAt - a.takenAt).slice(0, MAX_PER_GAME)
}

export function capturePath(id: string): string | undefined {
  return known.get(id)?.path
}

function thumbDir(): string {
  return join(app.getPath('userData'), 'capture-thumbs')
}

const THUMB_SIZE = { width: 480, height: 270 }
const MAX_THUMB_JOBS = 3
let thumbJobs = 0
const thumbQueue: (() => void)[] = []
const thumbInFlight = new Map<string, Promise<string | undefined>>()

function nextThumbJob(): void {
  while (thumbJobs < MAX_THUMB_JOBS && thumbQueue.length) {
    thumbJobs++
    thumbQueue.shift()!()
  }
}

// Windows' thumbnailer does video frames too
async function thumbnailFor(id: string, entry: Known): Promise<string | undefined> {
  if (entry.thumb) {
    try {
      await fs.access(entry.thumb)
      return entry.thumb
    } catch {
      // no Steam thumb, make one
    }
  }

  const stat = await fs.stat(entry.path)
  const file = join(thumbDir(), `${id}-${Math.round(stat.mtimeMs)}-${stat.size}.jpg`)
  try {
    await fs.access(file)
    return file
  } catch {
    // not cached yet
  }

  let job = thumbInFlight.get(file)
  if (!job) {
    job = new Promise<string | undefined>((resolve) => {
      thumbQueue.push(() => {
        nativeImage
          .createThumbnailFromPath(entry.path, THUMB_SIZE)
          .then(async (image) => {
            if (image.isEmpty()) return undefined
            await fs.mkdir(thumbDir(), { recursive: true })
            await fs.writeFile(file, image.toJPEG(82))
            return file
          })
          .catch(() => undefined)
          .then(resolve)
          .finally(() => {
            thumbJobs--
            thumbInFlight.delete(file)
            nextThumbJob()
          })
      })
      nextThumbJob()
    })
    thumbInFlight.set(file, job)
  }
  return job
}

// honours Range so clips can seek
async function serveFile(path: string, request: Request): Promise<Response> {
  const { size } = await fs.stat(path)
  const headers: Record<string, string> = {
    'content-type': MIME[extname(path).toLowerCase()] ?? 'application/octet-stream',
    'accept-ranges': 'bytes',
    'cache-control': 'no-cache'
  }
  const body = (start: number, end: number): ReadableStream<Uint8Array> =>
    Readable.toWeb(createReadStream(path, { start, end })) as unknown as ReadableStream<Uint8Array>

  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('range')?.trim() ?? '')
  if (range && (range[1] || range[2])) {
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]))
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1
    if (start > end || start >= size) {
      return new Response(null, { status: 416, headers: { 'content-range': `bytes */${size}` } })
    }
    return new Response(body(start, end), {
      status: 206,
      headers: {
        ...headers,
        'content-length': String(end - start + 1),
        'content-range': `bytes ${start}-${end}/${size}`
      }
    })
  }

  if (size === 0) return new Response(null, { headers })
  return new Response(body(0, size - 1), { headers: { ...headers, 'content-length': String(size) } })
}

// applib://capture/<id>[/thumb]
export async function serveCapture(request: Request): Promise<Response> {
  const [id, variant] = new URL(request.url).pathname.replace(/^\/+/, '').split('/')
  const entry = known.get(id)
  if (!entry) return new Response('Not found', { status: 404 })

  if (variant === 'thumb') {
    const thumb = await thumbnailFor(id, entry)
    if (thumb) return serveFile(thumb, request)
    if (kindOf(entry.path) !== 'image') return new Response('Not found', { status: 404 })
  }
  return serveFile(entry.path, request)
}
