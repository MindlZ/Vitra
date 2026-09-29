import { randomUUID } from 'crypto'
import { basename, dirname } from 'path'
import { getGames, getSettings, patchGame, replaceGames, upsertGame } from './store'
import { IGNORED_APP_IDS, isGameLike, ownedSteamGame, scanSteam } from './scanners/steam'
import { scanSteamShortcuts } from './scanners/steamShortcuts'
import { scanEpic } from './scanners/epic'
import { scanGog } from './scanners/gog'
import { scanXbox } from './scanners/xbox'
import { readSteamPlaytime } from './scanners/steamPlaytime'
import { resolveAppInfo } from './scanners/steamStore'
import type { Game, ScanResult } from '../shared/types'

/** Fields a scan is allowed to refresh; everything else belongs to the user. */
function mergeDiscovered(existing: Game, found: Game): Game {
  return {
    ...existing,
    name: found.name,
    installDir: found.installDir ?? existing.installDir,
    exePath: found.exePath ?? existing.exePath,
    steamAppId: found.steamAppId ?? existing.steamAppId,
    // Epic's flips between ?action=install and ?action=launch as a game comes
    // and goes, so the scan's always wins when it has one.
    epicLaunchUri: found.epicLaunchUri ?? existing.epicLaunchUri,
    xboxAumid: found.xboxAumid ?? existing.xboxAumid,
    launchUri: found.launchUri ?? existing.launchUri,
    coverUrl: existing.coverFile ? existing.coverUrl : (found.coverUrl ?? existing.coverUrl),
    heroUrl: found.heroUrl ?? existing.heroUrl,
    logoUrl: found.logoUrl ?? existing.logoUrl,
    // Epic hands us authoritative process names; keep ours if it doesn't.
    processHints: found.processHints?.length ? found.processHints : existing.processHints,
    installed: found.installed
  }
}

function seedSteamHistory(
  game: Game,
  playtime: { seconds: Record<string, number>; lastPlayed: Record<string, number> }
): Game {
  if (!game.steamAppId) return game
  const seconds = playtime.seconds[game.steamAppId]
  const lastPlayed = playtime.lastPlayed[game.steamAppId]
  return {
    ...game,
    playtimeSeconds: seconds ?? game.playtimeSeconds,
    lastPlayed: lastPlayed ?? game.lastPlayed
  }
}

export async function scanLibrary(): Promise<ScanResult> {
  const settings = getSettings()
  const [steam, shortcuts, epic, gog, xbox, playtime] = await Promise.all([
    scanSteam(settings.steamPath),
    scanSteamShortcuts(settings.steamPath),
    scanEpic(),
    scanGog(),
    scanXbox(),
    readSteamPlaytime(settings.steamPath)
  ])

  const errors = [...steam.errors, ...shortcuts.errors, ...epic.errors, ...gog.errors, ...xbox.errors]
  const discovered = [...steam.games, ...shortcuts.games, ...epic.games, ...gog.games, ...xbox.games]

  // Anything the account has touched but isn't on disk: owned, not installed.
  // Names and app types come from the public store endpoint (cached on disk).
  const installedAppIds = new Set(steam.games.map((game) => game.steamAppId))
  const candidates = playtime.knownAppIds.filter(
    (appId) => !installedAppIds.has(appId) && !IGNORED_APP_IDS.has(appId)
  )

  let ownedCount = 0
  if (candidates.length) {
    try {
      const info = await resolveAppInfo(candidates)
      for (const appId of candidates) {
        const entry = info.get(appId)
        // Only real games — this drops DLC, soundtracks, demos and videos.
        if (!entry?.name || entry.type !== 'game') continue
        if (!isGameLike(appId, entry.name)) continue
        discovered.push(ownedSteamGame(appId, entry.name))
        ownedCount++
      }
    } catch (err) {
      errors.push(`Owned-game lookup failed: ${(err as Error).message}`)
    }
  }

  const discoveredIds = new Set(discovered.map((game) => game.id))
  const existing = getGames()
  const byId = new Map(existing.map((game) => [game.id, game]))

  let added = 0
  let updated = 0
  let missing = 0

  const next: Game[] = []

  for (const game of existing) {
    if (game.source === 'manual' || discoveredIds.has(game.id)) {
      next.push(game)
      continue
    }
    // A store game we've seen before that isn't on disk now. Keep it (and its
    // playtime) but flag it, so an offline drive never wipes history.
    if (game.installed) missing++
    next.push({ ...game, installed: false })
  }

  const nextById = new Map(next.map((game) => [game.id, game]))

  for (const found of discovered) {
    const previous = byId.get(found.id)
    if (previous) {
      nextById.set(found.id, mergeDiscovered(previous, found))
      updated++
      continue
    }
    // Seed Steam's own recorded hours on first import so totals look right.
    nextById.set(found.id, seedSteamHistory(found, playtime))
    added++
  }

  replaceGames([...nextById.values()])
  return {
    added,
    updated,
    missing,
    bySource: {
      steam: steam.games.length,
      shortcuts: shortcuts.games.length,
      epic: epic.games.length - epic.owned,
      gog: gog.games.length - gog.owned,
      xbox: xbox.games.length,
      owned: ownedCount + epic.owned + gog.owned
    },
    errors
  }
}

