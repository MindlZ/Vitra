import { app } from 'electron'
import { spawn } from 'child_process'
import { finishAllSessions } from './launch'
import type { PowerAction } from '../shared/types'

/*
 * Big picture's power menu, as on a console: sleep, restart or shut down
 * the PC, or quit Vitra. The renderer does the countdown and the "are you
 * sure"; by the time a call lands here, it's meant.
 *
 * Restart and shut down go through Windows' own `shutdown`, with a zero
 * timeout: that's the one form that isn't forced, so an app with unsaved
 * work still gets to say so (a timeout above zero implies /f). Before
 * either, any tracked play session is ended and saved, since it would
 * otherwise die with the game.
 */

function detached(file: string, args: string[]): void {
  const child = spawn(file, args, { detached: true, stdio: 'ignore', windowsHide: true })
  child.on('error', (err) => console.error(`[power] ${file}:`, err.message))
  child.unref()
}

/**
 * Sleep, not hibernate. `rundll32 powrprof.dll,SetSuspendState` is the
 * usual one-liner, but it hibernates whenever hibernation is enabled; the
 * .NET call asks for suspend explicitly. On Modern Standby PCs Windows
 * decides what "suspend" means.
 */
const SLEEP_SCRIPT =
  'Add-Type -AssemblyName System.Windows.Forms; ' +
  '[void][System.Windows.Forms.Application]::SetSuspendState([System.Windows.Forms.PowerState]::Suspend, $false, $false)'

export async function runPower(action: PowerAction): Promise<void> {
  if (action === 'sleep') {
    // The game (and its session) carry on after waking.
    detached('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', SLEEP_SCRIPT])
    return
  }

  await finishAllSessions()

  if (action === 'quit') app.quit()
  else if (action === 'restart') detached('shutdown.exe', ['/r', '/t', '0'])
  else if (action === 'shutdown') detached('shutdown.exe', ['/s', '/t', '0'])
}
