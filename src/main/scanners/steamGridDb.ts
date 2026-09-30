import { getSettings } from '../store'

const BASE = 'https://www.steamgriddb.com/api/v2'

interface GridResponse {
  success?: boolean
  data?: Array<{ url?: string; thumb?: string }> | { id?: number }
}

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

const QUERY: Record<GridKind, string> = {
  cover: '?dimensions=600x900&types=static&nsfw=false',
  hero: '?types=static&nsfw=false',
  logo: '?types=static&nsfw=false'
}

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
