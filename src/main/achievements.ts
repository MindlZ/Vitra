import { getGame, getSettings } from './store'
import { getJson } from './friends'
import { findSteamAccount } from './scanners/steamUser'
import type { Achievement, AchievementSummary } from '../shared/types'

// GetPlayerAchievements 403s unless the profile's game details are public.
// the global percentages call needs no key

const API = 'https://api.steampowered.com'
const CACHE_MS = 10 * 60_000
const cache = new Map<string, AchievementSummary>()

interface PlayerAchievement {
  apiname?: string
  achieved?: number
  unlocktime?: number
}

interface SchemaAchievement {
  name?: string
  displayName?: string
  description?: string
  icon?: string
  hidden?: number
}

function summary(status: AchievementSummary['status']): AchievementSummary {
  return { status, unlocked: 0, total: 0, rarest: [], fetchedAt: Date.now() }
}

async function fetchSummary(appId: string, key: string, steamId: string): Promise<AchievementSummary> {
  const [player, schema, global] = await Promise.all([
    getJson<{ playerstats?: { success?: boolean; achievements?: PlayerAchievement[] } }>(
      `${API}/ISteamUserStats/GetPlayerAchievements/v1/?key=${encodeURIComponent(key)}&steamid=${steamId}&appid=${appId}`
    ),
    getJson<{ game?: { availableGameStats?: { achievements?: SchemaAchievement[] } } }>(
      `${API}/ISteamUserStats/GetSchemaForGame/v2/?key=${encodeURIComponent(key)}&appid=${appId}`
    ),
    getJson<{ achievementpercentages?: { achievements?: Array<{ name?: string; percent?: number | string }> } }>(
      `${API}/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2/?gameid=${appId}`
    )
  ])

  const defined = schema.body?.game?.availableGameStats?.achievements ?? []
  // no achievements = the player call 400s; not an error
  if (!defined.length) return summary('none')
  if (!player.ok) return summary(player.status === 403 || player.status === 401 ? 'private' : 'error')

  const unlocked = new Map<string, number>()
  for (const entry of player.body?.playerstats?.achievements ?? []) {
    if (entry.apiname && entry.achieved) unlocked.set(entry.apiname, entry.unlocktime ?? 0)
  }
  const percents = new Map<string, number>()
  for (const entry of global.body?.achievementpercentages?.achievements ?? []) {
    const percent = Number(entry.percent)
    if (entry.name && Number.isFinite(percent)) percents.set(entry.name, percent)
  }

  const rarest: Achievement[] = defined
    .filter((entry) => entry.name && unlocked.has(entry.name))
    .map((entry) => ({
      name: entry.displayName || entry.name!,
      description: entry.description || undefined,
      icon: entry.icon?.startsWith('https://') ? entry.icon : undefined,
      percent: percents.get(entry.name!),
      unlockedAt: (unlocked.get(entry.name!) ?? 0) * 1000 || undefined
    }))
    .sort((a, b) => (a.percent ?? 100) - (b.percent ?? 100))
    .slice(0, 3)

  return { status: 'ok', unlocked: unlocked.size, total: defined.length, rarest, fetchedAt: Date.now() }
}

export async function getAchievements(gameId: string): Promise<AchievementSummary> {
  const appId = getGame(gameId)?.steamAppId
  if (!appId || !/^\d+$/.test(appId)) return summary('none')
  const key = getSettings().steamWebApiKey?.trim()
  if (!key) return summary('no-key')

  const cached = cache.get(appId)
  if (cached && Date.now() - cached.fetchedAt < CACHE_MS) return cached

  const account = await findSteamAccount(getSettings().steamPath)
  if (!account) return summary('error')
  const result = await fetchSummary(appId, key, account.steamId)
  // failures not cached: a fixed privacy setting shows next open
  if (result.status === 'ok' || result.status === 'none') cache.set(appId, result)
  return result
}

export function clearAchievements(): void {
  cache.clear()
}
