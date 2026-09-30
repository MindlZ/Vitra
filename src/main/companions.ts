import { shell } from 'electron'
import { spawn } from 'child_process'
import { basename, dirname } from 'path'
import { runCommand } from './paths'
import { listRunningProcesses } from './watcher'
import type { Game } from '../shared/types'

// already running = not ours: never started twice, never closed.
// only exes are closable (we hold the pid). taskkill without /f on purpose

export interface StartedCompanions {
  pids: number[]
}

export async function startCompanions(game: Game): Promise<StartedCompanions> {
  const started: StartedCompanions = { pids: [] }
  if (!game.companions?.length) return started
  const running = await listRunningProcesses()

  for (const path of game.companions) {
    if (running.has(basename(path).toLowerCase())) continue
    if (/\.exe$/i.test(path)) {
      try {
        const child = spawn(path, [], { cwd: dirname(path), detached: true, stdio: 'ignore' })
        child.on('error', (err) => console.error(`[companions] ${path}:`, err.message))
        if (child.pid) started.pids.push(child.pid)
        child.unref()
      } catch (err) {
        console.error(`[companions] ${path}:`, (err as Error).message)
      }
    } else {
      void shell.openPath(path).then((error) => {
        if (error) console.error(`[companions] ${path}:`, error)
      })
    }
  }
  return started
}

export async function endCompanions(game: Game, started: StartedCompanions): Promise<void> {
  if (game.closeCompanions) {
    for (const pid of started.pids) await runCommand('taskkill', ['/pid', String(pid), '/t'])
  }
  if (game.afterExit) {
    const error = await shell.openPath(game.afterExit)
    if (error) console.error(`[companions] after exit ${game.afterExit}:`, error)
  }
}
