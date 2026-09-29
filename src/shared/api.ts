import type {
  Capture,
  FriendsSnapshot,
  Game,
  MediaCommand,
  MediaState,
  PowerAction,
  RunningState,
  ScanResult,
  Settings,
  UpdateState,
  WindowAction
} from './types'

export type ArtKind = 'cover' | 'hero' | 'logo'

export interface LibrarySnapshot {
  games: Game[]
  settings: Settings
  running: RunningState[]
}

/** The surface the preload script exposes on window.launcher. */
export interface LauncherApi {
  getLibrary(): Promise<LibrarySnapshot>
  scan(): Promise<ScanResult>

  /** Steam friends who are online. Cached in the main process. */
  getFriends(force?: boolean): Promise<FriendsSnapshot>

  /** What Windows says is playing. Starts the media bridge on first call. */
  getMedia(): Promise<MediaState>
  mediaCommand(command: MediaCommand): Promise<void>
  onMediaChanged(callback: (state: MediaState) => void): () => void

  launch(id: string): Promise<{ ok: boolean; error?: string }>
  stopTracking(id: string): Promise<void>
  patchGame(id: string, patch: Partial<Game>): Promise<Game | undefined>
  removeGame(id: string): Promise<boolean>
  addManualGame(): Promise<Game | null>
  openFolder(id: string): Promise<boolean>

  /** Screenshots and clips of this game, newest first. Empty if it has none. */
  listCaptures(id: string): Promise<Capture[]>
  /** Select a capture's file in Explorer. */
  revealCapture(captureId: string): Promise<void>

  ensureArt(id: string, kind: ArtKind): Promise<string | undefined>
  pickArt(id: string, kind: ArtKind): Promise<string | null>
  clearArt(id: string, kind: ArtKind): Promise<void>

  setSettings(patch: Partial<Settings>): Promise<Settings>
  pickSteamPath(): Promise<Settings | null>
  /** Choose a custom wallpaper; its colours are sampled as it's saved. Null if cancelled. */
  pickBackground(): Promise<Settings | null>
  /** Back to the bundled wallpaper and Vitra's own colours. */
  clearBackground(): Promise<Settings>

  /** Big picture mode takes the whole screen; leaving it restores the window. */
  setFullScreen(on: boolean): Promise<void>
  /** Where updating stands (see UpdateState). */
  getUpdate(): Promise<UpdateState>
  /** Ask GitHub now, whatever the automatic setting. */
  checkForUpdates(): Promise<void>
  /** Download, install and relaunch. Quits Vitra partway. */
  installUpdate(): Promise<void>
  onUpdateChanged(callback: (state: UpdateState) => void): () => void

  /** Sleep, restart or shut down the PC, or quit Vitra. Acts at once. */
  power(action: PowerAction): Promise<void>
  /** Minimise, maximise/restore or close (close-to-tray applies). */
  windowControl(action: WindowAction): Promise<void>
  isMaximized(): Promise<boolean>
  onMaximizedChanged(callback: (maximized: boolean) => void): () => void
  /** Whether this is the installed app (Start with Windows only works there). */
  getAppInfo(): Promise<{ packaged: boolean; version: string; discordConfigured?: boolean }>
  /** The tray's "Big picture" item. */
  onOpenBigPicture(callback: () => void): () => void

  onLibraryChanged(callback: () => void): () => void
  onRunningChanged(callback: (states: RunningState[]) => void): () => void
}
