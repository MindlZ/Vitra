import { app } from 'electron'
import { promises as fs } from 'fs'
import { join } from 'path'

export interface AppInfo {
  name?: string
  // "unknown" = the lookup failed
  type: string
  // absent on entries cached before genres were fetched
  genres?: string[]
  headerImage?: string
  capsuleImage?: string
  fetchedAt: number
}

type Cache = Record<string, AppInfo>

const CACHE_VERSION = 1
const UNKNOWN_TTL_MS = 7 * 24 * 60 * 60 * 1000
// unauthenticated endpoint, rate limits easily
const REQUEST_GAP_MS = 250
const MAX_PER_SCAN = 120

function cacheFile(): string {
  return join(app.getPath('userData'), 'steam-app-info.json')
}

let memo: Cache | undefined

async function loadCache(): Promise<Cache> {
  if (memo) return memo
  try {
    const parsed = JSON.parse(await fs.readFile(cacheFile(), 'utf8')) as {
      version?: number
      apps?: Cache
    }
    memo = parsed.version === CACHE_VERSION && parsed.apps ? parsed.apps : {}
  } catch {
    memo = {}
  }
  return memo
}

async function saveCache(apps: Cache): Promise<void> {
  memo = apps
  try {
    await fs.writeFile(cacheFile(), JSON.stringify({ version: CACHE_VERSION, apps }), 'utf8')
  } catch (err) {
    console.error('[steamStore] could not write cache:', err)
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

// null = rate limited, stop
async function fetchAppInfo(appId: string): Promise<AppInfo | null> {
  try {
    const response = await fetch(
      `https://store.steampowered.com/api/appdetails?appids=${appId}&filters=basic,genres`,
      { signal: AbortSignal.timeout(12_000) }
    )
    if (response.status === 429) return null
    if (!response.ok) return { type: 'unknown', fetchedAt: Date.now() }

    const body = (await response.json()) as Record<
      string,
      {
        success?: boolean
        data?: {
          type?: string
          name?: string
          header_image?: string
          capsule_image?: string
          genres?: Array<{ id?: string }>
        }
      }
    >
    const entry = body?.[appId]
    if (!entry?.success || !entry.data?.name) return { type: 'unknown', fetchedAt: Date.now() }

    return {
      name: entry.data.name,
      type: entry.data.type ?? 'unknown',
      genres: (entry.data.genres ?? []).map((genre) => String(genre.id)).filter(Boolean),
      headerImage: entry.data.header_image,
      capsuleImage: entry.data.capsule_image,
      fetchedAt: Date.now()
    }
  } catch {
    return { type: 'unknown', fetchedAt: Date.now() }
  }
}

export async function resolveAppInfo(
  appIds: string[],
  needGenres = false
): Promise<Map<string, AppInfo>> {
  const cache = await loadCache()
  const now = Date.now()

  const stale = (info: AppInfo | undefined): boolean =>
    !info ||
    (info.type === 'unknown' && now - info.fetchedAt > UNKNOWN_TTL_MS) ||
    (needGenres && info.type !== 'unknown' && !info.genres)

  const missing = [...new Set(appIds)].filter((id) => stale(cache[id])).slice(0, MAX_PER_SCAN)

  let fetched = 0
  for (const appId of missing) {
    const info = await fetchAppInfo(appId)
    if (!info) break
    cache[appId] = info
    fetched++
    await sleep(REQUEST_GAP_MS)
  }

  if (fetched) await saveCache(cache)

  const result = new Map<string, AppInfo>()
  for (const appId of appIds) {
    const info = cache[appId]
    if (info) result.set(appId, info)
  }
  return result
}

// never fetches
export async function cachedAppInfo(appId: string): Promise<AppInfo | undefined> {
  return (await loadCache())[appId]
}
