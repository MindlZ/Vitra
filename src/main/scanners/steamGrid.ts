import { promises as fs } from 'fs'
import { join } from 'path'
import { findSteamPath } from '../paths'

// userdata/<acct>/config/grid: <id>p portrait, <id>_hero, <id>_logo, <id> wide capsule
const SUFFIXES: Record<'cover' | 'hero' | 'logo', string[]> = {
  cover: ['p', ''],
  hero: ['_hero'],
  logo: ['_logo']
}

const EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp']

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
      // never had custom art
    }
  }
  return dirs
}

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
          // try the next one
        }
      }
    }
  }
  return undefined
}
