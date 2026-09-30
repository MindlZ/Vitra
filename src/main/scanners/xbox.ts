import { createHash } from 'crypto'
import { promises as fs } from 'fs'
import { basename, join } from 'path'
import type { Game } from '../../shared/types'

// GDK games: <drive>\.GamingRoot lists install folders; each game has
// Content\appxmanifest.xml + Content\MicrosoftGame.config

const DRIVES = 'CDEFGHIJKLMNOPQRSTUVWXYZ'.split('')

// "RGBX", u32 count, then that many \0-terminated UTF-16LE paths
async function gamingRoots(): Promise<string[]> {
  const found = await Promise.all(
    DRIVES.map(async (drive) => {
      try {
        const buffer = await fs.readFile(`${drive}:\\.GamingRoot`)
        if (buffer.length < 8 || buffer.toString('ascii', 0, 4) !== 'RGBX') return []
        const count = buffer.readUInt32LE(4)
        return buffer
          .toString('utf16le', 8)
          .split('\0')
          .filter(Boolean)
          .slice(0, count)
          .map((relative) => join(`${drive}:\\`, relative))
      } catch {
        return []
      }
    })
  )
  return found.flat()
}

// Windows' publisher hash: sha256(utf16le publisher)[0..8] in its own base32, 13 chars.
// checked against Get-AppxPackage ("CN=EEF78D1E-…" -> 2m6wzp0cmt084)
function publisherId(publisher: string): string {
  const hash = createHash('sha256').update(Buffer.from(publisher, 'utf16le')).digest()
  const alphabet = '0123456789abcdefghjkmnpqrstvwxyz'
  let bits = ''
  for (let i = 0; i < 8; i++) bits += hash[i].toString(2).padStart(8, '0')
  bits += '0'
  let out = ''
  for (let i = 0; i < 65; i += 5) out += alphabet[parseInt(bits.slice(i, i + 5), 2)]
  return out
}

function decode(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

function attr(xml: string, tag: string, name: string): string | undefined {
  const element = xml.match(new RegExp(`<${tag}\\b[^>]*>`))?.[0]
  const value = element?.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1]
  return value ? decode(value) : undefined
}

async function readText(path: string): Promise<string | undefined> {
  try {
    return await fs.readFile(path, 'utf8')
  } catch {
    return undefined
  }
}

interface GameConfig {
  displayName?: string
  executables: string[]
  cover?: string
  splash?: string
}

async function readConfig(content: string): Promise<GameConfig | undefined> {
  const xml = await readText(join(content, 'MicrosoftGame.config'))
  if (!xml) return undefined
  const executables = [...xml.matchAll(/<Executable\b[^>]*\bName="([^"]+)"/g)].map((m) => decode(m[1]))
  return {
    displayName: attr(xml, 'ShellVisuals', 'DefaultDisplayName'),
    executables,
    cover: attr(xml, 'ShellVisuals', 'Square480x480Logo') ?? attr(xml, 'ShellVisuals', 'Square150x150Logo'),
    splash: attr(xml, 'ShellVisuals', 'SplashScreenImage')
  }
}

async function readGame(folder: string): Promise<Game | undefined> {
  const content = join(folder, 'Content')
  const manifest = await readText(join(content, 'appxmanifest.xml'))
  // no config = not a game (GameSave etc live here too)
  const config = await readConfig(content)
  if (!manifest || !config) return undefined

  const packageName = attr(manifest, 'Identity', 'Name')
  const publisher = attr(manifest, 'Identity', 'Publisher')
  const appId = attr(manifest, 'Application', 'Id')
  if (!packageName || !publisher || !appId) return undefined

  // manifest name can be an ms-resource: ref
  const manifestName = manifest.match(/<DisplayName>([^<]*)<\/DisplayName>/)?.[1]
  const name =
    [manifestName && decode(manifestName), config.displayName].find(
      (candidate) => candidate && !candidate.startsWith('ms-resource:')
    ) ?? basename(folder)

  const exe = config.executables[0]
  return {
    id: `xbox:${packageName}`,
    name: name.trim(),
    source: 'xbox',
    xboxAumid: `${packageName}_${publisherId(publisher)}!${appId}`,
    installDir: content,
    exePath: exe ? join(content, exe) : undefined,
    processHints: [...new Set(config.executables.map((path) => basename(path).toLowerCase()))],
    tags: [],
    favorite: false,
    hidden: false,
    installed: true,
    playtimeSeconds: 0,
    sessions: 0,
    addedAt: Date.now()
  }
}

export async function scanXbox(): Promise<{ games: Game[]; errors: string[] }> {
  const errors: string[] = []
  const games: Game[] = []

  for (const root of await gamingRoots()) {
    let folders: string[]
    try {
      folders = (await fs.readdir(root, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .map((entry) => join(root, entry.name))
    } catch {
      continue
    }
    for (const folder of folders) {
      try {
        const game = await readGame(folder)
        if (game && !games.some((other) => other.id === game.id)) games.push(game)
      } catch (err) {
        errors.push(`${folder}: ${(err as Error).message}`)
      }
    }
  }

  return { games, errors }
}

export async function xboxLocalArt(
  installDir: string,
  kind: 'cover' | 'hero' | 'logo'
): Promise<string | undefined> {
  if (kind === 'logo') return undefined
  const config = await readConfig(installDir)
  const file = kind === 'hero' ? config?.splash : config?.cover
  return file ? join(installDir, file) : undefined
}
