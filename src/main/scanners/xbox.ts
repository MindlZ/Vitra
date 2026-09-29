import { createHash } from 'crypto'
import { promises as fs } from 'fs'
import { basename, join } from 'path'
import type { Game } from '../../shared/types'

/*
 * Xbox app / PC Game Pass games (GDK titles). The Xbox app records where it
 * installs games in a `.GamingRoot` file at the root of each drive; every game
 * folder there has Content\appxmanifest.xml (the package identity) and
 * Content\MicrosoftGame.config (display name, executables, artwork).
 *
 * Only what's installed: the owned library lives behind an Xbox Live sign-in,
 * and Vitra reads nothing that needs an account.
 *
 * These are packaged apps, so they're launched through the shell by their app
 * id (shell:AppsFolder\<PackageFamilyName>!<AppId>), never by the exe.
 */

const DRIVES = 'CDEFGHIJKLMNOPQRSTUVWXYZ'.split('')

/**
 * `.GamingRoot`: "RGBX", a uint32 count, then that many NUL-terminated
 * UTF-16LE folder paths relative to the drive root (normally "XboxGames").
 */
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

/**
 * Windows' publisher id: the first 8 bytes of SHA-256 over the UTF-16LE
 * publisher string, as 13 characters of its own base32. Checked against
 * Get-AppxPackage on a real install ("CN=EEF78D1E-…" -> 2m6wzp0cmt084).
 */
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

/** An attribute from the first tag of this name. Enough for these flat files. */
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
  // No config means it isn't a GDK game (GameSave and the like live here too).
  const config = await readConfig(content)
  if (!manifest || !config) return undefined

  const packageName = attr(manifest, 'Identity', 'Name')
  const publisher = attr(manifest, 'Identity', 'Publisher')
  const appId = attr(manifest, 'Application', 'Id')
  if (!packageName || !publisher || !appId) return undefined

  // The manifest's name can be a resource reference; the config's is plain.
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

/**
 * Artwork that ships inside the package: the splash screen is a fair hero,
 * and the square tile a last-resort cover (letterboxed, as it's square).
 */
export async function xboxLocalArt(
  installDir: string,
  kind: 'cover' | 'hero' | 'logo'
): Promise<string | undefined> {
  if (kind === 'logo') return undefined
  const config = await readConfig(installDir)
  const file = kind === 'hero' ? config?.splash : config?.cover
  return file ? join(installDir, file) : undefined
}
