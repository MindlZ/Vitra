import { app, safeStorage } from 'electron'
import { promises as fs } from 'fs'
import { join, dirname } from 'path'
import { SECRET_KEYS, type Game, type LibraryData, type SecretKey, type Settings } from '../shared/types'

const CURRENT_VERSION = 1

const DEFAULT_SETTINGS: Settings = {
  scanOnStart: true,
  autoTags: true,
  trackPlaytime: true,
  minimiseOnLaunch: true,
  showFriends: true,
  backgroundDim: 65,
  backgroundParticles: true,
  backgroundWave: true,
  glassBlur: true,
  visualiserPeaks: true,
  visualiserGlow: true,
  slowWhenUnfocused: true,
  visualiserWidget: false,
  lyrics: false,
  lyricsHome: true,
  lyricsBigPicture: true,
  lyricsSaver: true,
  lyricsWidget: false,
  lyricsWidgetSize: 'medium',
  visualiserWidgetSize: 'medium',
  perfOverlay: false,
  ambientSound: false,
  ambientVolume: 40,
  wallpaper: 'crimson',
  desktopScreen: 0,
  theme: 'auto',
  accentSource: 'wallpaper',
  // the brand crimson
  accentHue: 15,
  accentChroma: 0.23,
  programsView: 'library',
  bigPictureOnStart: false,
  closeToTray: true,
  openAtLogin: false,
  startInTray: false,
  checkForUpdates: true,
  discordPresence: false,
  screenSaverMinutes: 5
}

let data: LibraryData = { version: CURRENT_VERSION, games: [], settings: { ...DEFAULT_SETTINGS } }
let writeQueue: Promise<void> = Promise.resolve()

export function libraryFile(): string {
  return join(app.getPath('userData'), 'library.json')
}

export function artDir(): string {
  return join(app.getPath('userData'), 'art')
}

// keys: safeStorage (DPAPI, so this user on this PC only) in a `secrets` block; plain in memory only
type SecretBlock = Partial<Record<SecretKey, string>>

function encryptSecrets(settings: Settings): SecretBlock | undefined {
  const block: SecretBlock = {}
  let any = false
  for (const key of SECRET_KEYS) {
    const value = settings[key]
    if (!value) continue
    if (!safeStorage.isEncryptionAvailable()) {
      // never fall back to plain text; session-only instead
      console.warn(`[store] encryption unavailable; ${key} kept in memory only`)
      continue
    }
    block[key] = safeStorage.encryptString(value).toString('base64')
    any = true
  }
  return any ? block : undefined
}

function decryptSecrets(block: SecretBlock | undefined): Partial<Settings> {
  const out: Partial<Settings> = {}
  for (const key of SECRET_KEYS) {
    const stored = block?.[key]
    if (!stored) continue
    try {
      out[key] = safeStorage.decryptString(Buffer.from(stored, 'base64'))
    } catch (err) {
      // copied from another user/PC
      console.warn(`[store] could not decrypt ${key}:`, (err as Error).message)
    }
  }
  return out
}

// pre-accentSource files had a "match colours" switch; off meant the magenta
function migrateAccent(settings: Settings & { matchBackgroundColours?: boolean }): void {
  if (settings.matchBackgroundColours === false && settings.accentSource === 'wallpaper') {
    settings.accentSource = 'vitra'
  }
  delete settings.matchBackgroundColours
}

// presets that were removed; their old ids land on the default
const RETIRED_WALLPAPERS = new Set(['sunset'])
function migrateWallpaper(settings: Settings): void {
  if (RETIRED_WALLPAPERS.has(settings.wallpaper)) settings.wallpaper = DEFAULT_SETTINGS.wallpaper
}

export async function load(): Promise<LibraryData> {
  let migrate = false
  try {
    const raw = await fs.readFile(libraryFile(), 'utf8')
    const parsed = JSON.parse(raw) as Partial<LibraryData> & { secrets?: SecretBlock }
    const settings = { ...DEFAULT_SETTINGS, ...(parsed.settings ?? {}) }
    // pre-presets files
    if (!parsed.settings?.wallpaper && settings.backgroundImage) settings.wallpaper = 'custom'
    migrateAccent(settings)
    migrateWallpaper(settings)
    // pre-encryption files had plain keys: rewrite straight away
    migrate = SECRET_KEYS.some((key) => Boolean(parsed.settings?.[key]))
    data = {
      version: parsed.version ?? CURRENT_VERSION,
      games: (parsed.games ?? []).map(normaliseGame),
      settings: { ...settings, ...decryptSecrets(parsed.secrets) }
    }
  } catch {
    data = { version: CURRENT_VERSION, games: [], settings: { ...DEFAULT_SETTINGS } }
  }
  await fs.mkdir(artDir(), { recursive: true })
  if (migrate) await save()
  return data
}

