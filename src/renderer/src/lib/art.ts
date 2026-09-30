import { useEffect, useState } from 'react'
import type { ArtKind } from '@shared/api'

const cache = new Map<string, string | null>()
const listeners = new Map<string, Set<() => void>>()
const pending = new Set<string>()

const MAX_CONCURRENT = 5
let active = 0
const queue: (() => void)[] = []

function pump(): void {
  while (active < MAX_CONCURRENT && queue.length) {
    const task = queue.shift()!
    active++
    task()
  }
}

function schedule(task: () => Promise<void>): void {
  queue.push(() => {
    void task().finally(() => {
      active--
      pump()
    })
  })
  pump()
}

function notify(key: string): void {
  listeners.get(key)?.forEach((fn) => fn())
}

export function artUrl(file: string): string {
  return `applib://art/${encodeURIComponent(file)}`
}

// pairs with main's retryMissingArt; without it new covers needed a restart
export function forgetMissingArt(): void {
  for (const [key, value] of cache) {
    if (value !== null) continue
    cache.delete(key)
    notify(key)
  }
}

export function invalidateArt(gameId: string, kind: ArtKind): void {
  const key = `${gameId}:${kind}`
  cache.delete(key)
  notify(key)
}

// queued (MAX_CONCURRENT) so a big library doesn't open 200 sockets
export function useArt(gameId: string, kind: ArtKind, enabled = true): string | null {
  const key = `${gameId}:${kind}`
  const [value, setValue] = useState<string | null>(() => cache.get(key) ?? null)

  useEffect(() => {
    if (!enabled) return
    let alive = true

    const request = (): void => {
      if (pending.has(key)) return
      pending.add(key)
      schedule(async () => {
        try {
          if (cache.has(key)) return
          const file = await window.launcher.ensureArt(gameId, kind)
          cache.set(key, file ? artUrl(file) : null)
        } catch {
          cache.set(key, null)
        } finally {
          pending.delete(key)
        }
        notify(key)
      })
    }
    // a dropped entry gets re-requested here
    const sync = (): void => {
      if (!alive) return
      if (cache.has(key)) return setValue(cache.get(key) ?? null)
      setValue(null)
      request()
    }
    const set = listeners.get(key) ?? new Set()
    set.add(sync)
    listeners.set(key, set)

    sync()

    return () => {
      alive = false
      set.delete(sync)
      if (!set.size) listeners.delete(key)
    }
  }, [key, gameId, kind, enabled])

  return value
}
