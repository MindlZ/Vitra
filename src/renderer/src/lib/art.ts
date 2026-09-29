import { useEffect, useState } from 'react'
import type { ArtKind } from '@shared/api'

const cache = new Map<string, string | null>()
const listeners = new Map<string, Set<() => void>>()

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

/** Drop a cached result so the next render re-resolves it (after the user sets art). */
export function invalidateArt(gameId: string, kind: ArtKind): void {
  const key = `${gameId}:${kind}`
  cache.delete(key)
  notify(key)
}

/**
 * Resolve one piece of art, asking the main process to download and cache it on
 * first use. Requests are queued so a big library doesn't open 200 sockets.
 */
export function useArt(gameId: string, kind: ArtKind, enabled = true): string | null {
  const key = `${gameId}:${kind}`
  const [value, setValue] = useState<string | null>(() => cache.get(key) ?? null)

  useEffect(() => {
    if (!enabled) return
    let alive = true

    const sync = (): void => {
      if (alive) setValue(cache.get(key) ?? null)
    }
    const set = listeners.get(key) ?? new Set()
    set.add(sync)
    listeners.set(key, set)

    if (cache.has(key)) {
      sync()
    } else {
      schedule(async () => {
        if (cache.has(key)) return
        try {
          const file = await window.launcher.ensureArt(gameId, kind)
          cache.set(key, file ? artUrl(file) : null)
        } catch {
          cache.set(key, null)
        }
        notify(key)
      })
    }

    return () => {
      alive = false
      set.delete(sync)
      if (!set.size) listeners.delete(key)
    }
  }, [key, gameId, kind, enabled])

  return value
}
