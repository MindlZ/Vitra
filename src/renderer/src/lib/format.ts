import type { Game, ProgramsView } from '@shared/types'

export function isSoftware(game: Game): boolean {
  return game.softwareOverride ?? game.software ?? false
}

// App's filter and Sidebar's counts must both use this or they disagree
export function inLibrary(game: Game, programsView: ProgramsView): boolean {
  if (game.hidden) return false
  return programsView === 'library' || !isSoftware(game)
}

export function formatPlaytime(seconds: number): string {
  if (!seconds) return 'Never played'
  if (seconds < 3600) return `${Math.max(1, Math.round(seconds / 60))} min`
  const hours = seconds / 3600
  return `${hours < 10 ? hours.toFixed(1) : Math.round(hours)} hrs`
}

export function formatPlaytimeShort(seconds: number): string {
  if (!seconds) return '—'
  if (seconds < 3600) return `${Math.max(1, Math.round(seconds / 60))}m`
  const hours = seconds / 3600
  return `${hours < 10 ? hours.toFixed(1) : Math.round(hours)}h`
}

export function formatLastPlayed(timestamp?: number): string {
  if (!timestamp) return 'Never'
  const now = new Date()
  const then = new Date(timestamp)
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const days = Math.floor((startOfToday - new Date(then.getFullYear(), then.getMonth(), then.getDate()).getTime()) / 86_400_000)

  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days} days ago`
  if (days < 30) return `${Math.floor(days / 7)} week${days < 14 ? '' : 's'} ago`
  return then.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`
}

export function initials(name: string): string {
  const words = name
    .replace(/[^\p{L}\p{N} ]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
  if (!words.length) return '?'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[words.length - 1][0]).toUpperCase()
}

export function hueFor(name: string): number {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) % 360
  return hash
}

const SOURCE_LABELS: Record<string, string> = {
  steam: 'Steam',
  epic: 'Epic Games',
  gog: 'GOG',
  xbox: 'Xbox',
  battlenet: 'Battle.net',
  ea: 'EA app',
  ubisoft: 'Ubisoft Connect',
  riot: 'Riot'
}

export function sourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? 'Local'
}

// counts siblings too, so a merged game shows under every store it's on
export function hasSource(game: Game, source: string): boolean {
  return game.source === source || Boolean(game.siblings?.some((sibling) => sibling.source === source))
}

// subsequence: "hlfl" finds Half-Life
export function matchesQuery(haystack: string, query: string): boolean {
  const target = haystack.toLowerCase()
  const needle = query.toLowerCase().trim()
  if (!needle) return true
  if (target.includes(needle)) return true

  let index = 0
  for (const char of needle) {
    if (char === ' ') continue
    index = target.indexOf(char, index)
    if (index === -1) return false
    index++
  }
  return true
}
