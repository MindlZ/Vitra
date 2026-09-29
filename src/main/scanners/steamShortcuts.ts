import { existsSync, promises as fs } from 'fs'
import { basename, dirname, join } from 'path'
import { findSteamPath } from '../paths'
import { binaryNumber, binaryString, parseBinaryVdf, pickBinary } from '../vdfBinary'
import type { BinaryVdfNode } from '../vdfBinary'
import type { Game } from '../../shared/types'

/**
 * Exe is normally quoted and may carry trailing arguments; StartDir is a bare
 * path that can contain spaces. Never split on whitespace — cut at the
 * executable extension instead, and otherwise take the field whole.
 */
function parsePathField(raw: string | undefined): string | undefined {
  if (!raw) return undefined
  const trimmed = raw.trim()
  if (!trimmed) return undefined

  const quoted = trimmed.match(/^"([^"]+)"/)
  if (quoted) return quoted[1]

  const exe = trimmed.match(/^(.*?\.(?:exe|bat|cmd|lnk))(?:\s|$)/i)
  return exe ? exe[1] : trimmed
}

/**
 * Non-Steam games the user added to their Steam library. These live only in
 * shortcuts.vdf and have no app manifest, so they're invisible to the normal
 * Steam scan.
 */
export async function scanSteamShortcuts(
  steamPathOverride?: string
): Promise<{ games: Game[]; errors: string[] }> {
  const errors: string[] = []
  const steamPath = await findSteamPath(steamPathOverride)
  if (!steamPath) return { games: [], errors: [] }

  const userdata = join(steamPath, 'userdata')
  let accounts: string[]
  try {
    accounts = await fs.readdir(userdata)
  } catch {
    return { games: [], errors: [] }
  }

  const games: Game[] = []
  const seen = new Set<string>()

  for (const account of accounts) {
    if (!/^\d+$/.test(account)) continue
    const file = join(userdata, account, 'config', 'shortcuts.vdf')

    let parsed: BinaryVdfNode
    try {
      parsed = parseBinaryVdf(await fs.readFile(file))
    } catch (err) {
      if (existsSync(file)) errors.push(`shortcuts.vdf: ${(err as Error).message}`)
      continue
    }

    const root = pickBinary(parsed, 'shortcuts')
    const entries = root && typeof root === 'object' ? root : parsed

    for (const value of Object.values(entries)) {
      if (!value || typeof value !== 'object') continue
      const entry = value as BinaryVdfNode

      const name = binaryString(entry, 'AppName') ?? binaryString(entry, 'appname')
      const exePath = parsePathField(binaryString(entry, 'Exe') ?? binaryString(entry, 'exe'))
      if (!name || !exePath) continue

      // appid is a signed int32 in the file; normalise so the id is stable.
      const rawId = binaryNumber(entry, 'appid')
      const key = rawId !== undefined ? String(rawId >>> 0) : exePath.toLowerCase()
      const id = `steam:shortcut-${key}`
      if (seen.has(id)) continue
      seen.add(id)

      const startDir = parsePathField(binaryString(entry, 'StartDir')) ?? dirname(exePath)
      const lastPlayTime = binaryNumber(entry, 'LastPlayTime') ?? 0
      const launchOptions = binaryString(entry, 'LaunchOptions')?.trim()

      games.push({
        id,
        name,
        // Shown under Steam because that's where the user added it, but it has
        // no app id, so launch() falls through to running the exe directly.
        source: 'steam',
        installDir: existsSync(startDir) ? startDir : undefined,
        exePath,
        args: launchOptions || undefined,
        processHints: [basename(exePath).toLowerCase()],
        tags: [],
        favorite: false,
        hidden: binaryNumber(entry, 'IsHidden') === 1,
        installed: existsSync(exePath),
        playtimeSeconds: 0,
        sessions: 0,
        lastPlayed: lastPlayTime > 0 ? lastPlayTime * 1000 : undefined,
        addedAt: Date.now()
      })
    }
  }

  return { games, errors }
}
