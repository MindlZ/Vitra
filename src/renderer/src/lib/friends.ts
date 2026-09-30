import { useCallback, useEffect, useState } from 'react'
import type { Friend, FriendsSnapshot, FriendState, FriendStore } from '@shared/types'

const REFRESH_MS = 60_000

export const STATE_LABEL: Record<FriendState, string> = {
  playing: 'In game',
  online: 'Online',
  trading: 'Looking to trade',
  busy: 'Busy',
  away: 'Away',
  snooze: 'Snoozing',
  offline: 'Offline'
}

export const STORE_LABEL: Record<FriendStore, string> = {
  steam: 'Steam',
  xbox: 'Xbox'
}

export const STATE_DOT: Record<FriendState, string> = {
  playing: 'bg-accent shadow-[0_0_8px_rgb(var(--accent-rgb)/0.9)]',
  online: 'bg-[#6ee7a0]',
  trading: 'bg-[#6ee7a0]',
  busy: 'bg-danger',
  away: 'bg-ember',
  snooze: 'bg-ember',
  offline: 'bg-muted'
}

export async function joinFriend(friend: Friend): Promise<boolean> {
  if (!friend.joinable || !window.launcher.joinFriend) return false
  const result = await window.launcher.joinFriend(friend.id)
  if (!result.ok) console.warn('[friends] join failed:', result.error)
  return result.ok
}

// main caches 45s, so the panel and Home polling together cost one request
export function useFriends() {
  const [snapshot, setSnapshot] = useState<FriendsSnapshot | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async (force = false) => {
    if (force) setRefreshing(true)
    try {
      setSnapshot(await window.launcher.getFriends(force))
    } finally {
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void load()
    const timer = setInterval(() => void load(), REFRESH_MS)
    return () => clearInterval(timer)
  }, [load])

  return { snapshot, refreshing, refresh: () => void load(true) }
}
