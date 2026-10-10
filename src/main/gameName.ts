import { basename, dirname, extname } from 'path'
import { runCommand } from './paths'

// folders that say where the exe sits, not what the game is
const GENERIC_DIRS =
  /^(bin|binaries|win(32|64)|x(64|86)|x86_64|amd64|game|games|retail|release|shipping|build|app|client|common|steamapps|program files( \(x86\))?|windowsnoeditor|windows|data|exe|current|live|launcher)$/i

// engine and wrapper names that show up as ProductName
const JUNK_NAMES =
  /^(unreal engine.*|ue[45]?game|unity|bootstrappackagedgame|launcher|game|main|application|electron|nw\.js|godot engine|java.*|python.*|.*operating system)$/i

export function cleanTitle(raw: string): string {
  return raw
    .replace(/[™®©]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// "Assassins.Creed_Odyssey" -> "Assassins Creed Odyssey"; only when there are no spaces already
function despace(text: string): string {
  return text.includes(' ') ? text : text.replace(/[._]+/g, ' ')
}

// download-folder names: "Days-Gone-Site.com", "Overgrowth v1.4.0", "ItTakesTwo"
export function tidyFolderName(raw: string): string {
  let name = raw
    .replace(/[-_. ]+[a-z0-9]+\.(com|net|org|to|io|ru)$/i, '')
    .replace(/[-_ ]+v?\d+(\.\d+){1,3}[a-z]?$/i, '')
  if (!name.includes(' ')) name = name.replace(/[-._]+/g, ' ')
  // camel case only when the whole name is one run
  if (!name.includes(' ')) name = name.replace(/([a-z])([A-Z0-9])/g, '$1 $2')
  return cleanTitle(name)
}

type VersionInfo = { product?: string; description?: string }

// one powershell for the lot: a spawn costs ~300ms
async function versionInfos(exePaths: string[]): Promise<VersionInfo[]> {
  if (!exePaths.length) return []
  const list = exePaths.map((path) => `'${path.replace(/'/g, "''")}'`).join(',')
  const script =
    `[Console]::OutputEncoding = [Text.Encoding]::UTF8; ` +
    `ConvertTo-Json -Compress @(@(${list}) | ForEach-Object { ` +
    `$v = (Get-Item -LiteralPath $_ -ErrorAction SilentlyContinue).VersionInfo; ` +
    `@{ product = $v.ProductName; description = $v.FileDescription } })`
  const stdout = await runCommand(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', script],
    5_000 + exePaths.length * 500
  )
  try {
    const parsed = JSON.parse(stdout.trim()) as Array<{ product?: unknown; description?: unknown }>
    return exePaths.map((_, i) => ({
      product: typeof parsed[i]?.product === 'string' ? (parsed[i].product as string) : undefined,
      description: typeof parsed[i]?.description === 'string' ? (parsed[i].description as string) : undefined
    }))
  } catch {
    return exePaths.map(() => ({}))
  }
}

function installFolder(exePath: string): string | undefined {
  let dir = dirname(exePath)
  for (let i = 0; i < 4; i++) {
    const name = basename(dir)
    // drive root: basename is '' or 'C:\'
    if (!name || name === dir || /^[a-z]:\\?$/i.test(name)) return undefined
    if (!GENERIC_DIRS.test(name)) return name
    dir = dirname(dir)
  }
  return undefined
}

export function exeStem(exePath: string): string {
  return basename(exePath, extname(exePath))
}

function pick(candidates: Array<string | undefined>, stem: string): string {
  for (const raw of candidates) {
    if (!raw) continue
    const title = cleanTitle(raw)
    if (!/[a-z]/i.test(title) || title.length > 80) continue
    if (JUNK_NAMES.test(title)) continue
    // the exe name verbatim tells us nothing new ("Tiny Glade" for tiny-glade.exe still does)
    if (title === stem) continue
    return title
  }
  return despace(stem)
}

// exe names are often shorthand (ACOdyssey.exe), which store art lookups can't match.
// folder = the game's own folder when the caller knows it (a folder scan). it beats
// ProductName there: Unreal games report their project name ("BendGame" for Days Gone)
export async function guessGameNames(
  entries: Array<{ exePath: string; folder?: string }>
): Promise<string[]> {
  const exes = entries.filter((entry) => extname(entry.exePath).toLowerCase() === '.exe')
  const infos = await versionInfos(exes.map((entry) => entry.exePath))
  const byPath = new Map(exes.map((entry, i) => [entry.exePath, infos[i]]))
  return entries.map(({ exePath, folder }) => {
    const info = byPath.get(exePath)
    // a shortcut's own name is the title the user or installer gave it
    if (!info) return exeStem(exePath)
    const stem = exeStem(exePath)
    if (folder) return pick([tidyFolderName(folder), info.product, info.description], stem)
    const near = installFolder(exePath)
    return pick([info.product, near && despace(near), info.description], stem)
  })
}

export async function guessGameName(exePath: string): Promise<string> {
  return (await guessGameNames([{ exePath }]))[0]
}
