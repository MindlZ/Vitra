export type GameSource = 'steam' | 'epic' | 'gog' | 'xbox' | 'manual'

export interface Game {
  /** Stable id, e.g. "steam:440" / "epic:Fortnite" / "manual:<uuid>" */
  id: string
  name: string
  source: GameSource

  /** Steam */
  steamAppId?: string
  /** Epic launch URI pieces */
  epicLaunchUri?: string
  /** Xbox / Microsoft Store app id (PackageFamilyName!AppId), launched via shell:AppsFolder. */
  xboxAumid?: string
  /** A store's own page or install prompt, for an owned game that isn't on disk (GOG Galaxy). */
  launchUri?: string
  /** Where the game lives on disk, used for art fallbacks + process watching */
  installDir?: string
  /** Direct executable (manual games, and the Epic/Steam fallback) */
  exePath?: string
  args?: string
  /** Extra exe names to treat as "the game is running" (process watcher) */
  processHints?: string[]

  /** Art. Remote URLs are cached to disk on first use; cover is the portrait card. */
  coverUrl?: string
  coverFile?: string
  heroUrl?: string
  heroFile?: string
  logoUrl?: string
  logoFile?: string

  tags: string[]
  /**
   * Software rather than a game (Wallpaper Engine, Lossless Scaling), detected
   * from Steam's genres. Owned by the scan.
   */
  software?: boolean
  /** The user's call on the above; wins when set. Owned by the user. */
  softwareOverride?: boolean
  favorite: boolean
  hidden: boolean
  /** False when a store game was in the library before but is not on disk now. */
  installed: boolean

  playtimeSeconds: number
  sessions: number
  lastPlayed?: number
  addedAt: number
}

export interface Settings {
  steamPath?: string
  scanOnStart: boolean
  trackPlaytime: boolean
  /** Minimise the launcher while a game is running */
  minimiseOnLaunch: boolean
  /** Optional, free from steamgriddb.com — unlocks art for non-Steam games. */
  steamGridDbKey?: string
  /** Optional, free from steamcommunity.com/dev/apikey — unlocks the friends list. */
  steamWebApiKey?: string
  /** Show the friends rail. */
  showFriends: boolean
  /** 0-100. How much of the wallpaper the veil hides. */
  backgroundDim: number
  /**
   * Which wallpaper shows: one of the bundled ones, or `custom` for
   * backgroundImage. A custom image is kept while a preset is shown, so
   * switching back is one click.
   */
  wallpaper: Wallpaper
  /** A custom wallpaper: a file in the art cache. Owned by main. */
  backgroundImage?: string
  /** backgroundImage's mean lightness, 0-1 (measureLightness). Owned by main. */
  backgroundLightness?: number
  /** Colours sampled from backgroundImage when it was picked. Owned by main. */
  backgroundPalette?: Palette
  theme: Theme
  /** Re-colour the UI from backgroundPalette rather than Vitra's own magenta. */
  matchBackgroundColours: boolean
  /**
   * Where programs (Wallpaper Engine, Lossless Scaling, Aimlabs; see
   * isSoftware) appear: mixed into the library, in their own Programs tab,
   * or nowhere.
   */
  programsView: ProgramsView
  /** Open straight into big picture mode (fullscreen, controller-first). */
  bigPictureOnStart: boolean
  /** Closing the window hides Vitra to the tray instead of quitting. */
  closeToTray: boolean
  /** Start with Windows (into the tray). Only registered by the installed app. */
  openAtLogin: boolean
  /** Ask GitHub for a newer release on start and every few hours. */
  checkForUpdates: boolean
  /** Show the running game as your Discord status (Rich Presence). */
  discordPresence: boolean
  /** Minutes without input before the screen saver; 0 turns it off. */
  screenSaverMinutes: number
  /**
   * Filled only on the way to the renderer, which never receives the keys
   * themselves — just whether each one is saved. Ignored on write.
   */
  keysSet?: Partial<Record<SecretKey, boolean>>
}

