import { app, safeStorage } from 'electron'
import { promises as fs } from 'fs'
import { join, dirname } from 'path'
import { SECRET_KEYS, type Game, type LibraryData, type SecretKey, type Settings } from '../shared/types'

const CURRENT_VERSION = 1

const DEFAULT_SETTINGS: Settings = {
  scanOnStart: true,
  trackPlaytime: true,
  minimiseOnLaunch: true,
  showFriends: true,
  backgroundDim: 65,
  wallpaper: 'sunset',
  theme: 'auto',
  matchBackgroundColours: true,
  programsView: 'library',
  bigPictureOnStart: false,
  closeToTray: true,
  openAtLogin: false,
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

/*
 * API keys never touch disk in plain text. They're encrypted with Electron's
 * safeStorage — DPAPI on Windows, so bound to this Windows user on this
 * machine — and written to a separate `secrets` block as base64. In memory
 * (main process only) they stay plain, since the scanners need them.
 */
type SecretBlock = Partial<Record<SecretKey, string>>

function encryptSecrets(settings: Settings): SecretBlock | undefined {
  const block: SecretBlock = {}
  let any = false
  for (const key of SECRET_KEYS) {
    const value = settings[key]
    if (!value) continue
    if (!safeStorage.isEncryptionAvailable()) {
      // Never fall back to plain text: the key works for this session and the
      // user re-enters it next time.
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
      // Copied from another user or PC: DPAPI can't open it. Drop the key
      // rather than fail the whole load; Settings shows it as not set.
      console.warn(`[store] could not decrypt ${key}:`, (err as Error).message)
    }
  }
  return out
}

export async function load(): Promise<LibraryData> {
  let migrate = false
  try {
    const raw = await fs.readFile(libraryFile(), 'utf8')
    const parsed = JSON.parse(raw) as Partial<LibraryData> & { secrets?: SecretBlock }
    const settings = { ...DEFAULT_SETTINGS, ...(parsed.settings ?? {}) }
    // From before the wallpaper presets: a custom image meant "show it".
    if (!parsed.settings?.wallpaper && settings.backgroundImage) settings.wallpaper = 'custom'
    // Files from before encryption hold keys in plain text; they're kept for
    // this load and rewritten encrypted straight away.
    migrate = SECRET_KEYS.some((key) => Boolean(parsed.settings?.[key]))
    data = {
      version: parsed.version ?? CURRENT_VERSION,
      games: (parsed.games ?? []).map(normaliseGame),
      settings: { ...settings, ...decryptSecrets(parsed.secrets) }
    }
  } catch {
    // First run, or a corrupt file — start clean rather than crashing the app.
    data = { version: CURRENT_VERSION, games: [], settings: { ...DEFAULT_SETTINGS } }
  }
  await fs.mkdir(artDir(), { recursive: true })
  if (migrate) await save()
  return data
}

/**
 * Settings as the renderer sees them: keys replaced by whether each is set.
 * The renderer only ever writes keys, never reads them back.
 */
export function publicSettings(): Settings {
  const view: Settings = { ...data.settings, keysSet: {} }
  for (const key of SECRET_KEYS) {
    view.keysSet![key] = Boolean(data.settings[key])
    delete view[key]
  }
  return view
}

function normaliseGame(game: Partial<Game>): Game {
  return {
    id: game.id ?? `manual:${Math.random().toString(36).slice(2)}`,
    name: game.name ?? 'Unknown',
    source: game.source ?? 'manual',
    steamAppId: game.steamAppId,
    epicLaunchUri: game.epicLaunchUri,
    xboxAumid: game.xboxAumid,
    launchUri: game.launchUri,
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
    addedAt: game.addedAt ?? Date.now()
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
  // keysSet is derived, never stored.
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

export function replaceGames(games: Game[]): void {
  data.games = games
  save()
}

/** Serialised, debounced write so rapid updates don't interleave on disk. */
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
