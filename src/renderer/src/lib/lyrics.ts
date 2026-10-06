import { useEffect, useState, useSyncExternalStore } from 'react'
import type { LyricLine, MediaState } from '@shared/types'

export type LyricsPlace = 'home' | 'tv' | 'saver' | 'widget'

// per place, already ANDed with the master switch. set by App from settings, or in
// the widget window from main
let places: Record<LyricsPlace, boolean> = { home: false, tv: false, saver: false, widget: false }
const subscribers = new Set<() => void>()

export function setLyricsPlaces(next: Partial<Record<LyricsPlace, boolean>>): void {
  const merged = { ...places, ...next }
  if ((Object.keys(merged) as LyricsPlace[]).every((place) => merged[place] === places[place])) return
  places = merged
  subscribers.forEach((notify) => notify())
}

export function useLyricsShown(place: LyricsPlace): boolean {
  return useSyncExternalStore(
    (notify) => {
      subscribers.add(notify)
      return () => subscribers.delete(notify)
    },
    () => places[place]
  )
}

// fine enough for a line change to land on the beat, only while lyrics show
const TICK_MS = 200
// a line reads better slightly early than late
const LEAD_MS = 150

export function useLyrics(media: MediaState | null, place: LyricsPlace): LyricLine[] | null {
  const on = useLyricsShown(place)
  const [lines, setLines] = useState<LyricLine[] | null>(null)
  const title = media?.active ? media.title : undefined
  const artist = media?.artist
  const album = media?.album
  const durationMs = media?.durationMs

  useEffect(() => {
    setLines(null)
    if (!on || !title || !artist || !window.launcher.getLyrics) return
    let alive = true
    void window.launcher.getLyrics({ title, artist, album, durationMs }).then((next) => {
      if (alive) setLines(next?.length ? next : null)
    })
    return () => {
      alive = false
    }
  }, [on, title, artist, album, durationMs])

  return lines
}

// -1 before the first line
export function useLyricIndex(lines: LyricLine[] | null, media: MediaState | null): number {
  const playing = media?.status === 'Playing'
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!lines || !playing) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), TICK_MS)
    return () => clearInterval(timer)
  }, [lines, playing, media?.updatedAt])

  if (!lines || media?.positionMs === undefined) return -1
  const elapsed = playing && media.updatedAt ? Math.max(0, now - media.updatedAt) : 0
  const position = media.positionMs + elapsed + LEAD_MS
  let index = -1
  for (let i = 0; i < lines.length && lines[i].at <= position; i++) index = i
  return index
}
