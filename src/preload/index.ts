import { contextBridge, ipcRenderer } from 'electron'
import type { ArtKind, LauncherApi } from '../shared/api'
import type {
  Game,
  MediaCommand,
  MediaState,
  PowerAction,
  RunningState,
  Settings,
  UpdateState,
  WindowAction
} from '../shared/types'

const api: LauncherApi = {
  getLibrary: () => ipcRenderer.invoke('library:get'),
  scan: () => ipcRenderer.invoke('library:scan'),
  getFriends: (force?: boolean) => ipcRenderer.invoke('friends:get', force),

  getMedia: () => ipcRenderer.invoke('media:get'),
  mediaCommand: (command: MediaCommand) => ipcRenderer.invoke('media:command', command),
  onMediaChanged: (callback: (state: MediaState) => void) => {
    const listener = (_e: unknown, state: MediaState): void => callback(state)
    ipcRenderer.on('media:changed', listener)
    return () => ipcRenderer.removeListener('media:changed', listener)
  },

  launch: (id: string) => ipcRenderer.invoke('game:launch', id),
  stopTracking: (id: string) => ipcRenderer.invoke('game:stop-tracking', id),
  patchGame: (id: string, patch: Partial<Game>) => ipcRenderer.invoke('game:patch', id, patch),
  removeGame: (id: string) => ipcRenderer.invoke('game:remove', id),
  addManualGame: () => ipcRenderer.invoke('game:add-manual'),
  openFolder: (id: string) => ipcRenderer.invoke('game:open-folder', id),

  listCaptures: (id: string) => ipcRenderer.invoke('captures:list', id),
  revealCapture: (captureId: string) => ipcRenderer.invoke('captures:reveal', captureId),

  ensureArt: (id: string, kind: ArtKind) => ipcRenderer.invoke('art:ensure', id, kind),
  pickArt: (id: string, kind: ArtKind) => ipcRenderer.invoke('art:pick', id, kind),
  clearArt: (id: string, kind: ArtKind) => ipcRenderer.invoke('art:clear', id, kind),

  setSettings: (patch: Partial<Settings>) => ipcRenderer.invoke('settings:set', patch),
  pickSteamPath: () => ipcRenderer.invoke('settings:pick-steam-path'),
  pickBackground: () => ipcRenderer.invoke('settings:pick-background'),
  clearBackground: () => ipcRenderer.invoke('settings:clear-background'),
  setFullScreen: (on: boolean) => ipcRenderer.invoke('window:set-fullscreen', on),
  getUpdate: () => ipcRenderer.invoke('update:get'),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onUpdateChanged: (callback: (state: UpdateState) => void) => {
    const listener = (_e: unknown, state: UpdateState): void => callback(state)
    ipcRenderer.on('update:changed', listener)
    return () => ipcRenderer.removeListener('update:changed', listener)
  },
  power: (action: PowerAction) => ipcRenderer.invoke('system:power', action),
  windowControl: (action: WindowAction) => ipcRenderer.invoke('window:control', action),
  isMaximized: () => ipcRenderer.invoke('window:is-maximized'),
  onMaximizedChanged: (callback: (maximized: boolean) => void) => {
    const listener = (_e: unknown, maximized: boolean): void => callback(maximized)
    ipcRenderer.on('window:maximized', listener)
    return () => ipcRenderer.removeListener('window:maximized', listener)
  },
  getAppInfo: () => ipcRenderer.invoke('app:info'),
  onOpenBigPicture: (callback: () => void) => {
    const listener = (): void => callback()
    ipcRenderer.on('app:open-big-picture', listener)
    return () => ipcRenderer.removeListener('app:open-big-picture', listener)
  },

  onLibraryChanged: (callback: () => void) => {
    const listener = (): void => callback()
    ipcRenderer.on('library:changed', listener)
    return () => ipcRenderer.removeListener('library:changed', listener)
  },
  onRunningChanged: (callback: (states: RunningState[]) => void) => {
    const listener = (_e: unknown, states: RunningState[]): void => callback(states)
    ipcRenderer.on('running:changed', listener)
    return () => ipcRenderer.removeListener('running:changed', listener)
  }
}

contextBridge.exposeInMainWorld('launcher', api)
