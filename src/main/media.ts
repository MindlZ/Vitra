import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import script from './media.ps1?raw'
import type { MediaCommand, MediaState } from '../shared/types'

const COMMANDS: MediaCommand[] = ['toggle', 'next', 'previous']
const MAX_RESTARTS = 5

let child: ChildProcessWithoutNullStreams | undefined
let state: MediaState = { active: false }
let art: { key: string; url: string } | undefined
let restarts = 0
let stopping = false
const listeners = new Set<(state: MediaState) => void>()

function publish(next: MediaState): void {
  state = next
  for (const listener of listeners) listener(state)
}

function handle(line: string): void {
  let message: { type?: string } & Record<string, unknown>
  try {
    message = JSON.parse(line)
  } catch {
    return
  }

  if (message.type === 'art' && typeof message.key === 'string' && typeof message.art === 'string') {
    art = { key: message.key, url: message.art }
    if (state.artKey === art.key) publish({ ...state, art: art.url })
  } else if (message.type === 'state') {
    const { type: _type, ...rest } = message
    const next = rest as unknown as MediaState
    publish({ ...next, art: art && art.key === next.artKey ? art.url : undefined })
  } else if (message.type === 'error') {
    console.warn('[media] media session unavailable:', message.message)
  }
}

function start(): void {
  if (process.platform !== 'win32' || child || stopping) return

  // UTF-16LE base64: no quoting problems
  const encoded = Buffer.from(script, 'utf16le').toString('base64')
  const proc = spawn(
    'powershell.exe',
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
    { windowsHide: true }
  )
  child = proc

  let buffer = ''
  proc.stdout.setEncoding('utf8')
  proc.stdout.on('data', (chunk: string) => {
    buffer += chunk
    let index: number
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index).trim()
      buffer = buffer.slice(index + 1)
      if (line) handle(line)
    }
  })

  proc.stderr.setEncoding('utf8')
  proc.stderr.on('data', (chunk: string) => {
    // CLIXML progress records: noise
    const text = chunk.trim()
    if (text && !text.includes('CLIXML') && !text.startsWith('<Objs')) console.warn('[media]', text)
  })

  proc.on('error', (err) => console.warn('[media] could not start PowerShell:', err.message))
  proc.on('exit', () => {
    if (child === proc) child = undefined
    if (stopping || restarts >= MAX_RESTARTS) return
    restarts++
    setTimeout(start, 2000 * restarts)
  })
}

export function getMedia(): MediaState {
  start()
  return state
}

export function sendMediaCommand(command: MediaCommand): void {
  if (!COMMANDS.includes(command)) return
  start()
  child?.stdin.write(`${command}\n`)
}

export function onMediaChange(listener: (state: MediaState) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function stopMedia(): void {
  stopping = true
  // closing stdin ends the script's loop
  child?.stdin.end()
  child?.kill()
  child = undefined
}
