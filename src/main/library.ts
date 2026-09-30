import { randomUUID } from 'crypto'
import { basename, dirname } from 'path'
import { getGames, getSettings, patchGame, replaceGames, upsertGame } from './store'
import { IGNORED_APP_IDS, isGameLike, ownedSteamGame, scanSteam } from './scanners/steam'
import { scanSteamShortcuts } from './scanners/steamShortcuts'
import { scanEpic } from './scanners/epic'
import { scanGog } from './scanners/gog'
import { scanXbox } from './scanners/xbox'
import { scanLaunchers } from './scanners/launchers'
import { readSteamPlaytime } from './scanners/steamPlaytime'
import { resolveAppInfo } from './scanners/steamStore'
import type { Game, ScanResult } from '../shared/types'

// only these are the scan's; everything else is the user's
function mergeDiscovered(existing: Game, found: Game): Game {
  return {
    ...existing,
    name: found.name,
    installDir: found.installDir ?? existing.installDir,
    exePath: found.exePath ?? existing.exePath,
    steamAppId: found.steamAppId ?? existing.steamAppId,
    // flips between ?action=install and ?action=launch
    epicLaunchUri: found.epicLaunchUri ?? existing.epicLaunchUri,
    xboxAumid: found.xboxAumid ?? existing.xboxAumid,
    launchUri: found.launchUri ?? existing.launchUri,
    launcher: found.launcher ?? existing.launcher,
    coverUrl: existing.coverFile ? existing.coverUrl : (found.coverUrl ?? existing.coverUrl),
    heroUrl: found.heroUrl ?? existing.heroUrl,
    logoUrl: found.logoUrl ?? existing.logoUrl,
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
  const [steam, shortcuts, epic, gog, xbox, launchers, playtime] = await Promise.all([
    scanSteam(settings.steamPath),
    scanSteamShortcuts(settings.steamPath),
    scanEpic(),
    scanGog(),
    scanXbox(),
    scanLaunchers(),
    readSteamPlaytime(settings.steamPath)
  ])

  const sources = [steam, shortcuts, epic, gog, xbox, launchers]
  const errors = sources.flatMap((source) => source.errors)
  const discovered = sources.flatMap((source) => source.games)

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
        // type filter drops DLC, soundtracks, demos, videos
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
    // never delete: an unplugged drive would wipe playtime
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
      launchers: launchers.games.length,
      owned: ownedCount + epic.owned + gog.owned
    },
    errors
  }
}

// Steam's software genres (51-60). 54 Education skipped: plenty of those are games
const SOFTWARE_GENRES = new Set(['51', '52', '53', '55', '56', '57', '58', '59', '60'])

// software filed under game genres. 714010 Aimlabs
const KNOWN_SOFTWARE = new Set(['714010'])

// separate from the scan: the first run fetches every genre, ~250ms apart
export async function classifySoftware(): Promise<boolean> {
  const steamIds = getGames()
    .map((game) => game.steamAppId)
    .filter((id): id is string => Boolean(id && /^\d+$/.test(id)))
  if (!steamIds.length) return false

  const info = await resolveAppInfo(steamIds, true)
  let changed = false
  // re-read: a scan may have replaced the list meanwhile
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
