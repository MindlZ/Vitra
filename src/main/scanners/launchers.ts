import { existsSync, promises as fs } from 'fs'
import { basename, join, normalize } from 'path'
import { runCommand } from '../paths'
import type { Game, GameSource, LauncherTarget } from '../../shared/types'

// all four from the Uninstall keys, not their private formats (Battle.net's is protobuf).
// entries outlive uninstalls, so InstallLocation must exist

const HIVES = [
  'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall'
]

interface Entry {
  // subkey name, e.g. "Uplay Install 2010"
  key: string
  values: Record<string, string>
}

async function readUninstall(): Promise<Entry[]> {
  const outputs = await Promise.all(HIVES.map((hive) => runCommand('reg', ['query', hive, '/s'], 20_000)))
  const entries: Entry[] = []
  for (const stdout of outputs) {
    for (const block of stdout.split(/\r?\n(?=HKEY_)/)) {
      const lines = block.split(/\r?\n/)
      const key = lines[0]?.trim().split('\\').pop()
      if (!key) continue
      const values: Record<string, string> = {}
      for (const line of lines.slice(1)) {
        const match = line.match(/^\s+(.+?)\s+REG_\w+\s*(.*)$/)
        if (match) values[match[1].toLowerCase()] = match[2].trim()
      }
      entries.push({ key, values })
    }
  }
  return entries
}

// Ubisoft writes "D:/GAMES/Far Cry Primal/"
function tidyPath(path: string | undefined): string | undefined {
  if (!path) return undefined
  const clean = normalize(path.replace(/^"|"$/g, '').trim()).replace(/[\\/]+$/, '')
  return clean || undefined
}

function commandExe(command: string | undefined): string | undefined {
  if (!command) return undefined
  const match = command.match(/^"([^"]+)"/) ?? command.match(/^(\S+\.exe)/i)
  return match ? tidyPath(match[1]) : undefined
}

// DisplayIcon can also be an .ico, or "path,0"
function iconExe(icon: string | undefined): string | undefined {
  const path = tidyPath(icon?.replace(/,\s*-?\d+$/, ''))
  return path && /\.exe$/i.test(path) && existsSync(path) ? path : undefined
}

function baseGame(id: string, name: string, source: GameSource, installDir: string): Game {
  return {
    id,
    name,
    source,
    installDir,
    processHints: [],
    tags: [],
    favorite: false,
    hidden: false,
    installed: true,
    playtimeSeconds: 0,
    sessions: 0,
    addedAt: Date.now()
  }
}

// a *launcher.exe isn't the game; let the install-dir scan find it
function hintsFrom(exe: string | undefined): string[] {
  if (!exe || /launcher/i.test(basename(exe))) return []
  return [basename(exe).toLowerCase()]
}

// newer products: uid upper-cased (auks -> AUKS). older ones have their own codes
const BATTLENET_CODES: Record<string, string> = {
  prometheus: 'Pro',
  wow: 'WoW',
  wow_classic: 'WoWC',
  wow_classic_era: 'WoWC',
  diablo3: 'D3',
  s2: 'S2',
  s1: 'S1',
  hs_beta: 'WTCG',
  heroes: 'Hero',
  fenris: 'Fen',
  lazarus: 'LAZR',
  viper: 'VIPR',
  w3: 'W3',
  gryphon: 'GRY'
}

function battlenet(entries: Entry[]): Game[] {
  const client = entries.find((entry) => entry.key === 'Battle.net')
  const clientDir = tidyPath(client?.values.installlocation)
  const clientExe = clientDir ? join(clientDir, 'Battle.net.exe') : undefined
  if (!clientExe || !existsSync(clientExe)) return []

  const games: Game[] = []
  for (const { values } of entries) {
    const uid = values.uninstallstring?.match(/--uid=(\S+)/)?.[1]?.replace(/"$/, '')
    if (!uid || uid === 'battle.net' || !/Blizzard Uninstaller/i.test(values.uninstallstring)) continue
    const dir = tidyPath(values.installlocation)
    if (!dir || !existsSync(dir)) continue
    const code = BATTLENET_CODES[uid] ?? uid.toUpperCase()
    const exe = iconExe(values.displayicon)
    const game = baseGame(`battlenet:${uid}`, values.displayname || uid, 'battlenet', dir)
    game.exePath = exe
    game.processHints = hintsFrom(exe)
    game.launcher = { exe: clientExe, args: [`--exec=launch ${code}`] }
    games.push(game)
  }
  return games
}

async function eaContentId(dir: string): Promise<string | undefined> {
  try {
    const xml = await fs.readFile(join(dir, '__Installer', 'installerdata.xml'), 'utf8')
    return xml.match(/<contentID>\s*([^<\s]+)\s*<\/contentID>/)?.[1]
  } catch {
    return undefined
  }
}

async function ea(entries: Entry[]): Promise<Game[]> {
  const games: Game[] = []
  for (const { key, values } of entries) {
    if (!/EAInstaller[\\/].*Cleanup\.exe/i.test(values.uninstallstring ?? '')) continue
    const dir = tidyPath(values.installlocation)
    const exe = iconExe(values.displayicon)
    // Steam copies of EA games register here too
    if (!dir || !exe || !existsSync(dir) || /steamapps/i.test(dir)) continue
    const id = (await eaContentId(dir)) ?? key.replace(/[{}]/g, '')
    const game = baseGame(`ea:${id}`, values.displayname || basename(dir), 'ea', dir)
    game.exePath = exe
    game.processHints = hintsFrom(exe)
    games.push(game)
  }
  return games
}

function ubisoft(entries: Entry[]): Game[] {
  const games: Game[] = []
  for (const { key, values } of entries) {
    const id = key.match(/^Uplay Install (\d+)$/)?.[1]
    if (!id) continue
    const dir = tidyPath(values.installlocation)
    if (!dir || !existsSync(dir)) continue
    const game = baseGame(`ubisoft:${id}`, values.displayname || basename(dir), 'ubisoft', dir)
    game.launcher = { uri: `uplay://launch/${id}/0` }
    games.push(game)
  }
  return games
}

// in-match processes only: the clients idle in lobbies for hours
const RIOT_PROCESSES: Record<string, string[]> = {
  league_of_legends: ['league of legends.exe'],
  valorant: ['valorant-win64-shipping.exe'],
  bacon: ['lor.exe']
}

function riot(entries: Entry[]): Game[] {
  const games: Game[] = []
  for (const { key, values } of entries) {
    const match = key.match(/^Riot Game ([a-z0-9_]+)\.([a-z0-9_]*)$/i)
    if (!match || match[1].toLowerCase() === 'riot_client') continue
    const [, product, patchline] = match
    const dir = tidyPath(values.installlocation)
    const client = commandExe(values.uninstallstring)
    if (!dir || !client || !existsSync(dir) || !existsSync(client)) continue
    const game = baseGame(`riot:${product}.${patchline}`, values.displayname || product, 'riot', dir)
    game.processHints = RIOT_PROCESSES[product.toLowerCase()] ?? []
    const launcher: LauncherTarget = {
      exe: client,
      args: [`--launch-product=${product}`, `--launch-patchline=${patchline || 'live'}`]
    }
    game.launcher = launcher
    games.push(game)
  }
  return games
}

export async function scanLaunchers(): Promise<{ games: Game[]; errors: string[] }> {
  try {
    const entries = await readUninstall()
    const games = [...battlenet(entries), ...(await ea(entries)), ...ubisoft(entries), ...riot(entries)]
    return { games, errors: [] }
  } catch (err) {
    return { games: [], errors: [`Other launchers: ${(err as Error).message}`] }
  }
}
