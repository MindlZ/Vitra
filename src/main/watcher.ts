import { promises as fs, type Dirent } from 'fs'
import { basename, join } from 'path'
import { runCommand } from './paths'
import type { Game } from '../shared/types'

/** Helpers, prereq installers and crash handlers that ship next to games. */
const EXE_BLACKLIST = [
  /crash/i,
  /^unins/i,
  /vcredist/i,
  /dxsetup|directx/i,
  /dotnet|netfx/i,
  /prereq/i,
  /redist/i,
  /^setup/i,
  /install/i,
  /easyanticheat/i,
  /battleye|beservice/i,
  /epicwebhelper/i,
  /notification_helper/i,
  /crashpad/i,
  /^7za?\.exe$/i,
  /steamworks|steam_api/i,
  /^touchup/i,
  /benchmark/i,
  /config(uration)?(tool)?\.exe$/i
]

const DIR_SKIPLIST = [
  /^_?commonredist$/i,
  /^redist(ributable)?s?$/i,
  /^directx$/i,
  /^engine$/i,
  /^dotnet/i,
  /^prereq/i,
  /^support$/i,
  /^tools?$/i
]

function isPlausibleGameExe(name: string): boolean {
  return name.toLowerCase().endsWith('.exe') && !EXE_BLACKLIST.some((re) => re.test(name))
}

/** Bounded recursive walk — game folders can be enormous. */
async function findExecutables(root: string, maxDepth = 4, budget = 4000): Promise<string[]> {
  const found: string[] = []
  let visited = 0

  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > maxDepth || visited > budget) return
    let entries: Dirent[]
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    const subdirs: string[] = []
    for (const entry of entries) {
      if (visited++ > budget) return
      if (entry.isDirectory()) {
        if (!DIR_SKIPLIST.some((re) => re.test(entry.name))) subdirs.push(join(dir, entry.name))
      } else if (isPlausibleGameExe(entry.name)) {
        found.push(join(dir, entry.name))
      }
    }
    for (const sub of subdirs) await walk(sub, depth + 1)
  }

  await walk(root, 0)
  return found
}

function similarity(exe: string, title: string): number {
  const normalise = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '')
  const a = normalise(basename(exe, '.exe'))
  const b = normalise(title)
  if (!a || !b) return 0
  if (a === b) return 100
  if (b.startsWith(a) || a.startsWith(b)) return 70
  if (b.includes(a) || a.includes(b)) return 50
  return 0
}

/**
 * Work out which process names mean "this game is running".
 * Prefers hints the store already has (Epic gives them to us outright).
 */
export async function resolveProcessHints(game: Game): Promise<string[]> {
  if (game.processHints?.length) return game.processHints

  const hints = new Set<string>()
  if (game.exePath) hints.add(basename(game.exePath).toLowerCase())

  const installDir = game.installDir
  if (installDir) {
    const executables = await findExecutables(installDir)
    const ranked = executables
      .map((exe) => ({
        exe,
        score:
          similarity(exe, game.name) +
          (/[\\/]Binaries[\\/]Win64[\\/]/i.test(exe) ? 30 : 0) +
          (/[\\/]bin(aries)?[\\/]/i.test(exe) ? 10 : 0) +
          // An exe sitting in the install root is usually the entry point.
          (exe.toLowerCase() === join(installDir, basename(exe)).toLowerCase() ? 15 : 0)
      }))
      .sort((a, b) => b.score - a.score)

    // A strong title match is trustworthy on its own; otherwise keep a few.
    const strong = ranked.filter((r) => r.score >= 70)
    for (const { exe } of (strong.length ? strong : ranked).slice(0, 6)) {
      hints.add(basename(exe).toLowerCase())
    }
  }

  return [...hints]
}

export async function listRunningProcesses(): Promise<Set<string>> {
  const stdout = await runCommand('tasklist', ['/fo', 'csv', '/nh'], 15_000)
  const names = new Set<string>()
  for (const line of stdout.split(/\r?\n/)) {
    const match = line.match(/^"([^"]+)"/)
    if (match) names.add(match[1].toLowerCase())
  }
  return names
}

export interface SessionOutcome {
  /** Seconds the game process was alive. 0 when we never saw it. */
  seconds: number
  confirmed: boolean
}

export interface WatchOptions {
  pollMs?: number
  /** How long to wait for the game process to appear before giving up. */
  graceMs?: number
  onConfirmed?: () => void
  signal?: { cancelled: boolean }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Poll the process list until the game appears and then exits.
 * Needed because Steam/Epic games are started via URI, so we never own the
 * process and can't just wait on a child handle.
 */
export async function watchSession(
  hints: string[],
  options: WatchOptions = {}
): Promise<SessionOutcome> {
  const pollMs = options.pollMs ?? 4000
  const graceMs = options.graceMs ?? 180_000
  if (!hints.length) return { seconds: 0, confirmed: false }

  const wanted = new Set(hints.map((h) => h.toLowerCase()))
  const isRunning = async (): Promise<boolean> => {
    const running = await listRunningProcesses()
    for (const name of wanted) if (running.has(name)) return true
    return false
  }

  const waitStarted = Date.now()
  let startedAt = 0
  while (Date.now() - waitStarted < graceMs) {
    if (options.signal?.cancelled) return { seconds: 0, confirmed: false }
    if (await isRunning()) {
      startedAt = Date.now()
      options.onConfirmed?.()
      break
    }
    await sleep(pollMs)
  }
  if (!startedAt) return { seconds: 0, confirmed: false }

  // Require two consecutive empty polls so a brief launcher hand-off (bootstrapper
  // exits, real game starts) doesn't end the session early.
  let misses = 0
  while (misses < 2) {
    await sleep(pollMs)
    if (options.signal?.cancelled) break
    misses = (await isRunning()) ? 0 : misses + 1
  }

  const seconds = Math.max(0, Math.round((Date.now() - startedAt) / 1000) - (pollMs / 1000) * 2)
  return { seconds, confirmed: true }
}
