import { createConnection, type Socket } from 'net'
import { randomUUID } from 'crypto'
import { runningStates } from './launch'
import { getGame, getSettings } from './store'
import type { Game } from '../shared/types'

/*
 * Discord Rich Presence: while a game Vitra is tracking is running, your
 * Discord status shows it ("Playing Vitra", the game's name, time played,
 * its cover). Off by default (Settings → Connections).
 *
 * Talks to the Discord desktop app over its local pipe, never the network:
 * \\?\pipe\discord-ipc-N, frames of [opcode int32 LE][length int32 LE][JSON].
 * Connected only while there's something to show; closing the pipe is what
 * clears the status. If Discord isn't running it retries quietly.
 */

/**
 * The Discord application Vitra presents as, from discord.com/developers
 * (its name is the "Playing …" line; upload the logo as an art asset named
 * "vitra"). An id, not a secret. Empty turns the feature off.
 */
export const DISCORD_CLIENT_ID = '1554504910563844198'

const OP_HANDSHAKE = 0
const OP_FRAME = 1
const OP_CLOSE = 2
const OP_PING = 3
const OP_PONG = 4

const RETRY_MS = 15_000
const STEAM_CDN = 'https://cdn.cloudflare.steamstatic.com/steam/apps'

interface Activity {
  details: string
  state?: string
  timestamps: { start: number }
  assets: { large_image: string; large_text: string; small_image?: string; small_text?: string }
  instance: boolean
}

let socket: Socket | undefined
let ready = false
let connecting = false
let retryTimer: NodeJS.Timeout | undefined
/** What should be showing; null = nothing. */
let wanted: Activity | null = null
/** What Discord was last told, to skip repeats. */
let sent = ''

export function discordConfigured(): boolean {
  return DISCORD_CLIENT_ID.length > 0
}

function frame(op: number, payload: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(payload), 'utf8')
  const header = Buffer.alloc(8)
  header.writeInt32LE(op, 0)
  header.writeInt32LE(body.length, 4)
  return Buffer.concat([header, body])
}

/** Discord wants 2–128 characters. */
function fit(text: string): string {
  const trimmed = text.trim().slice(0, 128)
  return trimmed.length >= 2 ? trimmed : `${trimmed}  `
}

/**
 * A public URL Discord can fetch for the cover: Steam's header (the one
 * capsule every app has), else a remote cover the scanner found. Local-only
 * art can't be shown, so those fall back to Vitra's own logo.
 */
function coverFor(game: Game): string | undefined {
  if (game.steamAppId) return `${STEAM_CDN}/${game.steamAppId}/header.jpg`
  if (game.coverUrl?.startsWith('https://')) return game.coverUrl
  return undefined
}

function activityFor(game: Game, startedAt: number): Activity {
  const cover = coverFor(game)
  return {
    details: fit(game.name),
    state: 'Launched from Vitra',
    timestamps: { start: startedAt },
    assets: cover
      ? { large_image: cover, large_text: game.name, small_image: 'vitra', small_text: 'Vitra' }
      : { large_image: 'vitra', large_text: game.name },
    instance: false
  }
}

function send(): void {
  if (!socket || !ready || !wanted) return
  const key = JSON.stringify(wanted)
  if (key === sent) return
  sent = key
  socket.write(
    frame(OP_FRAME, {
      cmd: 'SET_ACTIVITY',
      args: { pid: process.pid, activity: wanted },
      nonce: randomUUID()
    })
  )
}

function disconnect(): void {
  clearTimeout(retryTimer)
  retryTimer = undefined
  socket?.destroy()
  socket = undefined
  ready = false
  sent = ''
}

function scheduleRetry(): void {
  if (retryTimer || !wanted) return
  retryTimer = setTimeout(() => {
    retryTimer = undefined
    sync()
  }, RETRY_MS)
}

/** Discord listens on the first free of discord-ipc-0…9. */
function openPipe(index: number): Promise<Socket | undefined> {
  return new Promise((resolve) => {
    const pipe = createConnection(`\\\\?\\pipe\\discord-ipc-${index}`)
    const fail = (): void => {
      pipe.destroy()
      resolve(undefined)
    }
    pipe.once('error', fail)
    pipe.once('connect', () => {
      pipe.off('error', fail)
      resolve(pipe)
    })
  })
}

function listen(pipe: Socket): void {
  let buffer = Buffer.alloc(0)

  pipe.on('data', (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk])
    while (buffer.length >= 8) {
      const op = buffer.readInt32LE(0)
      const length = buffer.readInt32LE(4)
      if (buffer.length < 8 + length) break
      const body = buffer.subarray(8, 8 + length)
      buffer = buffer.subarray(8 + length)

      let message: { evt?: string; data?: { message?: string } } = {}
      try {
        message = JSON.parse(body.toString('utf8'))
      } catch {
        // Not ours to understand; skip it.
      }

      if (op === OP_PING) pipe.write(frame(OP_PONG, message))
      else if (op === OP_CLOSE) pipe.destroy()
      else if (op === OP_FRAME && message.evt === 'READY') {
        ready = true
        send()
      } else if (op === OP_FRAME && message.evt === 'ERROR') {
        console.warn('[discord]', message.data?.message)
      }
    }
  })

  const lost = (): void => {
    if (socket !== pipe) return
    socket = undefined
    ready = false
    sent = ''
    scheduleRetry()
  }
  pipe.on('close', lost)
  pipe.on('error', lost)
}

async function connect(): Promise<void> {
  connecting = true
  try {
    for (let index = 0; index < 10; index++) {
      const pipe = await openPipe(index)
      if (!pipe) continue
      // Turned off, or the game closed, while we were looking.
      if (!wanted) {
        pipe.destroy()
        return
      }
      socket = pipe
      listen(pipe)
      pipe.write(frame(OP_HANDSHAKE, { v: 1, client_id: DISCORD_CLIENT_ID }))
      return
    }
    // Discord isn't running.
    scheduleRetry()
  } finally {
    connecting = false
  }
}

function sync(): void {
  if (!wanted) {
    disconnect()
    return
  }
  if (socket) send()
  else if (!connecting) void connect()
}

/**
 * Re-read what should be showing: the first game that's actually running
 * (its process seen, not just launched), if the setting is on.
 */
export function updatePresence(): void {
  const on = getSettings().discordPresence && discordConfigured()
  const session = on ? runningStates().find((state) => state.confirmed) : undefined
  const game = session ? getGame(session.gameId) : undefined
  wanted = session && game ? activityFor(game, session.startedAt) : null
  sync()
}

export function stopPresence(): void {
  wanted = null
  disconnect()
}
