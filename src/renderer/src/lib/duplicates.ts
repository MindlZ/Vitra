import { GAME_SOURCES, type Game } from '@shared/types'

// display-only merge: each copy keeps its own data on disk.
// hiding a copy is the way to split a wrong match

// "DOOM Eternal™" = "Doom Eternal", but "Doom" != "Doom 3"
export function titleKey(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[™®©]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function storeRank(game: Game): number {
  return GAME_SOURCES.indexOf(game.source)
}

// user's pick > installed > most played > store order
function pickPrimary(copies: Game[]): Game {
  const preferred = copies.find((copy) => copy.preferredStore)?.preferredStore
  const chosen = preferred && copies.find((copy) => copy.source === preferred)
  if (chosen) return chosen
  return [...copies].sort(
    (a, b) =>
      Number(b.installed) - Number(a.installed) ||
      b.playtimeSeconds - a.playtimeSeconds ||
      storeRank(a) - storeRank(b)
  )[0]
}

function mergeable(game: Game): string | undefined {
  if (game.source === 'manual' || game.hidden) return undefined
  return titleKey(game.name) || undefined
}

export function mergeDuplicates(games: Game[]): Game[] {
  const groups = new Map<string, Game[]>()
  for (const game of games) {
    const key = mergeable(game)
    if (!key) continue
    const group = groups.get(key)
    if (group) group.push(game)
    else groups.set(key, [game])
  }

  const out: Game[] = []
  const done = new Set<string>()
  for (const game of games) {
    const key = mergeable(game)
    const copies = key ? groups.get(key)! : [game]
    // two from the same store are two products
    if (copies.length === 1 || new Set(copies.map((copy) => copy.source)).size < copies.length) {
      out.push(game)
      continue
    }
    if (done.has(key!)) continue
    done.add(key!)
    const primary = pickPrimary(copies)
    out.push({
      ...primary,
      siblings: copies.filter((copy) => copy !== primary),
      playtimeSeconds: copies.reduce((sum, copy) => sum + copy.playtimeSeconds, 0),
      sessions: copies.reduce((sum, copy) => sum + copy.sessions, 0),
      lastPlayed: Math.max(...copies.map((copy) => copy.lastPlayed ?? 0)) || undefined
    })
  }
  return out
}

export function copyIds(game: Game): string[] {
  return [game.id, ...(game.siblings?.map((sibling) => sibling.id) ?? [])]
}
