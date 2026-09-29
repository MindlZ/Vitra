import { useEffect, useState } from 'react'
import type { MediaCommand, MediaState } from '@shared/types'

/**
 * What Windows says is playing, kept live. Null until the first answer, or for
 * good if the preload predates the media bridge (preload and main only load
 * when Electron starts, so a renderer hot-reload can be ahead of them).
 */
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

/**
 * Players only report position when it changes course (play, pause, seek), so
 * extrapolate from the last report while playing. Ticks once a second.
 */
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

/** "SpotifyAB.SpotifyMusic_…!Spotify" or "chrome.exe" → a name people know. */
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
