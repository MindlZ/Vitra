import { shell } from 'electron'
import { getGames, getSettings } from './store'
import { launchGame, runningStates } from './launch'
import { findSteamAccount } from './scanners/steamUser'
import { fetchXboxFriends } from './friendsXbox'
import type { Friend, FriendsSnapshot, FriendState } from '../shared/types'

const API = 'https://api.steampowered.com'
// GetPlayerSummaries max ids per call
const BATCH = 100
const CACHE_MS = 45_000
// OpenXBL free tier is 150 req/hour
const XBOX_CACHE_MS = 120_000

// personastate, in Steam's order
const STATES: FriendState[] = ['offline', 'online', 'busy', 'away', 'snooze', 'trading', 'playing']

export const PRIORITY: Record<FriendState, number> = {
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
  lobbysteamid?: string
  // "0.0.0.0:0" = none
  gameserverip?: string
  profileurl?: string
}

// kept main-side: the renderer names a friend, never a URI
const joinTargets = new Map<string, { uri: string; appId: string }>()

function joinTarget(player: SummaryPlayer, appId: string | undefined): string | undefined {
  if (!appId || !player.steamid) return undefined
  if (player.lobbysteamid && /^\d+$/.test(player.lobbysteamid) && player.lobbysteamid !== '0') {
    return `steam://joinlobby/${appId}/${player.lobbysteamid}/${player.steamid}`
  }
  const server = player.gameserverip
  if (server && /^\d{1,3}(\.\d{1,3}){3}:\d{1,5}$/.test(server) && !server.startsWith('0.0.0.0')) {
    return `steam://connect/${server}`
  }
  return undefined
}

export async function joinFriend(id: string): Promise<{ ok: boolean; error?: string }> {
  const target = joinTargets.get(id)
  if (!target) return { ok: false, error: 'Nothing to join right now.' }
  const game = getGames().find(
    (candidate) => candidate.source === 'steam' && candidate.steamAppId === target.appId && candidate.installed
  )
  const running = game && runningStates().some((state) => state.gameId === game.id)
  if (game && !running) return launchGame(game.id, target.uri)
  // already running: Steam hands the join over
  await shell.openExternal(target.uri).catch(() => {})
  return { ok: true }
}

let steamCache: FriendsSnapshot | undefined
let xboxCache: FriendsSnapshot | undefined

export function snapshot(
  status: FriendsSnapshot['status'],
  message?: string,
  friends: Friend[] = [],
  offline: Friend[] = []
): FriendsSnapshot {
  return { status, message, friends, offline, offlineCount: offline.length, fetchedAt: Date.now() }
}

export async function getJson<T>(
  url: string,
  headers?: Record<string, string>
): Promise<{ ok: boolean; status: number; body?: T }> {
  try {
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(12_000) })
    if (!response.ok) return { ok: false, status: response.status }
    return { ok: true, status: response.status, body: (await response.json()) as T }
  } catch {
    return { ok: false, status: 0 }
  }
}

export function sortFriends(friends: Friend[], offline: Friend[]): void {
  friends.sort((a, b) => PRIORITY[a.state] - PRIORITY[b.state] || a.name.localeCompare(b.name))
  offline.sort((a, b) => a.name.localeCompare(b.name))
}

async function fetchSteamFriends(): Promise<FriendsSnapshot> {
  joinTargets.clear()
  const settings = getSettings()
  const key = settings.steamWebApiKey?.trim()
  if (!key) return snapshot('no-key')

  const account = await findSteamAccount(settings.steamPath)
  if (!account) {
    return snapshot('no-account', 'Could not work out which Steam account is signed in.')
  }

  const list = await getJson<{ friendslist?: { friends?: Array<{ steamid?: string }> } }>(
    `${API}/ISteamUser/GetFriendList/v1/?key=${encodeURIComponent(key)}&steamid=${account.steamId}&relationship=friend`
  )

  if (!list.ok) {
    // 401 = bad key OR private friends list, Valve doesn't say which
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
    const state: FriendState = player.gameextrainfo ? 'playing' : base
    const id = `steam:${player.steamid}`
    const appId = player.gameid && /^\d+$/.test(player.gameid) ? player.gameid : undefined
    const join = state === 'playing' ? joinTarget(player, appId) : undefined
    if (join && appId) joinTargets.set(id, { uri: join, appId })

    const friend: Friend = {
      id,
      store: 'steam',
      name: player.personaname ?? 'Unknown',
      avatar: player.avatarfull ?? player.avatarmedium,
      state,
      playing: player.gameextrainfo,
      playingAppId: appId,
      joinable: Boolean(join),
      profileUrl: player.profileurl
    }
    if (state === 'offline') offline.push(friend)
    else friends.push(friend)
  }

  sortFriends(friends, offline)
  return snapshot('ok', undefined, friends, offline)
}

// any working source = ok (a failing one goes in message)
function merge(sources: FriendsSnapshot[]): FriendsSnapshot {
  const keyed = sources.filter((source) => source.status !== 'no-key')
  if (!keyed.length) {
    return snapshot('no-key', 'Add a Steam or Xbox key in Settings to see who is online.')
  }
  const working = keyed.filter((source) => source.status === 'ok')
  if (!working.length) return keyed[0]

  const friends = working.flatMap((source) => source.friends)
  const offline = working.flatMap((source) => source.offline)
  sortFriends(friends, offline)
  const failed = keyed.find((source) => source.status !== 'ok')
  return snapshot('ok', failed?.message, friends, offline)
}

export async function getFriends(force = false): Promise<FriendsSnapshot> {
  const now = Date.now()
  const [steam, xbox] = await Promise.all([
    !force && steamCache && now - steamCache.fetchedAt < CACHE_MS
      ? steamCache
      : fetchSteamFriends(),
    // forced refresh still has a 20s floor for OpenXBL
    xboxCache && now - xboxCache.fetchedAt < (force ? 20_000 : XBOX_CACHE_MS)
      ? xboxCache
      : fetchXboxFriends(getSettings().xboxApiKey?.trim())
  ])
  steamCache = steam
  xboxCache = xbox
  return merge([steam, xbox])
}

export function invalidateFriends(): void {
  steamCache = undefined
  xboxCache = undefined
  joinTargets.clear()
}