// what the renderer gets: keys stripped, only whether each is set. never send getSettings()
export function publicSettings(): Settings {
  const view: Settings = { ...data.settings, keysSet: {} }
  for (const key of SECRET_KEYS) {
    view.keysSet![key] = Boolean(data.settings[key])
    delete view[key]
  }
  return view
}

// whitelist: a Game field missing here is silently dropped on the next load
function normaliseGame(game: Partial<Game>): Game {
  return {
    id: game.id ?? `manual:${Math.random().toString(36).slice(2)}`,
    name: game.name ?? 'Unknown',
    source: game.source ?? 'manual',
    steamAppId: game.steamAppId,
    epicLaunchUri: game.epicLaunchUri,
    xboxAumid: game.xboxAumid,
    launchUri: game.launchUri,
    launcher: game.launcher,
    installDir: game.installDir,
    exePath: game.exePath,
    args: game.args,
    processHints: game.processHints ?? [],
    coverUrl: game.coverUrl,
    coverFile: game.coverFile,
    heroUrl: game.heroUrl,
    heroFile: game.heroFile,
    logoUrl: game.logoUrl,
    logoFile: game.logoFile,
    tags: game.tags ?? [],
    software: game.software,
    softwareOverride: game.softwareOverride,
    favorite: game.favorite ?? false,
    hidden: game.hidden ?? false,
    installed: game.installed ?? true,
    playtimeSeconds: game.playtimeSeconds ?? 0,
    sessions: game.sessions ?? 0,
    lastPlayed: game.lastPlayed,
    addedAt: game.addedAt ?? Date.now(),
    autoName: typeof game.autoName === 'boolean' ? game.autoName : undefined,
    autoTagged: game.autoTagged === true ? true : undefined,
    preferredStore: game.preferredStore,
    companions: game.companions?.filter((path) => typeof path === 'string'),
    closeCompanions: game.closeCompanions,
    afterExit: typeof game.afterExit === 'string' ? game.afterExit : undefined
  }
}

export function getData(): LibraryData {
  return data
}

export function getGames(): Game[] {
  return data.games
}

export function getGame(id: string): Game | undefined {
  return data.games.find((g) => g.id === id)
}

export function getSettings(): Settings {
  return data.settings
}

export function setSettings(patch: Partial<Settings>): Settings {
  const rest = { ...patch }
  delete rest.keysSet
  data.settings = { ...data.settings, ...rest }
  save()
  return data.settings
}

export function upsertGame(game: Game): Game {
  const index = data.games.findIndex((g) => g.id === game.id)
  if (index === -1) data.games.push(game)
  else data.games[index] = game
  save()
  return game
}

export function patchGame(id: string, patch: Partial<Game>): Game | undefined {
  const game = getGame(id)
  if (!game) return undefined
  Object.assign(game, patch)
  save()
  return game
}

export function removeGame(id: string): boolean {
  const before = data.games.length
  data.games = data.games.filter((g) => g.id !== id)
  if (data.games.length === before) return false
  save()
  return true
}

// keeps this PC's keys; backups never carry them
export function restoreLibrary(games: Array<Partial<Game>>, settings: Partial<Settings>): Promise<void> {
  const next: Settings = { ...DEFAULT_SETTINGS, ...settings }
  migrateAccent(next)
  migrateWallpaper(next)
  for (const key of SECRET_KEYS) next[key] = data.settings[key]
  delete next.keysSet
  data = { ...data, games: games.map(normaliseGame), settings: next }
  return save()
}

export function replaceGames(games: Game[]): void {
  data.games = games
  save()
}

// serialised + tmp/rename so writes never interleave or half-land
export function save(): Promise<void> {
  writeQueue = writeQueue.then(async () => {
    const file = libraryFile()
    const tmp = `${file}.tmp`
    await fs.mkdir(dirname(file), { recursive: true })
    const settings: Settings = { ...data.settings }
    for (const key of SECRET_KEYS) delete settings[key]
    delete settings.keysSet
    const onDisk = { ...data, settings, secrets: encryptSecrets(data.settings) }
    await fs.writeFile(tmp, JSON.stringify(onDisk, null, 2), 'utf8')
    await fs.rename(tmp, file)
  })
  return writeQueue.catch((err) => {
    console.error('[store] failed to save library:', err)
  })
}
