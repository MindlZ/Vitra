import { useEffect, useState } from 'react'
import type { UpdateState } from '@shared/types'

/** Where updating stands, live. Null until the first answer from main. */
export function useUpdate(): UpdateState | null {
  const [state, setState] = useState<UpdateState | null>(null)

  useEffect(() => {
    // Guarded: a renderer can hot-reload ahead of the preload that adds these.
    if (!window.launcher.getUpdate) return
    let alive = true
    void window.launcher.getUpdate().then((next) => alive && setState(next))
    const off = window.launcher.onUpdateChanged?.((next) => setState(next))
    return () => {
      alive = false
      off?.()
    }
  }, [])

  return state
}

/** Settings' status line. Short on purpose: a label, not an explanation. */
export function describeUpdate(state: UpdateState): string {
  switch (state.status) {
    case 'unavailable':
      return state.reason === 'dev' ? 'Updates work in the installed app' : 'Updates unavailable'
    case 'checking':
      return 'Checking…'
    case 'up-to-date':
      return 'Up to date'
    case 'available':
      return `Version ${state.version} available`
    case 'downloading':
      return `Downloading… ${state.percent ?? 0}%`
    case 'installing':
      return 'Installing…'
    case 'error':
      return state.message ?? "Couldn't check for updates"
    default:
      return 'Updates'
  }
}
