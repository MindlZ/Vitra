import { app } from 'electron'
import { getSettings } from './store'
import type { LyricLine } from '../shared/types'

// synced lyrics from LRCLIB (lrclib.net: free, no key). opt-in (settings.lyrics):
// it sends what's playing (title, artist, album, length). synced only; plain text
// can't follow the song, so it counts as none

const API = 'https://lrclib.net/api'
const TIMEOUT_MS = 8000
const CACHE_MAX = 100

export interface LyricsQuery {
  title: string
  artist: string
  album?: string
  durationMs?: number
}

interface LrcRecord {
  syncedLyrics?: string | null
  duration?: number
}

// misses are cached too, so a track without lyrics isn't asked for again
const cache = new Map<string, LyricLine[] | null>()

// "[01:23.45] line"; several stamps can share a line
function parseLrc(text: string): LyricLine[] {
  const lines: LyricLine[] = []
  for (const raw of text.split(/\r?\n/)) {
    const stamps = [...raw.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)]
    if (!stamps.length) continue
    const words = raw.replace(/\[[^\]]*\]/g, '').trim()
    for (const [, min, sec] of stamps) {
      lines.push({ at: Math.round((Number(min) * 60 + Number(sec)) * 1000), text: words })
    }
  }
  return lines.sort((a, b) => a.at - b.at)
}

// players add "- Remastered 2011", "(feat. X)", "[Official Video]"
function cleanTitle(title: string): string {
  return title
    .replace(/\s*[([][^)\]]*(feat\.|ft\.|remaster|official|video|audio|lyrics|live)[^)\]]*[)\]]/gi, '')
    .replace(/\s+-\s+.*(remaster|version|edit|mix|live).*$/i, '')
    .trim()
}

async function request(path: string, params: Record<string, string>): Promise<unknown> {
  const url = `${API}${path}?${new URLSearchParams(params)}`
  const res = await fetch(url, {
    headers: { 'User-Agent': `Vitra/${app.getVersion()} (https://github.com/MindlZ/Vitra)` },
    signal: AbortSignal.timeout(TIMEOUT_MS)
  })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`lrclib ${res.status}`)
  return res.json()
}

async function find(query: LyricsQuery): Promise<LyricLine[] | null> {
  const title = cleanTitle(query.title)
  const seconds = query.durationMs ? Math.round(query.durationMs / 1000) : undefined

  // exact match first: needs the length, and uses the album when there is one
  if (seconds) {
    const exact = (await request('/get', {
      track_name: title,
      artist_name: query.artist,
      ...(query.album ? { album_name: query.album } : {}),
      duration: String(seconds)
    })) as LrcRecord | null
    if (exact?.syncedLyrics) return parseLrc(exact.syncedLyrics)
  }

  // then a search: the closest length among results that have synced lyrics
  const results = (await request('/search', { track_name: title, artist_name: query.artist })) as LrcRecord[] | null
  const synced = (results ?? []).filter((r) => r.syncedLyrics)
  if (!synced.length) return null
  const best = seconds
    ? synced.reduce((a, b) => (Math.abs((a.duration ?? 0) - seconds) <= Math.abs((b.duration ?? 0) - seconds) ? a : b))
    : synced[0]
  // a different recording would drift out of sync
  if (seconds && best.duration && Math.abs(best.duration - seconds) > 5) return null
  return parseLrc(best.syncedLyrics!)
}

export async function getLyrics(query: unknown): Promise<LyricLine[] | null> {
  if (!getSettings().lyrics) return null
  const q = query as LyricsQuery
  if (typeof q?.title !== 'string' || typeof q.artist !== 'string' || !q.title.trim() || !q.artist.trim()) return null
  const clean: LyricsQuery = {
    title: q.title.slice(0, 300),
    artist: q.artist.slice(0, 300),
    album: typeof q.album === 'string' ? q.album.slice(0, 300) : undefined,
    durationMs: typeof q.durationMs === 'number' && q.durationMs > 0 ? q.durationMs : undefined
  }
  const key = `${clean.title}|${clean.artist}|${clean.album ?? ''}|${Math.round((clean.durationMs ?? 0) / 1000)}`
  if (cache.has(key)) return cache.get(key) ?? null

  try {
    const lines = await find(clean)
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!)
    cache.set(key, lines)
    return lines
  } catch (err) {
    // network trouble isn't cached, so it's tried again on the next track change
    console.warn('[lyrics]', (err as Error).message)
    return null
  }
}