export type ProgramsView = 'library' | 'tab' | 'hidden'

/** Light or dark UI; `auto` follows the wallpaper's lightness. */
export type Theme = 'auto' | 'light' | 'dark'
export type Appearance = 'light' | 'dark'

export type WallpaperPreset = 'sunset' | 'smoke' | 'tree' | 'moon'
export type Wallpaper = WallpaperPreset | 'custom'

/**
 * UI colours taken from a wallpaper, as #rrggbb. Mirrors the brand roles:
 * accent is the primary (Vitra's magenta), accentStrong its hover, ember the
 * favourites colour, tint the pale core of the sun and the horizon.
 */
export interface Palette {
  accent: string
  accentStrong: string
  ember: string
  tint: string
}

/** Settings fields that are encrypted at rest and never sent to the renderer. */
export const SECRET_KEYS = ['steamWebApiKey', 'steamGridDbKey'] as const
export type SecretKey = (typeof SECRET_KEYS)[number]

/** Steam's persona states, in the order the API reports them. */
export type FriendState = 'offline' | 'online' | 'busy' | 'away' | 'snooze' | 'trading' | 'playing'

export interface Friend {
  steamId: string
  name: string
  avatar?: string
  state: FriendState
  /** Set when the friend is in a game. */
  playing?: string
  /** Steam app id of what they're playing, when it's a Steam game. */
  playingAppId?: string
  profileUrl?: string
}

export interface FriendsSnapshot {
  status: 'ok' | 'no-key' | 'no-account' | 'private' | 'error'
  /** Everyone who isn't offline, most interesting first. */
  friends: Friend[]
  /** Everyone who is offline, by name. Home shows these faded when nobody's on. */
  offline: Friend[]
  offlineCount: number
  /** Populated when status isn't "ok". */
  message?: string
  fetchedAt: number
}

export type MediaCommand = 'toggle' | 'next' | 'previous'

/**
 * Where updating stands. `unavailable` means this copy can't update itself:
 * running from source (`dev`), or built before a GitHub repo was set
 * (`unconfigured`).
 */
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
  reason?: 'dev' | 'unconfigured'
  currentVersion: string
  /** The newer version, once one is found. */
  version?: string
  /** Its GitHub release page, for "What's new". */
  releaseUrl?: string
  /** 0-100 while downloading. */
  percent?: number
  message?: string
  checkedAt?: number
}

/** Big picture's power menu. */
export type PowerAction = 'sleep' | 'restart' | 'shutdown' | 'quit'

/** The title bar's own caption buttons. */
export type WindowAction = 'minimize' | 'toggle-maximize' | 'close'

/** What Windows says is playing (its media session), for Home's now-playing card. */
export interface MediaState {
  active: boolean
  /** The player's app id, e.g. "Spotify.exe". */
  app?: string
  title?: string
  artist?: string
  album?: string
  /** Windows' PlaybackStatus: "Playing", "Paused", "Stopped", "Changing"… */
  status?: string
  canPlayPause?: boolean
  canNext?: boolean
  canPrevious?: boolean
  /** Position as of updatedAt; players only report it on changes and seeks. */
  positionMs?: number
  durationMs?: number
  updatedAt?: number
  /** Identifies the track the artwork belongs to. */
  artKey?: string
  /** Artwork as a data: URL, once read. */
  art?: string
}

/**
 * A screenshot or clip of a game, found on disk (Steam's screenshots, the
 * Xbox Game Bar's Captures folder, a recorder's per-game folder). Served by
 * id over applib://capture/<id>; the renderer never sees the path.
 */
export interface Capture {
  id: string
  kind: 'image' | 'video'
  source: 'steam' | 'gamebar' | 'folder'
  /** The file's modified time, ms. */
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

export interface RunningState {
  gameId: string
  startedAt: number
  /** true once we've actually seen the game process, false while still waiting */
  confirmed: boolean
}
