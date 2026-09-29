import { existsSync } from 'fs'
import { basename } from 'path'
import { gogGalaxyDb, runCommand } from '../paths'
import type { Game } from '../../shared/types'

/*
 * GOG, from two local sources:
 *
 *  - The registry (HKLM\SOFTWARE\WOW6432Node\GOG.com\Games\<id>), written by
 *    both Galaxy and the offline installers: what's installed and its exe.
 *    GOG games are DRM-free, so they launch straight from the exe.
 *  - GOG Galaxy 2's SQLite database: the owned library, titles and art URLs.
 *    Read with Node's built-in node:sqlite (no native module); absent if
 *    Galaxy was never installed, in which case we only know what's on disk.
 */

const REGISTRY_KEY = 'HKLM\\SOFTWARE\\WOW6432Node\\GOG.com\\Games'

interface Installed {
  id: string
  name: string
  exe: string
  args?: string
  dir?: string
}

interface Owned {
  id: string
  title: string
  cover?: string
  hero?: string
  dlcs: string[]
}

/** One `reg query /s` for every game, rather than a subprocess per value. */
async function readRegistry(): Promise<Installed[]> {
  const stdout = await runCommand('reg', ['query', REGISTRY_KEY, '/s'])
  const games: Installed[] = []
  // Blocks start with the full key path; values follow, indented.
  for (const block of stdout.split(/\r?\n(?=HKEY_)/)) {
    const values: Record<string, string> = {}
    for (const line of block.split(/\r?\n/)) {
      const match = line.match(/^\s+(\S+)\s+REG_\w+\s*(.*)$/)
      if (match) values[match[1].toLowerCase()] = match[2].trim()
    }
    const id = values.gameid
    // dependsOn names the base game: this entry is DLC.
    if (!id || !values.exe || values.dependson) continue
    games.push({
      id,
      name: values.gamename || basename(values.exe),
      exe: values.exe,
      args: values.launchparam || undefined,
      dir: values.path || values.workingdir || undefined
    })
  }
  return games
}

interface SqliteModule {
  DatabaseSync: new (
    path: string,
    options?: { readOnly?: boolean }
  ) => {
    prepare(sql: string): { all(): Array<Record<string, unknown>> }
    close(): void
  }
}

/** Galaxy stores these pieces as small JSON objects, e.g. {"title":"…"}. */
function parse<T>(value: unknown): T | undefined {
  if (typeof value !== 'string') return undefined
  try {
    return JSON.parse(value) as T
  } catch {
    return undefined
  }
}

const piece = (type: string): string =>
  `(SELECT gp.value FROM GamePieces gp JOIN GamePieceTypes t ON t.id = gp.gamePieceTypeId
     WHERE gp.releaseKey = r.releaseKey AND t.type = '${type}' LIMIT 1)`

function readGalaxy(): Owned[] {
  const file = gogGalaxyDb()
  if (!existsSync(file)) return []
  // Loaded at runtime rather than imported: the bundler doesn't know node:sqlite.
  const moduleId: string = 'node:sqlite'
  const sqlite = process.getBuiltinModule?.(moduleId) as unknown as SqliteModule | undefined
  if (!sqlite) return []

  const db = new sqlite.DatabaseSync(file, { readOnly: true })
  try {
    // Only text columns: Galaxy's user ids overflow a JS number and would throw.
    // The library also holds releases imported from other stores (steam_…).
    const rows = db
      .prepare(
        `SELECT r.releaseKey AS releaseKey,
                ${piece('title')} AS title,
                ${piece('originalImages')} AS images,
                ${piece('dlcs')} AS dlcs
           FROM (SELECT DISTINCT releaseKey FROM LibraryReleases
                  WHERE substr(releaseKey, 1, 4) = 'gog_') r`
      )
      .all()

    return rows.flatMap((row) => {
      const title = parse<{ title?: string }>(row.title)?.title
      if (!title) return []
      const images = parse<{ verticalCover?: string; background?: string }>(row.images)
      return [
        {
          id: String(row.releaseKey).slice(4),
          title,
          cover: images?.verticalCover,
          hero: images?.background,
          dlcs: (parse<{ dlcs?: string[] }>(row.dlcs)?.dlcs ?? []).map((key) => key.slice(4))
        }
      ]
    })
  } finally {
    db.close()
  }
}

/** GOG files older packages as "Elder Scrolls IV, The"; read it the normal way round. */
function tidyTitle(title: string): string {
  return title.replace(/^(.*), (The|A|An)$/, '$2 $1').trim()
}

function gogGame(id: string, name: string, installed: boolean): Game {
  return {
    id: `gog:${id}`,
    name,
    source: 'gog',
    // Opens Galaxy on the game's page, where it can be installed.
    launchUri: `goggalaxy://openGameView/${id}`,
    processHints: [],
    tags: [],
    favorite: false,
    hidden: false,
    installed,
    playtimeSeconds: 0,
    sessions: 0,
    addedAt: Date.now()
  }
}

export async function scanGog(): Promise<{ games: Game[]; owned: number; errors: string[] }> {
  const errors: string[] = []
  const installed = await readRegistry()

  let library: Owned[] = []
  try {
    library = readGalaxy()
  } catch (err) {
    // Locked mid-write or a schema change: the installed games still count.
    errors.push(`GOG Galaxy library: ${(err as Error).message}`)
  }

  if (!installed.length && !library.length) return { games: [], owned: 0, errors }

  const byId = new Map(library.map((entry) => [entry.id, entry]))
  const dlcIds = new Set(library.flatMap((entry) => entry.dlcs))
  const games: Game[] = []
  // GOG can list one game under two products (an old and a current package);
  // one card per title is what a person expects.
  const titles = new Set<string>()

  for (const entry of installed) {
    const listed = byId.get(entry.id)
    const game = gogGame(entry.id, entry.name, true)
    game.exePath = entry.exe
    game.args = entry.args
    game.installDir = entry.dir
    game.processHints = [basename(entry.exe).toLowerCase()]
    game.coverUrl = listed?.cover
    game.heroUrl = listed?.hero
    games.push(game)
    titles.add(tidyTitle(listed?.title ?? entry.name).toLowerCase())
  }

  const installedIds = new Set(installed.map((entry) => entry.id))
  let owned = 0
  for (const entry of library) {
    if (installedIds.has(entry.id) || dlcIds.has(entry.id)) continue
    const title = tidyTitle(entry.title)
    if (titles.has(title.toLowerCase())) continue
    titles.add(title.toLowerCase())

    const game = gogGame(entry.id, title, false)
    game.coverUrl = entry.cover
    game.heroUrl = entry.hero
    games.push(game)
    owned++
  }

  return { games, owned, errors }
}
