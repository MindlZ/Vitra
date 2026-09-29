import { promises as fs } from 'fs'
import { join } from 'path'
import { parseVdf, pickNode, pickString } from '../vdf'
import { findSteamPath } from '../paths'

export interface SteamAccount {
  /** 64-bit id, which is what the Web API expects. */
  steamId: string
  personaName?: string
  accountName?: string
}

/**
 * The signed-in Steam account, read from config/loginusers.vdf. Saves the user
 * from having to find their own SteamID64 to use the friends list.
 */
export async function findSteamAccount(steamPathOverride?: string): Promise<SteamAccount | undefined> {
  const steamPath = await findSteamPath(steamPathOverride)
  if (!steamPath) return undefined

  let raw: string
  try {
    raw = await fs.readFile(join(steamPath, 'config', 'loginusers.vdf'), 'utf8')
  } catch {
    return undefined
  }

  const users = pickNode(parseVdf(raw), 'users')
  if (!users) return undefined

  let best: (SteamAccount & { rank: number }) | undefined

  for (const [steamId, value] of Object.entries(users)) {
    if (!/^\d{17}$/.test(steamId) || typeof value === 'string') continue

    // Prefer the account Steam marks as most recent; fall back to newest login.
    const mostRecent = pickString(value, 'MostRecent') === '1'
    const timestamp = Number(pickString(value, 'Timestamp') ?? '0')
    const rank = mostRecent ? Number.MAX_SAFE_INTEGER : timestamp

    if (!best || rank > best.rank) {
      best = {
        rank,
        steamId,
        personaName: pickString(value, 'PersonaName'),
        accountName: pickString(value, 'AccountName')
      }
    }
  }

  if (!best) return undefined
  const { rank: _rank, ...account } = best
  return account
}
