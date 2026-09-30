import { BrowserWindow, dialog } from 'electron'
import { promises as fs } from 'fs'
import { join } from 'path'
import { artDir, getData, getSettings, restoreLibrary } from './store'
import { getSessions, replaceSessions } from './sessions'
import { SECRET_KEYS, type Game, type PlaySession, type Settings } from '../shared/types'

// never holds API keys. downloaded art is left out; it comes back by itself

interface BackupFile {
  app: 'vitra'
  version: 1
  createdAt: number
  games: Game[]
  settings: Partial<Settings>
  sessions: PlaySession[]
  // art\ file name -> base64
  art: Record<string, string>
}

export type BackupResult = { ok: true } | { ok: false; error?: string }

// user-picked art only: setLocalArt's <id>-<kind>-<timestamp> naming
const USER_ART = /-(cover|hero|logo)-\d{13}\.\w+$/
// no paths, so a crafted backup can't write outside art\
const PLAIN_NAME = /^[\w.-]+$/

function stamp(): string {
  const now = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

export async function exportBackup(win: BrowserWindow | null): Promise<BackupResult> {
  const options = {
    title: 'Back up library',
    defaultPath: `Vitra backup ${stamp()}.vitrabackup`,
    filters: [{ name: 'Vitra backup', extensions: ['vitrabackup'] }]
  }
  const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
  if (result.canceled || !result.filePath) return { ok: false }

  const { games, settings } = getData()
  const publicSettings: Partial<Settings> = { ...settings }
  for (const key of SECRET_KEYS) delete publicSettings[key]
  delete publicSettings.keysSet

  const wanted = new Set<string>()
  for (const game of games) {
    for (const file of [game.coverFile, game.heroFile, game.logoFile]) {
      if (file && USER_ART.test(file)) wanted.add(file)
    }
  }
  if (settings.backgroundImage) wanted.add(settings.backgroundImage)

  const art: Record<string, string> = {}
  for (const name of wanted) {
    try {
      art[name] = (await fs.readFile(join(artDir(), name))).toString('base64')
    } catch {
      // gone from disk
    }
  }

  const body: BackupFile = {
    app: 'vitra',
    version: 1,
    createdAt: Date.now(),
    games,
    settings: publicSettings,
    sessions: await getSessions(),
    art
  }
  try {
    await fs.writeFile(result.filePath, JSON.stringify(body), 'utf8')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

function parseBackup(raw: string): BackupFile | undefined {
  try {
    const parsed = JSON.parse(raw) as Partial<BackupFile>
    if (parsed.app !== 'vitra' || parsed.version !== 1 || !Array.isArray(parsed.games)) return undefined
    return {
      app: 'vitra',
      version: 1,
      createdAt: typeof parsed.createdAt === 'number' ? parsed.createdAt : 0,
      games: parsed.games.filter((game) => game && typeof game === 'object' && typeof game.id === 'string'),
      settings: parsed.settings && typeof parsed.settings === 'object' ? parsed.settings : {},
      sessions: Array.isArray(parsed.sessions)
        ? parsed.sessions.filter(
            (s) => s && typeof s.gameId === 'string' && typeof s.start === 'number' && typeof s.end === 'number'
          )
        : [],
      art: parsed.art && typeof parsed.art === 'object' ? parsed.art : {}
    }
  } catch {
    return undefined
  }
}

export async function importBackup(win: BrowserWindow | null): Promise<BackupResult> {
  const options = {
    title: 'Restore library',
    properties: ['openFile' as const],
    filters: [{ name: 'Vitra backup', extensions: ['vitrabackup'] }]
  }
  const picked = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
  if (picked.canceled || !picked.filePaths.length) return { ok: false }

  let backup: BackupFile | undefined
  try {
    backup = parseBackup(await fs.readFile(picked.filePaths[0], 'utf8'))
  } catch {
    backup = undefined
  }
  if (!backup) return { ok: false, error: 'Not a Vitra backup' }

  const when = backup.createdAt ? new Date(backup.createdAt).toLocaleString() : 'an unknown date'
  const confirmOptions = {
    type: 'warning' as const,
    buttons: ['Restore', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    title: 'Restore library',
    message: `Replace this library with the backup from ${when}?`,
    detail: `${backup.games.length} games. API keys on this PC are kept.`
  }
  const answer = win ? await dialog.showMessageBox(win, confirmOptions) : await dialog.showMessageBox(confirmOptions)
  if (answer.response !== 0) return { ok: false }

  // art first, so the library never points at a missing file
  await fs.mkdir(artDir(), { recursive: true })
  for (const [name, base64] of Object.entries(backup.art)) {
    if (!PLAIN_NAME.test(name) || typeof base64 !== 'string') continue
    await fs.writeFile(join(artDir(), name), Buffer.from(base64, 'base64'))
  }
  // Steam folder is this PC's
  const settings = { ...backup.settings, steamPath: getSettings().steamPath }
  if (settings.backgroundImage && !(settings.backgroundImage in backup.art)) {
    delete settings.backgroundImage
    if (settings.wallpaper === 'custom') settings.wallpaper = 'sunset'
  }

  await restoreLibrary(backup.games, settings)
  await replaceSessions(backup.sessions)
  return { ok: true }
}
