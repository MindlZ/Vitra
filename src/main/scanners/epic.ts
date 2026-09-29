import { promises as fs } from 'fs'
import { join } from 'path'
import { epicCatalogFile, epicManifestDir } from '../paths'
import type { Game } from '../../shared/types'

interface EpicManifest {
  DisplayName?: string
  AppName?: string
  InstallLocation?: string
  LaunchExecutable?: string
  CatalogNamespace?: string
  CatalogItemId?: string
  AppCategories?: string[]
  MainGameAppName?: string
  bIsApplication?: boolean
  bIsIncompleteInstall?: boolean
  MainWindowProcessName?: string
  ProcessNames?: string[]
  VaultThumbnailUrl?: string
}

/** One entry of the launcher's catalogue cache (catcache.bin), trimmed to what we read. */
interface CatalogItem {
  id?: string
  namespace?: string
  title?: string
  categories?: Array<{ path?: string }>
  keyImages?: Array<{ type?: string; url?: string }>
  mainGameItem?: { id?: string }
  releaseInfo?: Array<{ appId?: string; platform?: string[] }>
}

/** An owned game from the catalogue, keyed by the AppName its manifest would carry. */
interface OwnedEntry {
  appName: string
  item: CatalogItem
}

/**
 * Epic launches through its own client so ownership/EOS auth is satisfied.
 * Format: com.epicgames.launcher://apps/<namespace>:<catalogItemId>:<appName>?action=launch
 * For a game that isn't installed, action=install opens the launcher's install dialog.
 */
function launchUri(
  namespace: string | undefined,
  itemId: string | undefined,
  appName: string | undefined,
  action: 'launch' | 'install' = 'launch'
): string | undefined {
  if (!namespace || !itemId || !appName) return undefined
  const id = [namespace, itemId, appName].map(encodeURIComponent).join('%3A')
  return `com.epicgames.launcher://apps/${id}?action=${action}&silent=true`
}

function image(item: CatalogItem | undefined, ...types: string[]): string | undefined {
  for (const type of types) {
    const url = item?.keyImages?.find((entry) => entry.type === type)?.url
    if (url && /^https?:\/\//.test(url)) return url
  }
  return undefined
}

/** Side builds that ship as their own app next to the real game. */
const SIDE_BUILD = /\b(public test(ing)?|experimental|playtest|test server)\b/i

/**
 * The catalogue cache holds the account's library, but also the launcher's
 * own odds and ends (Twinmotion/RealityCapture audiences, promos, add-ons).
 * A game is: filed under "games", not an add-on or audience, not DLC (which
 * names a main game), and released for Windows.
 */
function ownedGame(item: CatalogItem): OwnedEntry | undefined {
  const paths = (item.categories ?? []).map((category) => category.path ?? '')
  if (!paths.includes('games')) return undefined
  if (paths.some((path) => path.startsWith('addons') || path.startsWith('audience'))) return undefined
  if (item.mainGameItem?.id) return undefined
  if (!item.title || SIDE_BUILD.test(item.title)) return undefined
  const release = item.releaseInfo?.find((entry) => entry.appId && entry.platform?.includes('Windows'))
  return release?.appId ? { appName: release.appId, item } : undefined
}

/** Owned games by AppName. Empty if the launcher has never cached a library. */
async function readCatalog(): Promise<Map<string, OwnedEntry>> {
  const owned = new Map<string, OwnedEntry>()
  let items: CatalogItem[]
  try {
    const raw = await fs.readFile(epicCatalogFile(), 'utf8')
    items = JSON.parse(Buffer.from(raw.trim(), 'base64').toString('utf8')) as CatalogItem[]
  } catch {
    return owned
  }
  if (!Array.isArray(items)) return owned
  for (const item of items) {
    const entry = ownedGame(item)
    if (entry && !owned.has(entry.appName)) owned.set(entry.appName, entry)
  }
  return owned
}

function isGame(m: EpicManifest): boolean {
  if (m.bIsIncompleteInstall) return false
  if (m.bIsApplication === false) return false
  if (!m.LaunchExecutable) return false
  const categories = m.AppCategories ?? []
  if (categories.includes('addons')) return false
  // DLC / expansions point at a different parent app.
  if (m.MainGameAppName && m.MainGameAppName !== m.AppName) return false
  return categories.length === 0 || categories.includes('games')
}

export async function scanEpic(): Promise<{ games: Game[]; owned: number; errors: string[] }> {
  const errors: string[] = []
  const dir = epicManifestDir()
  const catalog = await readCatalog()

  let entries: string[]
  try {
    entries = await fs.readdir(dir)
  } catch {
    // No manifests is fine if the catalogue still lists owned games.
    if (!catalog.size) return { games: [], owned: 0, errors: ['Epic Games Launcher not found.'] }
    entries = []
  }

  const games: Game[] = []
  const seen = new Set<string>()

  for (const entry of entries) {
    if (!entry.toLowerCase().endsWith('.item')) continue
    try {
      const manifest = JSON.parse(await fs.readFile(join(dir, entry), 'utf8')) as EpicManifest
      if (!isGame(manifest)) continue

      const appName = manifest.AppName
      const name = manifest.DisplayName ?? appName
      if (!appName || !name || seen.has(appName)) continue
      seen.add(appName)

      const installDir = manifest.InstallLocation
      // LaunchExecutable is forward-slashed; join() normalises it for Windows.
      const exePath =
        installDir && manifest.LaunchExecutable
          ? join(installDir, manifest.LaunchExecutable)
          : undefined

      // Epic tells us exactly which processes belong to the game — use it.
      const hints = [
        manifest.MainWindowProcessName,
        ...(manifest.ProcessNames ?? []),
        manifest.LaunchExecutable?.split(/[\\/]/).pop()
      ].filter((n): n is string => Boolean(n && n.toLowerCase().endsWith('.exe')))

      // The catalogue's tall box art beats the vault thumbnail when it has it.
      const listed = catalog.get(appName)?.item
      const thumbnail = manifest.VaultThumbnailUrl
      games.push({
        id: `epic:${appName}`,
        name,
        source: 'epic',
        epicLaunchUri: launchUri(manifest.CatalogNamespace, manifest.CatalogItemId, appName),
        installDir,
        exePath,
        processHints: [...new Set(hints.map((h) => h.toLowerCase()))],
        coverUrl:
          image(listed, 'DieselGameBoxTall', 'OfferImageTall') ??
          (thumbnail && /^https?:\/\//.test(thumbnail) ? thumbnail : undefined),
        heroUrl: image(listed, 'DieselGameBox', 'OfferImageWide'),
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

  // Everything else in the library: owned, not on disk. Launching one opens
  // the Epic launcher's install dialog.
  let owned = 0
  for (const { appName, item } of catalog.values()) {
    if (seen.has(appName)) continue
    seen.add(appName)
    owned++
    games.push({
      id: `epic:${appName}`,
      // The cache has lost some trademark signs to a literal "?" ("The Sims? 4").
      name: item.title!.replace(/(?<=\p{L})\?(?= \d)/gu, ''),
      source: 'epic',
      epicLaunchUri: launchUri(item.namespace, item.id, appName, 'install'),
      processHints: [],
      coverUrl: image(item, 'DieselGameBoxTall', 'OfferImageTall'),
      heroUrl: image(item, 'DieselGameBox', 'OfferImageWide'),
      tags: [],
      favorite: false,
      hidden: false,
      installed: false,
      playtimeSeconds: 0,
      sessions: 0,
      addedAt: Date.now()
    })
  }

  return { games, owned, errors }
}
