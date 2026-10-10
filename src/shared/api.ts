import type {
  AchievementSummary,
  Capture,
  FriendsSnapshot,
  Game,
  LyricLine,
  MediaCommand,
  MediaState,
  PlaySession,
  PowerAction,
  ProcessMetric,
  RunningState,
  ScanResult,
  Settings,
  UpdateState,
  WidgetKind,
  WindowAction
} from './types'

export type ArtKind = 'cover' | 'hero' | 'logo'

export interface WidgetState {
  peaks: boolean
  glow: boolean
  moving: boolean
}

export interface LibrarySnapshot {
  games: Game[]
  settings: Settings
  running: RunningState[]
}

export interface LauncherApi {
  getLibrary(): Promise<LibrarySnapshot>
  scan(): Promise<ScanResult>

  getFriends(force?: boolean): Promise<FriendsSnapshot>
  getAchievements(gameId: string): Promise<AchievementSummary>
  getSessions(): Promise<PlaySession[]>
  // { ok: false } with no error = the dialog was cancelled
  exportBackup(): Promise<{ ok: boolean; error?: string }>
  importBackup(): Promise<{ ok: boolean; error?: string }>
  joinFriend(id: string): Promise<{ ok: boolean; error?: string }>

  getMedia(): Promise<MediaState>
  mediaCommand(command: MediaCommand): Promise<void>
  onMediaChanged(callback: (state: MediaState) => void): () => void

  launch(id: string): Promise<{ ok: boolean; error?: string }>
  stopTracking(id: string): Promise<void>
  patchGame(id: string, patch: Partial<Game>): Promise<Game | undefined>
  removeGame(id: string): Promise<boolean>
  // these open main's file dialog; paths never come from the renderer
  addCompanion(id: string): Promise<Game | undefined>
  removeCompanion(id: string, index: number): Promise<Game | undefined>
  setAfterExit(id: string, clear?: boolean): Promise<Game | undefined>
  addManualGame(): Promise<Game | null>
  openFolder(id: string): Promise<boolean>

  listCaptures(id: string): Promise<Capture[]>
  revealCapture(captureId: string): Promise<void>

  ensureArt(id: string, kind: ArtKind): Promise<string | undefined>
  pickArt(id: string, kind: ArtKind): Promise<string | null>
  clearArt(id: string, kind: ArtKind): Promise<void>

  setSettings(patch: Partial<Settings>): Promise<Settings>
  pickSteamPath(): Promise<Settings | null>
  addGameFolder(): Promise<Settings | null>
  removeGameFolder(index: number): Promise<Settings>
  pickBackground(): Promise<Settings | null>
  clearBackground(): Promise<Settings>

  // resolves once the switch has landed
  setFullScreen(on: boolean): Promise<void>
  getUpdate(): Promise<UpdateState>
  checkForUpdates(): Promise<void>
  installUpdate(): Promise<void>
  onUpdateChanged(callback: (state: UpdateState) => void): () => void

  power(action: PowerAction): Promise<void>
  windowControl(action: WindowAction): Promise<void>
  isMaximized(): Promise<boolean>
  onMaximizedChanged(callback: (maximized: boolean) => void): () => void
  getAppInfo(): Promise<{ packaged: boolean; version: string; discordConfigured?: boolean }>
  getMetrics(): Promise<ProcessMetric[]>
  // main merges its own process samples and system info, then a save dialog
  exportPerfReport(frames: object[]): Promise<{ ok: boolean; error?: string }>
  // synced lyrics for a track; null when off, not found or offline
  getLyrics(track: { title: string; artist: string; album?: string; durationMs?: number }): Promise<LyricLine[] | null>
  // floating widgets: move mode on/off, and the state main pushes to a widget window
  moveWidget(kind: WidgetKind, on: boolean): Promise<void>
  onWidgetState(callback: (state: WidgetState) => void): () => void
  onOpenBigPicture(callback: () => void): () => void

  onLibraryChanged(callback: () => void): () => void
  onRunningChanged(callback: (states: RunningState[]) => void): () => void
}
