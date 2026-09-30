import { useEffect, useState } from 'react'
import type { MediaCommand, MediaState } from '@shared/types'

export function useMedia(): MediaState | null {
  const [state, setState] = useState<MediaState | null>(null)

  useEffect(() => {
    const api = window.launcher
    if (typeof api.getMedia !== 'function') return
    let alive = true
    void api.getMedia().then((next) => {
      if (alive) setState(next)
    })
    const off = api.onMediaChanged((next) => setState(next))
    return () => {
      alive = false
      off()
    }
  }, [])

  return state
}

export function sendMedia(command: MediaCommand): void {
  if (typeof window.launcher.mediaCommand === 'function') void window.launcher.mediaCommand(command)
}

// players only report position on play/pause/seek; extrapolate between
export function useMediaPosition(state: MediaState | null): number {
  const playing = state?.status === 'Playing'
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!playing) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [playing, state?.updatedAt])

  if (!state?.positionMs) return 0
  const elapsed = playing && state.updatedAt ? Math.max(0, now - state.updatedAt) : 0
  return Math.min(state.durationMs || Infinity, state.positionMs + elapsed)
}

// "SpotifyAB.SpotifyMusic_…!Spotify", "chrome.exe"
export function playerName(app?: string): string | undefined {
  if (!app) return undefined
  const lower = app.toLowerCase()
  const known: [string, string][] = [
    ['spotify', 'Spotify'],
    ['msedge', 'Microsoft Edge'],
    ['chrome', 'Chrome'],
    ['firefox', 'Firefox'],
    ['opera', 'Opera'],
    ['brave', 'Brave'],
    ['vlc', 'VLC'],
    ['zunemusic', 'Media Player'],
    ['applemusic', 'Apple Music'],
    ['tidal', 'TIDAL'],
    ['deezer', 'Deezer']
  ]
  const match = known.find(([needle]) => lower.includes(needle))
  if (match) return match[1]
  const tail = app.split('!').pop() ?? app
  return tail.replace(/\.exe$/i, '')
}
