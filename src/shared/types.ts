export type GameSource =
  | 'steam'
  | 'epic'
  | 'gog'
  | 'xbox'
  | 'battlenet'
  | 'ea'
  | 'ubisoft'
  | 'riot'
  | 'manual'

// sidebar order
export const GAME_SOURCES: readonly GameSource[] = [
  'steam',
  'epic',
  'gog',
  'xbox',
  'battlenet',
  'ea',
  'ubisoft',
  'riot',
  'manual'
]

// Battle.net / Riot take a command line, Ubisoft a URI. scan-only, never patchable
export interface LauncherTarget {
  exe?: string
  args?: string[]
  uri?: string
}

export interface Game {
  // "steam:440", "epic:Fortnite", "manual:<uuid>"
  id: string
  name: string
  source: GameSource

  steamAppId?: string
  epicLaunchUri?: string
  // PackageFamilyName!AppId, for shell:AppsFolder
  xboxAumid?: string
  // store page / install prompt for an owned, uninstalled game
  launchUri?: string
  launcher?: LauncherTarget
  installDir?: string
  exePath?: string
  args?: string
  processHints?: string[]

  coverUrl?: string
  coverFile?: string
  heroUrl?: string
  heroFile?: string
  logoUrl?: string
  logoFile?: string

  tags: string[]
  // from Steam genres, the scan's
  software?: boolean
  // the user's Game/App pick, wins
  softwareOverride?: boolean
  favorite: boolean
  hidden: boolean
  installed: boolean

  playtimeSeconds: number
  sessions: number
  lastPlayed?: number
  addedAt: number

  // main's file dialog only
  companions?: string[]
  closeCompanions?: boolean
  afterExit?: string

  // written to every copy of a merged game
  preferredStore?: GameSource
  // renderer-only (mergeDuplicates), never stored
  siblings?: Game[]
}

export interface Settings {
  steamPath?: string
  scanOnStart: boolean
  trackPlaytime: boolean
  // when a game starts, not when Vitra does
  minimiseOnLaunch: boolean
  steamGridDbKey?: string
  steamWebApiKey?: string
  xboxApiKey?: string
  showFriends: boolean
  backgroundDim: number
  backgroundParticles: boolean
  // backdrop-filter on every glass surface; off for weaker GPUs
  glassBlur: boolean
  visualiserPeaks: boolean
  visualiserGlow: boolean
  slowWhenUnfocused: boolean
  perfOverlay: boolean
  // a custom image is kept while a preset shows
  wallpaper: Wallpaper
  // backgroundImage/Lightness/Palette are main's; the renderer can't set them
  backgroundImage?: string
  backgroundLightness?: number
  backgroundPalette?: Palette
  theme: Theme
  matchBackgroundColours: boolean
  programsView: ProgramsView
  bigPictureOnStart: boolean
  closeToTray: boolean
  openAtLogin: boolean
  startInTray: boolean
  checkForUpdates: boolean
  discordPresence: boolean
  // 0 = never
  screenSaverMinutes: number
  // renderer-bound only; it never gets the keys themselves
  keysSet?: Partial<Record<SecretKey, boolean>>
}

export type ProgramsView = 'library' | 'tab' | 'hidden'

export type Theme = 'auto' | 'light' | 'dark'
export type Appearance = 'light' | 'dark'

export type WallpaperPreset = 'sunset' | 'smoke' | 'tree' | 'moon'
export type Wallpaper = WallpaperPreset | 'custom'

// #rrggbb. accent = primary, accentStrong = its hover, ember = favourites only, tint = sun core
export interface Palette {
  accent: string
  accentStrong: string
  ember: string
  tint: string
}

// encrypted at rest, never sent to the renderer
export const SECRET_KEYS = ['steamWebApiKey', 'steamGridDbKey', 'xboxApiKey'] as const
export type SecretKey = (typeof SECRET_KEYS)[number]

export type FriendState = 'offline' | 'online' | 'busy' | 'away' | 'snooze' | 'trading' | 'playing'

export type FriendStore = 'steam' | 'xbox'

export interface Friend {
  // "steam:<steamid>" | "xbox:<xuid>"
  id: string
  store: FriendStore
  name: string
  avatar?: string
  state: FriendState
  playing?: string
  playingAppId?: string
  // the join URI itself stays in main
  joinable?: boolean
  profileUrl?: string
}

export interface FriendsSnapshot {
  status: 'ok' | 'no-key' | 'no-account' | 'private' | 'error'
  friends: Friend[]
  offline: Friend[]
  offlineCount: number
  // also set on 'ok' when one of two sources failed
  message?: string
  fetchedAt: number
}

export type MediaCommand = 'toggle' | 'next' | 'previous'

export interface UpdateState {
  status:
    | 'unavailable'
    | 'idle'
    | 'checking'
    | 'up-to-date'
    | 'available'
    | 'downloading'
    | 'installing'
    | 'error'
  // dev = running from source, unconfigured = no app-update.yml
  reason?: 'dev' | 'unconfigured'
  currentVersion: string
  version?: string
  releaseUrl?: string
  percent?: number
  message?: string
  checkedAt?: number
}

export type PowerAction = 'sleep' | 'restart' | 'shutdown' | 'quit'

export type WindowAction = 'minimize' | 'toggle-maximize' | 'close'

export interface MediaState {
  active: boolean
  app?: string
  title?: string
  artist?: string
  album?: string
  // Windows' PlaybackStatus: Playing, Paused, Stopped, Changing…
  status?: string
  canPlayPause?: boolean
  canNext?: boolean
  canPrevious?: boolean
  // as of updatedAt; players only report on change/seek
  positionMs?: number
  durationMs?: number
  updatedAt?: number
  artKey?: string
  // data: URL
  art?: string
}

export interface Capture {
  id: string
  kind: 'image' | 'video'
  source: 'steam' | 'gamebar' | 'folder'
  // file mtime
  takenAt: number
  name: string
}

export interface LibraryData {
  version: number
  games: Game[]
  settings: Settings
}

export type SortKey = 'name' | 'lastPlayed' | 'playtime' | 'added'

export interface ScanResult {
  added: number
  updated: number
  missing: number
  bySource: Record<string, number>
  errors: string[]
}

export interface Achievement {
  name: string
  description?: string
  icon?: string
  // % of all players, 0-100
  percent?: number
  unlockedAt?: number
}

export interface AchievementSummary {
  // private = the profile's game details aren't public
  status: 'ok' | 'none' | 'no-key' | 'private' | 'error'
  unlocked: number
  total: number
  rarest: Achievement[]
  fetchedAt: number
}

export interface PlaySession {
  gameId: string
  start: number
  end: number
}

export interface RunningState {
  gameId: string
  startedAt: number
  // false until the process has actually been seen
  confirmed: boolean
}

// app.getAppMetrics(), for the performance overlay. cpu = % of one core since the last call
export interface ProcessMetric {
  type: string
  cpu: number
  memoryMb: number
}
