import { app } from 'electron'
import { spawn } from 'child_process'
import { finishAllSessions } from './launch'
import type { PowerAction } from '../shared/types'

// shutdown /t 0 on purpose: any timeout > 0 implies /f, and 0 lets apps with
// unsaved work object

function detached(file: string, args: string[]): void {
  const child = spawn(file, args, { detached: true, stdio: 'ignore', windowsHide: true })
  child.on('error', (err) => console.error(`[power] ${file}:`, err.message))
  child.unref()
}

// not `rundll32 powrprof.dll,SetSuspendState`: that hibernates when hibernation is on
const SLEEP_SCRIPT =
  'Add-Type -AssemblyName System.Windows.Forms; ' +
  '[void][System.Windows.Forms.Application]::SetSuspendState([System.Windows.Forms.PowerState]::Suspend, $false, $false)'

export async function runPower(action: PowerAction): Promise<void> {
  if (action === 'sleep') {
    detached('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', SLEEP_SCRIPT])
    return
  }

  await finishAllSessions()

  if (action === 'quit') app.quit()
  else if (action === 'restart') detached('shutdown.exe', ['/r', '/t', '0'])
  else if (action === 'shutdown') detached('shutdown.exe', ['/s', '/t', '0'])
}
