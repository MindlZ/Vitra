import { promises as fs } from 'fs'
import { join } from 'path'
import { parseVdf, pickNode, pickString } from '../vdf'
import { findSteamPath } from '../paths'
import type { Game } from '../../shared/types'

/** Runtimes, redistributables and SDKs that show up as "apps" but aren't games. */
export const IGNORED_APP_IDS = new Set([
  '7', // Steam client itself
  '480', // Spacewar (the SDK test app)
  '760', // Steam Screenshots
  '228980', // Steamworks Common Redistributables
  '1070560', // Steam Linux Runtime 1.0
  '1391110', // Steam Linux Runtime 2.0 (soldier)
  '1628350', // Steam Linux Runtime 3.0 (sniper)
  '1493710', // Proton Experimental
  '2180100', // Proton Hotfix
  '1826330',
  '1887720',
  '2230260',
  '2348590',
  '858280' // Half-Life: Alyx - Shader cache
])

const IGNORED_NAME_PATTERNS = [
  /^steam linux runtime/i,
  /^proton\b/i,
  /redistributab/i,
  /^steamworks/i,
  /shader (cache|pre-?caching)/i,
  /\bdedicated server\b/i,
  /\bsdk\b/i
]

const STEAM_CDN = 'https://cdn.cloudflare.steamstatic.com/steam/apps'
/** Valve's newer asset host, used as a fallback when the CDN is missing a size. */
const STEAM_ASSETS = 'https://shared.steamstatic.com/store_item_assets/steam/apps'

export function isGameLike(appId: string, name: string): boolean {
  if (IGNORED_APP_IDS.has(appId)) return false
  return !IGNORED_NAME_PATTERNS.some((re) => re.test(name))
}

/**
 * A game the account owns but hasn't installed. There's no manifest for these,
 * so the name comes from the store lookup and there's no install path — but the
 * CDN art and Steam's launch URI both still work from the app id alone.
 */
export function ownedSteamGame(appId: string, name: string): Game {
  return {
    id: `steam:${appId}`,
    name,
    source: 'steam',
    steamAppId: appId,
    processHints: [],
    coverUrl: `${STEAM_CDN}/${appId}/library_600x900_2x.jpg`,
    heroUrl: `${STEAM_CDN}/${appId}/library_hero.jpg`,
    logoUrl: `${STEAM_CDN}/${appId}/logo.png`,
    tags: [],
    favorite: false,
    hidden: false,
    installed: false,
    playtimeSeconds: 0,
    sessions: 0,
    addedAt: Date.now()
  }
}

/** Every Steam library root that currently exists on disk. */
async function readLibraryFolders(steamPath: string): Promise<string[]> {
  const roots = new Set<string>([steamPath])
  const file = join(steamPath, 'steamapps', 'libraryfolders.vdf')

  try {
    const parsed = parseVdf(await fs.readFile(file, 'utf8'))
    const folders = pickNode(parsed, 'libraryfolders') ?? parsed

    for (const [key, value] of Object.entries(folders)) {
      if (!/^\d+$/.test(key)) continue
      // Modern format: { path: "..." }. Legacy format: "1" "D:\\SteamLibrary".
      // parseVdf already unescapes the doubled backslashes Valve writes.
      const path = typeof value === 'string' ? value : pickString(value, 'path')
      if (path) roots.add(path)
    }
  } catch {
    // No libraryfolders.vdf — the default library is still worth scanning.
  }

  const existing: string[] = []
  for (const root of roots) {
    try {
      await fs.access(join(root, 'steamapps'))
      existing.push(root)
    } catch {
      // Library on a drive that isn't plugged in right now.
    }
  }
  return existing
}

export async function scanSteam(steamPathOverride?: string): Promise<{
  games: Game[]
  errors: string[]
}> {
  const errors: string[] = []
  const steamPath = await findSteamPath(steamPathOverride)
  if (!steamPath) return { games: [], errors: ['Steam installation not found.'] }

  const games: Game[] = []
  const seen = new Set<string>()

  for (const root of await readLibraryFolders(steamPath)) {
    const steamapps = join(root, 'steamapps')
    let entries: string[]
    try {
      entries = await fs.readdir(steamapps)
    } catch (err) {
      errors.push(`Could not read ${steamapps}: ${(err as Error).message}`)
      continue
    }

    for (const entry of entries) {
      if (!/^appmanifest_\d+\.acf$/i.test(entry)) continue
      try {
        const parsed = parseVdf(await fs.readFile(join(steamapps, entry), 'utf8'))
        const state = pickNode(parsed, 'AppState')
        if (!state) continue

        const appId = pickString(state, 'appid')
        const name = pickString(state, 'name')
        const installdir = pickString(state, 'installdir')
        if (!appId || !name || seen.has(appId)) continue

        // StateFlags bit 2 (value 4) means "fully installed".
        const stateFlags = Number(pickString(state, 'StateFlags') ?? '0')
        if (!(stateFlags & 4)) continue
        if (!isGameLike(appId, name)) continue

        seen.add(appId)
        games.push({
          id: `steam:${appId}`,
          name,
          source: 'steam',
          steamAppId: appId,
          installDir: installdir ? join(steamapps, 'common', installdir) : undefined,
          processHints: [],
          coverUrl: `${STEAM_CDN}/${appId}/library_600x900_2x.jpg`,
          heroUrl: `${STEAM_CDN}/${appId}/library_hero.jpg`,
          logoUrl: `${STEAM_CDN}/${appId}/logo.png`,
          tags: [],
          favorite: false,
          hidden: false,
          installed: true,
          playtimeSeconds: 0,
          sessions: 0,
          addedAt: Date.now()
        })
      } catch (err) {
        errors.push(`${entry}: ${(err as Error).message}`)
      }
    }
  }

  return { games, errors }
}

/**
 * Art candidates in preference order — not every app has every size, and Valve
 * has been migrating library assets to a second host, so both are tried.
 * Portrait capsules first; the wide header is a last resort that crops, but a
 * cropped real cover still beats a generated one.
 */
export function steamArtCandidates(appId: string, kind: 'cover' | 'hero' | 'logo'): string[] {
  const paths =
    kind === 'cover'
      ? [
          'library_600x900_2x.jpg',
          'library_600x900.jpg',
          'portrait.png',
          'capsule_616x353.jpg',
          'header.jpg'
        ]
      : kind === 'hero'
        ? ['library_hero_2x.jpg', 'library_hero.jpg', 'page_bg_generated_v6b.jpg']
        : ['logo_2x.png', 'logo.png']

  return [
    ...paths.map((path) => `${STEAM_CDN}/${appId}/${path}`),
    // Only reached when the CDN has none of the above; the two hosts mirror
    // each other, so trying the best sizes again is enough.
    ...paths.slice(0, 2).map((path) => `${STEAM_ASSETS}/${appId}/${path}`)
  ]
}
