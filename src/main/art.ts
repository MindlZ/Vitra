import { app } from 'electron'
import { promises as fs } from 'fs'
import { extname, join } from 'path'
import { artDir, getGame, getSettings, patchGame } from './store'
import { steamArtCandidates } from './scanners/steam'
import { findLocalGridArt } from './scanners/steamGrid'
import { steamGridDbCandidates } from './scanners/steamGridDb'
import { cachedAppInfo } from './scanners/steamStore'
import { xboxLocalArt } from './scanners/xbox'
import type { Game } from '../shared/types'

export type ArtKind = 'cover' | 'hero' | 'logo'

const FILE_KEY: Record<ArtKind, 'coverFile' | 'heroFile' | 'logoFile'> = {
  cover: 'coverFile',
  hero: 'heroFile',
  logo: 'logoFile'
}
const URL_KEY: Record<ArtKind, 'coverUrl' | 'heroUrl' | 'logoUrl'> = {
  cover: 'coverUrl',
  hero: 'heroUrl',
  logo: 'logoUrl'
}

/**
 * Where a piece of art can come from, in the order we try them.
 * `file` and `icon` are local and always beat the network.
 */
type Source =
  | { kind: 'file'; path: string; letterbox?: boolean }
  | { kind: 'url'; url: string }
  | { kind: 'icon'; exePath: string }

/** Art we've already failed to find, so we don't re-request it every render. */
const misses = new Set<string>()
/** In-flight resolutions, so twenty cards asking at once make one request. */
const inFlight = new Map<string, Promise<string | undefined>>()

function safeName(id: string): string {
  return id.replace(/[^a-z0-9._-]/gi, '_')
}

async function exists(path: string): Promise<boolean> {
  try {
    await fs.access(path)
    return true
  } catch {
    return false
  }
}

/**
 * The full ladder, best first:
 *   1. art the user customised inside Steam (covers non-Steam shortcuts too)
 *   2. Steam's CDN, across every capsule size
 *   3. the canonical URLs from the store API, if we already cached them
 *   4. whatever the scanner attached (Epic's and GOG's own box art), and for
 *      heroes, an Xbox package's splash screen
 *   5. SteamGridDB, when a key is configured
 *   6. an Xbox package's square tile, letterboxed
 *   7. the executable's own icon, so nothing local is ever art-less
 */
async function sourcesFor(game: Game, kind: ArtKind): Promise<Source[]> {
  const sources: Source[] = []
  const settings = getSettings()

  const localGridId = game.steamAppId ?? game.id.match(/^steam:shortcut-(\d+)$/)?.[1]
  if (localGridId) {
    const local = await findLocalGridArt(localGridId, kind, settings.steamPath)
    if (local) sources.push({ kind: 'file', path: local })
  }

  if (game.steamAppId) {
    for (const url of steamArtCandidates(game.steamAppId, kind)) sources.push({ kind: 'url', url })

    if (kind === 'cover') {
      const info = await cachedAppInfo(game.steamAppId)
      for (const url of [info?.capsuleImage, info?.headerImage]) {
        if (url) sources.push({ kind: 'url', url })
      }
    }
  }

  const attached = game[URL_KEY[kind]]
  if (attached && !sources.some((s) => s.kind === 'url' && s.url === attached)) {
    sources.push({ kind: 'url', url: attached })
  }

  // Xbox packages carry their own art. The splash screen is a proper hero, so
  // it goes ahead of the network; the square tile is only a fallback cover.
  const xboxArt =
    game.source === 'xbox' && game.installDir ? await xboxLocalArt(game.installDir, kind) : undefined
  if (xboxArt && kind === 'hero') sources.push({ kind: 'file', path: xboxArt })

  for (const url of await steamGridDbCandidates(kind, game)) sources.push({ kind: 'url', url })

  if (xboxArt && kind === 'cover') sources.push({ kind: 'file', path: xboxArt, letterbox: true })

  // An icon is a poor cover but an honest one, and it needs no network.
  if (kind === 'cover' && game.exePath && (await exists(game.exePath))) {
    sources.push({ kind: 'icon', exePath: game.exePath })
  }

  return sources
}

async function download(url: string, dest: string): Promise<boolean> {
  try {
    const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(15_000) })
    if (!response.ok) return false
    if (!(response.headers.get('content-type') ?? '').startsWith('image/')) return false

    const buffer = Buffer.from(await response.arrayBuffer())
    // Steam serves a tiny placeholder for missing art; treat those as a miss.
    if (buffer.byteLength < 1024) return false
    await fs.writeFile(dest, buffer)
    return true
  } catch {
    return false
  }
}

