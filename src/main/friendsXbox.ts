import { getJson, snapshot, sortFriends } from './friends'
import type { Friend, FriendsSnapshot, FriendState } from '../shared/types'

// OpenXBL passes PeopleHub through. undocumented, so read defensively. untested with a live key

// old path still answers for some keys
const ENDPOINTS = ['https://api.xbl.io/v2/friends', 'https://xbl.io/api/v2/friends']

interface PresenceDetail {
  IsGame?: boolean
  IsPrimary?: boolean
  PresenceText?: string
  TitleId?: string
}

interface Person {
  xuid?: string
  gamertag?: string
  modernGamertag?: string
  displayName?: string
  displayPicRaw?: string
  // Online | Away | Offline
  presenceState?: string
  presenceText?: string
  presenceDetails?: PresenceDetail[]
}

// some pics come as http; CSP is https only
function secure(url: string | undefined): string | undefined {
  if (!url) return undefined
  return url.replace(/^http:\/\//i, 'https://')
}

function toFriend(person: Person): Friend | null {
  if (!person.xuid) return null
  const presence = (person.presenceState ?? '').toLowerCase()
  const details = person.presenceDetails ?? []
  // a PC can report several
  const game =
    details.find((detail) => detail.IsGame && detail.IsPrimary) ?? details.find((detail) => detail.IsGame)

  let state: FriendState = 'offline'
  if (presence === 'online') state = game?.PresenceText ? 'playing' : 'online'
  else if (presence === 'away') state = 'away'

  const gamertag = person.modernGamertag || person.gamertag
  return {
    id: `xbox:${person.xuid}`,
    store: 'xbox',
    name: person.displayName || gamertag || 'Unknown',
    avatar: secure(person.displayPicRaw),
    state,
    playing: state === 'playing' ? game?.PresenceText : undefined,
    profileUrl: gamertag ? `https://www.xbox.com/play/user/${encodeURIComponent(gamertag)}` : undefined
  }
}

export async function fetchXboxFriends(key: string | undefined): Promise<FriendsSnapshot> {
  if (!key) return snapshot('no-key')

  const headers = { 'X-Authorization': key, Accept: 'application/json' }
  let result = await getJson<{ people?: Person[] }>(ENDPOINTS[0], headers)
  if (!result.ok && result.status === 404) result = await getJson(ENDPOINTS[1], headers)

  if (!result.ok) {
    if (result.status === 401 || result.status === 403) {
      return snapshot('private', 'OpenXBL refused the Xbox key. Check it in Settings.')
    }
    if (result.status === 429) {
      return snapshot('error', 'OpenXBL rate limit reached. Xbox friends will be back shortly.')
    }
    return snapshot('error', 'Could not reach OpenXBL for Xbox friends.')
  }

  const friends: Friend[] = []
  const offline: Friend[] = []
  for (const person of result.body?.people ?? []) {
    const friend = toFriend(person)
    if (!friend) continue
    if (friend.state === 'offline') offline.push(friend)
    else friends.push(friend)
  }
  sortFriends(friends, offline)
  return snapshot('ok', undefined, friends, offline)
}
