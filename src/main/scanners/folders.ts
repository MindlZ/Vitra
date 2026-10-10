import { createHash } from 'crypto'
import { promises as fs } from 'fs'
import { basename, dirname, join } from 'path'
import { guessGameNames, tidyFolderName } from '../gameName'
import { findExecutables, similarity } from '../watcher'
import type { Game } from '../../shared/types'

// launcher libraries and installers have their own scanners, or aren't games
const SKIP_DIRS =
  /^(_?commonredist|redist.*|steamlibrary|steamapps|steam|epic games|gog galaxy|xboxgames|ubisoft.*|ea games|ea app|electronic arts|riot games|battle\.net|origin games|\$recycle\.bin|system volume information)$/i

const LAUNCHER_EXE = /launcher|setup|unins|config|settings|report|helper|update/i

function normalise(path: string): string {
  return path.toLowerCase().replace(/[\\/]+$/, '')
}

function within(path: string, dir: string): boolean {
  return path === dir || path.startsWith(dir + '\\') || path.startsWith(dir + '/')
}

export function localGameId(exePath: string): string {
  return `local:${createHash('sha1').update(normalise(exePath)).digest('hex').slice(0, 16)}`
}

// a drive-root "Games"/"Game" folder on any drive
export async function detectGameFolders(): Promise<string[]> {
  const found: string[] = []
  for (const letter of 'CDEFGHIJKLMNOPQRSTUVWXYZ') {
    const root = `${letter}:\\`
    let entries: string[]
    try {
      entries = await fs.readdir(root)
    } catch {
      continue
    }
    for (const name of entries) {
      if (/^games?$/i.test(name)) found.push(join(root, name))
    }
  }
  return found
}

async function fileSize(path: string): Promise<number> {
  try {
    return (await fs.stat(path)).size
  } catch {
    return 0
  }
}

// the exe a player would double-click: named like the folder, near the top, the biggest
async function mainExe(dir: string, title: string): Promise<string | undefined> {
  const exes = await findExecutables(dir, 4, 3000)
  if (!exes.length) return undefined
  const sizes = await Promise.all(exes.map(fileSize))
  const largest = Math.max(...sizes)

  const ranked = exes
    .map((exe, i) => {
      const depth = exe.slice(dir.length).split(/[\\/]/).length - 2
      return {
        exe,
        score:
          similarity(exe, title) +
          (depth === 0 ? 20 : 0) -
          depth * 3 +
          (sizes[i] === largest ? 15 : 0) +
          (/-win64-shipping\.exe$/i.test(exe) ? 10 : 0) -
          (LAUNCHER_EXE.test(basename(exe)) ? 40 : 0) -
          // tiny stubs: crash handlers, bootstrap helpers
          (sizes[i] < 200_000 ? 30 : 0)
      }
    })
    .sort((a, b) => b.score - a.score)

  return ranked[0].score > -20 ? ranked[0].exe : undefined
}

// known: every game already in the library or found by another scanner, so nothing doubles up
export async function scanGameFolders(
  roots: string[],
  known: Game[],
  dismissed: string[]
): Promise<{ games: Game[]; errors: string[] }> {
  const errors: string[] = []
  const knownDirs = known.flatMap((game) =>
    [game.installDir, game.exePath && dirname(game.exePath)].filter((d): d is string => Boolean(d)).map(normalise)
  )
  const knownIds = new Set(known.map((game) => game.id))
  const skipped = new Set(dismissed.map(normalise))

  const candidates: Array<{ dir: string; title: string }> = []
  for (const root of roots) {
    // a game whose exe sits in the root itself (or higher) would otherwise cover every folder
    const nearby = knownDirs.filter((known) => !within(normalise(root), known))
    let entries
    try {
      entries = await fs.readdir(root, { withFileTypes: true })
    } catch {
      errors.push(`Game folder not found: ${root}`)
      continue
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || SKIP_DIRS.test(entry.name)) continue
      const dir = join(root, entry.name)
      const key = normalise(dir)
      // a store's game, or a folder holding one
      if (nearby.some((known) => within(known, key) || within(key, known))) continue
      candidates.push({ dir, title: tidyFolderName(entry.name) })
    }
  }

  const found: Array<{ dir: string; folder: string; exe: string }> = []
  await Promise.all(
    candidates.map(async ({ dir, title }) => {
      const exe = await mainExe(dir, title)
      if (!exe || skipped.has(normalise(exe)) || knownIds.has(localGameId(exe))) return
      found.push({ dir, folder: basename(dir), exe })
    })
  )

  const names = await guessGameNames(found.map(({ exe, folder }) => ({ exePath: exe, folder })))
  const games = found.map(
    ({ dir, exe }, i): Game => ({
      id: localGameId(exe),
      name: names[i],
      source: 'manual',
      exePath: exe,
      installDir: dir,
      processHints: [basename(exe).toLowerCase()],
      tags: [],
      favorite: false,
      hidden: false,
      installed: true,
      playtimeSeconds: 0,
      sessions: 0,
      addedAt: Date.now(),
      autoName: true
    })
  )
  return { games, errors }
}
