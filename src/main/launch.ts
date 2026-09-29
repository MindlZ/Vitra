import { BrowserWindow, shell } from 'electron'
import { spawn } from 'child_process'
import { dirname } from 'path'
import { getGame, getSettings, patchGame, save } from './store'
import { resolveProcessHints, watchSession } from './watcher'
import type { Game, RunningState } from '../shared/types'

interface ActiveSession {
  gameId: string
  startedAt: number
  confirmed: boolean
  signal: { cancelled: boolean }
  /** Settles once the session has been recorded (or discarded). */
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

/** For main-process consumers of the same events (Discord presence). */
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
  // Packaged apps can't be started from their exe; the shell starts them by
  // app id, the same way the Start menu does.
  if (game.source === 'xbox' && game.xboxAumid) {
    const child = spawn('explorer.exe', [`shell:AppsFolder\\${game.xboxAumid}`], {
      detached: true,
      stdio: 'ignore'
    })
    child.on('error', (err) => console.error(`[launch] ${game.name}:`, err.message))
    child.unref()
    return { ok: true }
  }
  // Owned but not on disk (GOG): the store's own page, where it installs.
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

export async function launchGame(gameId: string): Promise<{ ok: boolean; error?: string }> {
  const game = getGame(gameId)
  if (!game) return { ok: false, error: 'Game not found.' }
  if (active.has(gameId)) return { ok: false, error: `${game.name} is already running.` }

  const started = startProcess(game)
  if (!started.ok) return started

  // An uninstalled game only opens the store's install prompt, so it isn't
  // "last played" yet — the session watcher below records that when it runs.
  if (game.installed) {
    patchGame(gameId, { lastPlayed: Date.now() })
    broadcast('library:changed', null)
  }

  const settings = getSettings()
  if (settings.minimiseOnLaunch && game.installed) {
    for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.minimize()
  }
  if (!settings.trackPlaytime) return { ok: true }
  // Launching an uninstalled game just opens Steam's install prompt — there's
  // no process coming, so don't start a session that can only time out.
  if (!game.installed) return { ok: true }

  const session: ActiveSession = {
    gameId,
    startedAt: Date.now(),
    confirmed: false,
    signal: { cancelled: false }
  }
  active.set(gameId, session)
  emitRunning()

  // Fire and forget — the session outlives this IPC call.
  session.done = (async () => {
    try {
      const hints = await resolveProcessHints(game)
      // Cache the discovered names so the next launch doesn't rescan the folder.
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
        const current = getGame(gameId)
        patchGame(gameId, {
          playtimeSeconds: (current?.playtimeSeconds ?? 0) + outcome.seconds,
          sessions: (current?.sessions ?? 0) + 1,
          lastPlayed: Date.now()
        })
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

/** Stop tracking a session without touching the game process. */
export function stopTracking(gameId: string): void {
  const session = active.get(gameId)
  if (session) session.signal.cancelled = true
}

export function cancelAllTracking(): void {
  for (const session of active.values()) session.signal.cancelled = true
}

/**
 * End every session now and record the time played so far, then wait until
 * it's on disk. For shutting the PC down: the game dies with it, and a
 * session is otherwise only written when its process is seen to exit. A
 * cancelled watch still returns what it counted (see watchSession), so this
 * is cancel-and-wait; it takes up to one poll (~4s).
 */
export async function finishAllSessions(): Promise<void> {
  const pending = [...active.values()]
  for (const session of pending) session.signal.cancelled = true
  await Promise.all(pending.map((session) => session.done))
  await save()
}
