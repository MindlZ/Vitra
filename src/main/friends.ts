import { getSettings } from './store'
import { findSteamAccount } from './scanners/steamUser'
import type { Friend, FriendsSnapshot, FriendState } from '../shared/types'

const API = 'https://api.steampowered.com'
/** GetPlayerSummaries takes at most 100 ids per call. */
const BATCH = 100
/** Steam's own client refreshes on roughly this cadence; no reason to beat it. */
const CACHE_MS = 45_000

/** personastate values, in the order Steam documents them. */
const STATES: FriendState[] = ['offline', 'online', 'busy', 'away', 'snooze', 'trading', 'playing']

/** Sort weight — who you'd actually want to see first. */
const PRIORITY: Record<FriendState, number> = {
  playing: 0,
  online: 1,
  trading: 2,
  busy: 3,
  away: 4,
  snooze: 5,
  offline: 6
}

interface SummaryPlayer {
  steamid?: string
  personaname?: string
  avatarmedium?: string
  avatarfull?: string
  personastate?: number
  gameextrainfo?: string
  gameid?: string
  profileurl?: string
}

let cache: FriendsSnapshot | undefined

function snapshot(
  status: FriendsSnapshot['status'],
  message?: string,
  friends: Friend[] = [],
  offline: Friend[] = []
): FriendsSnapshot {
  return { status, message, friends, offline, offlineCount: offline.length, fetchedAt: Date.now() }
}

async function getJson<T>(url: string): Promise<{ ok: boolean; status: number; body?: T }> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(12_000) })
    if (!response.ok) return { ok: false, status: response.status }
    return { ok: true, status: response.status, body: (await response.json()) as T }
  } catch {
    return { ok: false, status: 0 }
  }
}

async function fetchSnapshot(): Promise<FriendsSnapshot> {
  const settings = getSettings()
  const key = settings.steamWebApiKey?.trim()
  if (!key) {
    return snapshot('no-key', 'Add a Steam Web API key in Settings to see who is online.')
  }

  const account = await findSteamAccount(settings.steamPath)
  if (!account) {
    return snapshot('no-account', 'Could not work out which Steam account is signed in.')
  }

  const list = await getJson<{ friendslist?: { friends?: Array<{ steamid?: string }> } }>(
    `${API}/ISteamUser/GetFriendList/v1/?key=${encodeURIComponent(key)}&steamid=${account.steamId}&relationship=friend`
  )

  if (!list.ok) {
    // Valve returns 401 both for a bad key and for a private friends list.
    if (list.status === 401 || list.status === 403) {
      return snapshot(
        'private',
        'Steam refused the request. Check the API key, and that your friends list is set to public.'
      )
    }
    return snapshot('error', 'Could not reach the Steam Web API.')
  }

  const ids = (list.body?.friendslist?.friends ?? [])
    .map((friend) => friend.steamid)
    .filter((id): id is string => Boolean(id))

  if (!ids.length) return snapshot('ok')

  const players: SummaryPlayer[] = []
  for (let i = 0; i < ids.length; i += BATCH) {
    const batch = ids.slice(i, i + BATCH).join(',')
    const summaries = await getJson<{ response?: { players?: SummaryPlayer[] } }>(
      `${API}/ISteamUser/GetPlayerSummaries/v2/?key=${encodeURIComponent(key)}&steamids=${batch}`
    )
    if (summaries.ok) players.push(...(summaries.body?.response?.players ?? []))
  }

  const friends: Friend[] = []
  const offline: Friend[] = []

  for (const player of players) {
    if (!player.steamid) continue
    const base = STATES[player.personastate ?? 0] ?? 'offline'
    // In-game beats whatever presence state Steam reports alongside it.
    const state: FriendState = player.gameextrainfo ? 'playing' : base

    const friend: Friend = {
      steamId: player.steamid,
      name: player.personaname ?? 'Unknown',
      avatar: player.avatarfull ?? player.avatarmedium,
      state,
      playing: player.gameextrainfo,
      playingAppId: player.gameid && /^\d+$/.test(player.gameid) ? player.gameid : undefined,
      profileUrl: player.profileurl
    }
    // Offline friends are kept so Home can still show who you know when
    // nobody is around.
    if (state === 'offline') offline.push(friend)
    else friends.push(friend)
  }

  friends.sort(
    (a, b) => PRIORITY[a.state] - PRIORITY[b.state] || a.name.localeCompare(b.name)
  )
  offline.sort((a, b) => a.name.localeCompare(b.name))

  return snapshot('ok', undefined, friends, offline)
}

/** Cached so an open panel polling every minute doesn't hammer the API. */
export async function getFriends(force = false): Promise<FriendsSnapshot> {
  if (!force && cache && Date.now() - cache.fetchedAt < CACHE_MS) return cache
  cache = await fetchSnapshot()
  return cache
}

/** Called when the API key changes, so the next read isn't a stale failure. */
export function invalidateFriends(): void {
  cache = undefined
}
