import { useCallback, useEffect, useState } from 'react'
import type { FriendsSnapshot, FriendState } from '@shared/types'

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

/** Green for available, amber for idle, and the accent for in-game. */
export const STATE_DOT: Record<FriendState, string> = {
  playing: 'bg-accent shadow-[0_0_8px_rgb(var(--accent-rgb)/0.9)]',
  online: 'bg-[#6ee7a0]',
  trading: 'bg-[#6ee7a0]',
  busy: 'bg-danger',
  away: 'bg-ember',
  snooze: 'bg-ember',
  offline: 'bg-muted'
}

/**
 * Polls the friends list once a minute. The main process caches for 45s, so
 * the side panel and Home both polling costs one request, not two.
 */
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
