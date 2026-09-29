import { getSettings } from '../store'

/**
 * SteamGridDB — the only source with art for Epic titles, non-Steam shortcuts
 * and local executables. Optional: it needs a free API key, so everything still
 * works without one, just with fewer covers.
 */
const BASE = 'https://www.steamgriddb.com/api/v2'

interface GridResponse {
  success?: boolean
  data?: Array<{ url?: string; thumb?: string }> | { id?: number }
}

/** Cache lookups for the lifetime of the process; a scan can ask repeatedly. */
const gameIdCache = new Map<string, number | null>()

async function request(path: string, key: string): Promise<GridResponse | null> {
  try {
    const response = await fetch(`${BASE}${path}`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(12_000)
    })
    if (!response.ok) return null
    return (await response.json()) as GridResponse
  } catch {
    return null
  }
}

/** Resolve a non-Steam title to a SteamGridDB game id by name. */
async function findGameIdByName(name: string, key: string): Promise<number | null> {
  const cached = gameIdCache.get(name)
  if (cached !== undefined) return cached

  const body = await request(`/search/autocomplete/${encodeURIComponent(name)}`, key)
  const list = Array.isArray(body?.data) ? body.data : []
  const first = list[0] as { id?: number } | undefined
  const id = typeof first?.id === 'number' ? first.id : null

  gameIdCache.set(name, id)
  return id
}

export type GridKind = 'cover' | 'hero' | 'logo'

const ENDPOINT: Record<GridKind, string> = {
  cover: 'grids',
  hero: 'heroes',
  logo: 'logos'
}

/** Portrait capsules only for covers — a wide grid would crop badly on a card. */
const QUERY: Record<GridKind, string> = {
  cover: '?dimensions=600x900&types=static&nsfw=false',
  hero: '?types=static&nsfw=false',
  logo: '?types=static&nsfw=false'
}

/**
 * Candidate image URLs, best first. Returns an empty list when no key is
 * configured, which is the normal case.
 */
export async function steamGridDbCandidates(
  kind: GridKind,
  game: { steamAppId?: string; name: string }
): Promise<string[]> {
  const key = getSettings().steamGridDbKey?.trim()
  if (!key) return []

  const path = game.steamAppId
    ? `/${ENDPOINT[kind]}/steam/${game.steamAppId}${QUERY[kind]}`
    : await (async () => {
        const id = await findGameIdByName(game.name, key)
        return id === null ? null : `/${ENDPOINT[kind]}/game/${id}${QUERY[kind]}`
      })()

  if (!path) return []

  const body = await request(path, key)
  if (!Array.isArray(body?.data)) return []

  return body.data
    .map((entry) => entry.url)
    .filter((url): url is string => typeof url === 'string')
    .slice(0, 3)
}
