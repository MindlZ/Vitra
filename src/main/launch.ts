import { BrowserWindow, shell } from 'electron'
import { spawn } from 'child_process'
import { dirname } from 'path'
import { getGame, getSettings, patchGame, save } from './store'
import { resolveProcessHints, watchSession } from './watcher'
import { recordSession } from './sessions'
import { endCompanions, startCompanions } from './companions'
import type { Game, RunningState } from '../shared/types'

interface ActiveSession {
  gameId: string
  startedAt: number
  confirmed: boolean
  signal: { cancelled: boolean }
  done?: Promise<void>
}

const active = new Map<string, ActiveSession>()

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }
}

export function runningStates(): RunningState[] {
  return [...active.values()].map(({ gameId, startedAt, confirmed }) => ({
    gameId,
    startedAt,
    confirmed
  }))
}

const runningListeners = new Set<() => void>()

export function onRunningChange(listener: () => void): void {
  runningListeners.add(listener)
}

function emitRunning(): void {
  broadcast('running:changed', runningStates())
  runningListeners.forEach((listener) => listener())
}

function startProcess(game: Game): { ok: boolean; error?: string } {
  if (game.source === 'steam' && game.steamAppId) {
    void shell.openExternal(`steam://rungameid/${game.steamAppId}`)
    return { ok: true }
  }
  if (game.source === 'epic' && game.epicLaunchUri) {
    void shell.openExternal(game.epicLaunchUri)
    return { ok: true }
  }
  // packaged apps won't start from their exe
  if (game.source === 'xbox' && game.xboxAumid) {
    const child = spawn('explorer.exe', [`shell:AppsFolder\\${game.xboxAumid}`], {
      detached: true,
      stdio: 'ignore'
    })
    child.on('error', (err) => console.error(`[launch] ${game.name}:`, err.message))
    child.unref()
    return { ok: true }
  }
  // EA has no launcher entry: its exe hands itself to the EA app
  if (game.launcher?.uri) {
    void shell.openExternal(game.launcher.uri)
    return { ok: true }
  }
  if (game.launcher?.exe) {
    const exe = game.launcher.exe
    const child = spawn(exe, game.launcher.args ?? [], { cwd: dirname(exe), detached: true, stdio: 'ignore' })
    child.on('error', (err) => console.error(`[launch] ${game.name}:`, err.message))
    child.unref()
    return { ok: true }
  }
  if (!game.installed && game.launchUri) {
    shell.openExternal(game.launchUri).catch(() => {})
    return { ok: true }
  }
  if (game.exePath) {
    try {
      const args = game.args?.trim() ? game.args.trim().split(/\s+/) : []
      const child = spawn(game.exePath, args, {
        cwd: dirname(game.exePath),
        detached: true,
        stdio: 'ignore',
        windowsHide: false
      })
      child.on('error', (err) => console.error(`[launch] ${game.name}:`, err.message))
      child.unref()
      return { ok: true }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  }
  return { ok: false, error: 'No executable or store launch target configured for this game.' }
}

// via: start through another URI (friend's lobby) but track as usual. main only, never IPC
export async function launchGame(
  gameId: string,
  via?: string
): Promise<{ ok: boolean; error?: string }> {
  const game = getGame(gameId)
  if (!game) return { ok: false, error: 'Game not found.' }
  if (active.has(gameId)) return { ok: false, error: `${game.name} is already running.` }

  if (via) {
    void shell.openExternal(via)
  } else {
    const started = startProcess(game)
    if (!started.ok) return started
  }

  if (game.installed) {
    patchGame(gameId, { lastPlayed: Date.now() })
    broadcast('library:changed', null)
  }

  const settings = getSettings()
  if (settings.minimiseOnLaunch && game.installed) {
    for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.minimize()
  }
  // uninstalled = an install prompt, no process coming
  if (!game.installed) return { ok: true }
  const companions = await startCompanions(game)
  if (!settings.trackPlaytime) return { ok: true }

  const session: ActiveSession = {
    gameId,
    startedAt: Date.now(),
    confirmed: false,
    signal: { cancelled: false }
  }
  active.set(gameId, session)
  emitRunning()

  session.done = (async () => {
    try {
      const hints = await resolveProcessHints(game)
      if (hints.length && !game.processHints?.length) patchGame(gameId, { processHints: hints })

      const outcome = await watchSession(hints, {
        signal: session.signal,
        onConfirmed: () => {
          session.confirmed = true
          session.startedAt = Date.now()
          emitRunning()
        }
      })

      if (outcome.confirmed && outcome.seconds > 30) {
        const end = Date.now()
        await recordSession({ gameId, start: end - outcome.seconds * 1000, end })
        const current = getGame(gameId)
        patchGame(gameId, {
          playtimeSeconds: (current?.playtimeSeconds ?? 0) + outcome.seconds,
          sessions: (current?.sessions ?? 0) + 1,
          lastPlayed: Date.now()
        })
      }
      // cancelled = quit / stop tracking: the game may still be running
      if (outcome.confirmed && !session.signal.cancelled) {
        await endCompanions(getGame(gameId) ?? game, companions)
      }
    } catch (err) {
      console.error('[launch] session watch failed:', err)
    } finally {
      active.delete(gameId)
      emitRunning()
      broadcast('library:changed', null)
    }
  })()

  return { ok: true }
}

export function stopTracking(gameId: string): void {
  const session = active.get(gameId)
  if (session) session.signal.cancelled = true
}

export function cancelAllTracking(): void {
  for (const session of active.values()) session.signal.cancelled = true
}

// before shutdown/quit: a cancelled watch still returns what it counted. up to one poll (~4s)
export async function finishAllSessions(): Promise<void> {
  const pending = [...active.values()]
  for (const session of pending) session.signal.cancelled = true
  await Promise.all(pending.map((session) => session.done))
  await save()
}
