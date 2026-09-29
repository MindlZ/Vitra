import { promises as fs } from 'fs'
import { join } from 'path'
import { findSteamPath } from '../paths'

/**
 * Art the user has already customised inside Steam itself, kept in
 * userdata/<account>/config/grid. This covers both Steam games with replaced
 * artwork and non-Steam shortcuts, which have no CDN art at all — so it ranks
 * above every network source.
 *
 * Steam's naming: <appid>p.* is the portrait capsule, <appid>_hero.* the
 * background, <appid>_logo.* the logo and <appid>.* the wide capsule.
 */
const SUFFIXES: Record<'cover' | 'hero' | 'logo', string[]> = {
  cover: ['p', ''],
  hero: ['_hero'],
  logo: ['_logo']
}

const EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp']

/** Cached: this is consulted once per game per art kind. */
let cachedDirs: { key: string; dirs: string[] } | undefined

export function clearGridDirCache(): void {
  cachedDirs = undefined
}

async function gridDirs(steamPathOverride?: string): Promise<string[]> {
  const key = steamPathOverride ?? ''
  if (cachedDirs?.key === key) return cachedDirs.dirs

  const dirs = await locateGridDirs(steamPathOverride)
  cachedDirs = { key, dirs }
  return dirs
}

async function locateGridDirs(steamPathOverride?: string): Promise<string[]> {
  const steamPath = await findSteamPath(steamPathOverride)
  if (!steamPath) return []

  const userdata = join(steamPath, 'userdata')
  let accounts: string[]
  try {
    accounts = await fs.readdir(userdata)
  } catch {
    return []
  }

  const dirs: string[] = []
  for (const account of accounts) {
    if (!/^\d+$/.test(account)) continue
    const dir = join(userdata, account, 'config', 'grid')
    try {
      await fs.access(dir)
      dirs.push(dir)
    } catch {
      // Account has never had custom art set.
    }
  }
  return dirs
}

/** Absolute path to locally stored Steam art for this app id, if any exists. */
export async function findLocalGridArt(
  appId: string,
  kind: 'cover' | 'hero' | 'logo',
  steamPathOverride?: string
): Promise<string | undefined> {
  for (const dir of await gridDirs(steamPathOverride)) {
    for (const suffix of SUFFIXES[kind]) {
      for (const ext of EXTENSIONS) {
        const candidate = join(dir, `${appId}${suffix}.${ext}`)
        try {
          await fs.access(candidate)
          return candidate
        } catch {
          // Next combination.
        }
      }
    }
  }
  return undefined
}
