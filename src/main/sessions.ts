import { app } from 'electron'
import { promises as fs } from 'fs'
import { join } from 'path'
import type { PlaySession } from '../shared/types'

// own file: append-only, and library.json gets rewritten on every patch.
// only tracked sessions; seeded Steam hours have no dates

interface SessionFile {
  version: 1
  sessions: PlaySession[]
}

let sessions: PlaySession[] = []
let loaded: Promise<void> | undefined
let writeQueue: Promise<void> = Promise.resolve()

function file(): string {
  return join(app.getPath('userData'), 'sessions.json')
}

function ensureLoaded(): Promise<void> {
  loaded ??= (async () => {
    try {
      const parsed = JSON.parse(await fs.readFile(file(), 'utf8')) as Partial<SessionFile>
      sessions = (parsed.sessions ?? []).filter(
        (s) => typeof s.gameId === 'string' && typeof s.start === 'number' && typeof s.end === 'number'
      )
    } catch {
      sessions = []
    }
  })()
  return loaded
}

function save(): Promise<void> {
  writeQueue = writeQueue.then(async () => {
    const tmp = `${file()}.tmp`
    const body: SessionFile = { version: 1, sessions }
    await fs.writeFile(tmp, JSON.stringify(body), 'utf8')
    await fs.rename(tmp, file())
  })
  return writeQueue.catch((err) => console.error('[sessions] save failed:', err))
}

export async function recordSession(session: PlaySession): Promise<void> {
  await ensureLoaded()
  sessions.push(session)
  await save()
}

export async function getSessions(): Promise<PlaySession[]> {
  await ensureLoaded()
  return sessions
}

export async function replaceSessions(next: PlaySession[]): Promise<void> {
  await ensureLoaded()
  sessions = next
  await save()
}