/**
 * Steam's genres for software. Steam files tools like Wallpaper Engine and
 * Lossless Scaling as type "game", but tags them with these. Education (54)
 * is left out on purpose: plenty of educational titles are games.
 */
const SOFTWARE_GENRES = new Set(['51', '52', '53', '55', '56', '57', '58', '59', '60'])

/**
 * Programs Steam files under ordinary game genres, so the genre check can't
 * see them. Aimlabs (714010) is Action/Casual/Simulation on the store. Anything
 * else is one click on the detail page's Game/App switch.
 */
const KNOWN_SOFTWARE = new Set(['714010'])

/**
 * Marks Steam titles that are really software, so Home can keep them out of
 * Continue playing. Runs after a scan rather than inside it: the first pass
 * looks up every installed title's genres (~250 ms apart, to be kind to the
 * store endpoint), and that shouldn't hold up the scan. Returns true if any
 * game changed, so the caller can tell the renderer.
 */
export async function classifySoftware(): Promise<boolean> {
  const steamIds = getGames()
    .map((game) => game.steamAppId)
    .filter((id): id is string => Boolean(id && /^\d+$/.test(id)))
  if (!steamIds.length) return false

  const info = await resolveAppInfo(steamIds, true)
  let changed = false
  // Re-read: a scan may have replaced the list while we were fetching.
  for (const game of getGames()) {
    const genres = game.steamAppId ? info.get(game.steamAppId)?.genres : undefined
    if (!genres) continue
    const software =
      KNOWN_SOFTWARE.has(game.steamAppId!) || genres.some((genre) => SOFTWARE_GENRES.has(genre))
    if (game.software !== software) {
      patchGame(game.id, { software })
      changed = true
    }
  }
  return changed
}

export function addManualGame(input: {
  name?: string
  exePath: string
  args?: string
  tags?: string[]
}): Game {
  const name = input.name?.trim() || basename(input.exePath).replace(/\.(exe|lnk|bat|cmd)$/i, '')
  const game: Game = {
    id: `manual:${randomUUID()}`,
    name,
    source: 'manual',
    exePath: input.exePath,
    args: input.args,
    installDir: dirname(input.exePath),
    processHints: [basename(input.exePath).toLowerCase()],
    tags: input.tags ?? [],
    favorite: false,
    hidden: false,
    installed: true,
    playtimeSeconds: 0,
    sessions: 0,
    addedAt: Date.now()
  }
  return upsertGame(game)
}
