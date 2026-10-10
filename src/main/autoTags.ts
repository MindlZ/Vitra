import { getGame, getGames, getSettings, patchGame } from './store'
import { findSteamAppId, resolveAppInfo } from './scanners/steamStore'

// Steam's genre ids. Indie, Casual, Free to Play, Early Access and MMO left out:
// business models and vague labels, not what a game plays like
const GENRES: Record<string, string> = {
  '1': 'Action',
  '2': 'Strategy',
  '3': 'RPG',
  '9': 'Racing',
  '18': 'Sports',
  '25': 'Adventure',
  '28': 'Simulation'
}

// Steam's feature ids: 9 Co-op, 38 Online Co-op, 39 Shared/Split Screen Co-op;
// 1 Multi-player, 36 Online PvP, 49 PvP
const COOP = new Set(['9', '38', '39'])
const MULTIPLAYER = new Set(['1', '36', '49'])

const MAX_SEARCHES = 40
const SEARCH_GAP_MS = 250

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

function tagsFor(genres: string[], categories: string[]): string[] {
  const tags = genres.map((id) => GENRES[id]).filter((tag): tag is string => Boolean(tag))
  if (categories.some((id) => COOP.has(id))) tags.push('Co-op')
  if (categories.some((id) => MULTIPLAYER.has(id))) tags.push('Multiplayer')
  return tags
}

// once per game (autoTagged), so a tag the user removes stays removed. only Steam's
// own store data; a game Steam doesn't sell under the same title gets nothing
export async function autoTagGames(): Promise<boolean> {
  if (!getSettings().autoTags) return false
  const pending = getGames().filter((game) => !game.autoTagged && !game.software)
  if (!pending.length) return false

  const appIds = new Map<string, string>()
  const noMatch: string[] = []
  let searches = 0
  for (const game of pending) {
    if (game.steamAppId && /^\d+$/.test(game.steamAppId)) {
      appIds.set(game.id, game.steamAppId)
      continue
    }
    if (searches >= MAX_SEARCHES) continue
    searches++
    const id = await findSteamAppId(game.name)
    if (id) appIds.set(game.id, id)
    // undefined = failed; left for the next run
    else if (id === null) noMatch.push(game.id)
    await sleep(SEARCH_GAP_MS)
  }

  const info = await resolveAppInfo([...appIds.values()], true)
  let changed = false

  for (const id of noMatch) {
    if (getGame(id)) patchGame(id, { autoTagged: true })
    changed = true
  }

  for (const [gameId, appId] of appIds) {
    const entry = info.get(appId)
    // not fetched yet (rate limit, per-scan cap) or the lookup failed: try next run
    if (!entry?.genres || !entry.categories) continue
    // re-read: tags may have changed while we fetched
    const game = getGame(gameId)
    if (!game) continue
    const have = new Set(game.tags.map((tag) => tag.toLowerCase()))
    const added = tagsFor(entry.genres, entry.categories).filter((tag) => !have.has(tag.toLowerCase()))
    patchGame(gameId, { tags: [...game.tags, ...added], autoTagged: true })
    changed = true
  }
  return changed
}
