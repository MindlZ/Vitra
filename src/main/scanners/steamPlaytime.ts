import { promises as fs } from 'fs'
import { join } from 'path'
import { parseVdf, pickNode, pickString } from '../vdf'
import { findSteamPath } from '../paths'

export interface SteamPlaytime {
  /** appid -> seconds played, as recorded by Steam itself */
  seconds: Record<string, number>
  /** appid -> epoch ms */
  lastPlayed: Record<string, number>
  /** Every app id tied to the account, installed or not. */
  knownAppIds: string[]
}

/**
 * Steam records per-app config (including hours) in each user's localconfig.vdf.
 * It's both our playtime source and the only no-API-key way to learn which apps
 * the account actually owns — installed or not.
 */
export async function readSteamPlaytime(steamPathOverride?: string): Promise<SteamPlaytime> {
  const result: SteamPlaytime = { seconds: {}, lastPlayed: {}, knownAppIds: [] }
  const steamPath = await findSteamPath(steamPathOverride)
  if (!steamPath) return result

  const userdata = join(steamPath, 'userdata')
  let accounts: string[]
  try {
    accounts = await fs.readdir(userdata)
  } catch {
    return result
  }

  const known = new Set<string>()

  for (const account of accounts) {
    if (!/^\d+$/.test(account)) continue
    try {
      const raw = await fs.readFile(join(userdata, account, 'config', 'localconfig.vdf'), 'utf8')
      const parsed = parseVdf(raw)
      const apps = pickNode(
        pickNode(
          pickNode(pickNode(pickNode(parsed, 'UserLocalConfigStore'), 'Software'), 'Valve'),
          'Steam'
        ),
        'apps'
      )
      if (!apps) continue

      for (const [appId, value] of Object.entries(apps)) {
        if (!/^\d+$/.test(appId) || typeof value === 'string') continue
        known.add(appId)

        const minutes = Number(pickString(value, 'Playtime') ?? '0')
        const lastPlayed = Number(pickString(value, 'LastPlayed') ?? '0')
        if (Number.isFinite(minutes) && minutes > 0) {
          // Several Steam accounts can share a machine; take the largest total.
          result.seconds[appId] = Math.max(result.seconds[appId] ?? 0, Math.round(minutes * 60))
        }
        if (Number.isFinite(lastPlayed) && lastPlayed > 0) {
          result.lastPlayed[appId] = Math.max(result.lastPlayed[appId] ?? 0, lastPlayed * 1000)
        }
      }
    } catch {
      // Account without a readable localconfig — skip it.
    }
  }

  result.knownAppIds = [...known]
  return result
}
