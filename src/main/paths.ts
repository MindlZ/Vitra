import { execFile } from 'child_process'
import { existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

export function runCommand(file: string, args: string[], timeout = 10_000): Promise<string> {
  return new Promise((resolve) => {
    execFile(file, args, { timeout, windowsHide: true }, (err, stdout) => {
      resolve(err && !stdout ? '' : stdout)
    })
  })
}

/** Read a single registry value. Returns undefined if the key/value is absent. */
export async function readRegistryValue(key: string, value: string): Promise<string | undefined> {
  const stdout = await runCommand('reg', ['query', key, '/v', value])
  // Format: "    SteamPath    REG_SZ    c:/program files (x86)/steam"
  const match = stdout.match(new RegExp(`${value}\\s+REG_[A-Z_]+\\s+(.+)`, 'i'))
  const result = match?.[1]?.trim()
  return result && result.length ? result : undefined
}

/**
 * Cached: the art resolver asks per game, and each miss would otherwise spawn
 * a `reg query` subprocess.
 */
const steamPathCache = new Map<string, string | undefined>()

export function clearSteamPathCache(): void {
  steamPathCache.clear()
}

export async function findSteamPath(override?: string): Promise<string | undefined> {
  const cacheKey = override ?? ''
  if (steamPathCache.has(cacheKey)) return steamPathCache.get(cacheKey)

  const found = await locateSteamPath(override)
  steamPathCache.set(cacheKey, found)
  return found
}

async function locateSteamPath(override?: string): Promise<string | undefined> {
  if (override && existsSync(join(override, 'steamapps'))) return override

  const fromRegistry =
    (await readRegistryValue('HKCU\\Software\\Valve\\Steam', 'SteamPath')) ??
    (await readRegistryValue('HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam', 'InstallPath')) ??
    (await readRegistryValue('HKLM\\SOFTWARE\\Valve\\Steam', 'InstallPath'))

  const candidates = [
    fromRegistry,
    'C:\\Program Files (x86)\\Steam',
    'C:\\Program Files\\Steam',
    join(homedir(), 'scoop', 'apps', 'steam', 'current')
  ].filter((path): path is string => Boolean(path))

  for (const candidate of candidates) {
    // The registry stores a forward-slash path; normalise before joining.
    const normalised = candidate.replace(/\//g, '\\')
    if (existsSync(join(normalised, 'steamapps'))) return normalised
  }
  return undefined
}

function programData(): string {
  return process.env.PROGRAMDATA ?? 'C:\\ProgramData'
}

export function epicManifestDir(): string {
  return join(programData(), 'Epic', 'EpicGamesLauncher', 'Data', 'Manifests')
}

/**
 * The launcher's catalogue cache: base64 JSON of the catalogue items for the
 * account's library, installed or not. The only local record of what's owned.
 */
export function epicCatalogFile(): string {
  return join(programData(), 'Epic', 'EpicGamesLauncher', 'Data', 'Catalog', 'catcache.bin')
}

/** GOG Galaxy 2's local database: the owned library, titles and art URLs. */
export function gogGalaxyDb(): string {
  return join(programData(), 'GOG.com', 'Galaxy', 'storage', 'galaxy-2.0.db')
}