async function copyLocal(source: string, dest: string): Promise<boolean> {
  try {
    await fs.copyFile(source, dest)
    return true
  } catch {
    return false
  }
}

/** Windows gives us the embedded icon at up to 256px, which is enough here. */
async function extractIcon(exePath: string, dest: string): Promise<boolean> {
  try {
    const icon = await app.getFileIcon(exePath, { size: 'large' })
    if (icon.isEmpty()) return false
    const png = icon.toPNG()
    if (png.byteLength < 512) return false
    await fs.writeFile(dest, png)
    return true
  } catch {
    return false
  }
}

function extensionFor(source: Source): string {
  // Marked so the renderer can letterbox it: an exe icon is square, and
  // cropping it to a 2:3 card would cut the artwork in half.
  if (source.kind === 'icon') return '.icon.png'
  if (source.kind === 'file') {
    const ext = extname(source.path).toLowerCase() || '.png'
    return source.letterbox ? `.icon${ext}` : ext
  }
  // GOG serves webp; naming it .jpg would send the wrong content-type.
  const ext = source.url.match(/\.(png|webp)(\?|$)/i)?.[1]?.toLowerCase()
  return ext ? `.${ext}` : '.jpg'
}

async function resolve(gameId: string, kind: ArtKind): Promise<string | undefined> {
  const game = getGame(gameId)
  if (!game) return undefined

  await fs.mkdir(artDir(), { recursive: true })

  for (const source of await sourcesFor(game, kind)) {
    const filename = `${safeName(gameId)}-${kind}${extensionFor(source)}`
    const dest = join(artDir(), filename)

    const ok =
      source.kind === 'url'
        ? await download(source.url, dest)
        : source.kind === 'file'
          ? await copyLocal(source.path, dest)
          : await extractIcon(source.exePath, dest)

    if (ok) {
      patchGame(gameId, { [FILE_KEY[kind]]: filename })
      return filename
    }
  }

  return undefined
}

/**
 * Resolve one piece of art to a file inside the art cache, fetching it on first
 * use. Returns the bare filename (served over the applib:// protocol).
 */
export async function ensureArt(gameId: string, kind: ArtKind): Promise<string | undefined> {
  const game = getGame(gameId)
  if (!game) return undefined

  const cached = game[FILE_KEY[kind]]
  if (cached && (await exists(join(artDir(), cached)))) return cached

  const key = `${gameId}:${kind}`
  if (misses.has(key)) return undefined

  const existing = inFlight.get(key)
  if (existing) return existing

  const task = resolve(gameId, kind)
    .then((filename) => {
      if (!filename) misses.add(key)
      return filename
    })
    .finally(() => inFlight.delete(key))

  inFlight.set(key, task)
  return task
}

/** Copy an image the user picked into the art cache and attach it to the game. */
export async function setLocalArt(
  gameId: string,
  kind: ArtKind,
  sourcePath: string
): Promise<string | undefined> {
  if (!getGame(gameId)) return undefined
  const ext = extname(sourcePath).toLowerCase() || '.jpg'
  // Vary the name so the renderer's <img> cache doesn't keep the old picture.
  const filename = `${safeName(gameId)}-${kind}-${Date.now()}${ext}`
  await fs.mkdir(artDir(), { recursive: true })
  await fs.copyFile(sourcePath, join(artDir(), filename))

  const previous = getGame(gameId)?.[FILE_KEY[kind]]
  patchGame(gameId, { [FILE_KEY[kind]]: filename })
  misses.delete(`${gameId}:${kind}`)

  if (previous && previous !== filename) {
    await fs.rm(join(artDir(), previous), { force: true })
  }
  return filename
}

export async function clearArt(gameId: string, kind: ArtKind): Promise<void> {
  const file = getGame(gameId)?.[FILE_KEY[kind]]
  if (file) await fs.rm(join(artDir(), file), { force: true })
  patchGame(gameId, { [FILE_KEY[kind]]: undefined })
  misses.delete(`${gameId}:${kind}`)
}

/**
 * Drop every cached miss so a rescan — or a newly added API key — gets another
 * go at the games that came back empty.
 */
export function retryMissingArt(): void {
  misses.clear()
}
