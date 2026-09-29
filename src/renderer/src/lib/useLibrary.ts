import { useCallback, useEffect, useRef, useState } from 'react'
import type { ArtKind } from '@shared/api'
import type { Game, RunningState, ScanResult, Settings } from '@shared/types'
import { invalidateArt } from './art'

const DEFAULT_SETTINGS: Settings = {
  scanOnStart: true,
  trackPlaytime: true,
  minimiseOnLaunch: true,
  showFriends: true,
  backgroundDim: 65,
  wallpaper: 'sunset',
  theme: 'auto',
  matchBackgroundColours: true,
  programsView: 'library',
  bigPictureOnStart: false,
  closeToTray: true,
  openAtLogin: false,
  checkForUpdates: true,
  discordPresence: false,
  screenSaverMinutes: 5
}

export interface LibraryState {
  games: Game[]
  settings: Settings
  running: RunningState[]
  loading: boolean
  scanning: boolean
  lastScan: ScanResult | null
}

export function useLibrary() {
  const [state, setState] = useState<LibraryState>({
    games: [],
    settings: DEFAULT_SETTINGS,
    running: [],
    loading: true,
    scanning: false,
    lastScan: null
  })
  const mounted = useRef(true)

  const refresh = useCallback(async () => {
    const snapshot = await window.launcher.getLibrary()
    if (!mounted.current) return
    setState((prev) => ({
      ...prev,
      games: snapshot.games,
      settings: snapshot.settings,
      running: snapshot.running,
      loading: false
    }))
  }, [])

  useEffect(() => {
    mounted.current = true
    void refresh()

    const offLibrary = window.launcher.onLibraryChanged(() => void refresh())
    const offRunning = window.launcher.onRunningChanged((running) =>
      setState((prev) => ({ ...prev, running }))
    )

    return () => {
      mounted.current = false
      offLibrary()
      offRunning()
    }
  }, [refresh])

  const scan = useCallback(async () => {
    setState((prev) => ({ ...prev, scanning: true }))
    try {
      const result = await window.launcher.scan()
      await refresh()
      if (mounted.current) setState((prev) => ({ ...prev, lastScan: result, scanning: false }))
      return result
    } catch (err) {
      if (mounted.current) setState((prev) => ({ ...prev, scanning: false }))
      throw err
    }
  }, [refresh])

  /** Optimistic patch — the main process broadcast reconciles it moments later. */
  const patch = useCallback(async (id: string, changes: Partial<Game>) => {
    setState((prev) => ({
      ...prev,
      games: prev.games.map((g) => (g.id === id ? { ...g, ...changes } : g))
    }))
    await window.launcher.patchGame(id, changes)
  }, [])

  const launch = useCallback(async (id: string) => window.launcher.launch(id), [])

  const remove = useCallback(
    async (id: string) => {
      await window.launcher.removeGame(id)
      await refresh()
    },
    [refresh]
  )

  const addManual = useCallback(async () => {
    const game = await window.launcher.addManualGame()
    if (game) await refresh()
    return game
  }, [refresh])

  const pickArt = useCallback(async (id: string, kind: ArtKind) => {
    const file = await window.launcher.pickArt(id, kind)
    if (file) invalidateArt(id, kind)
    return file
  }, [])

  const clearArt = useCallback(async (id: string, kind: ArtKind) => {
    await window.launcher.clearArt(id, kind)
    invalidateArt(id, kind)
  }, [])

  const updateSettings = useCallback(async (changes: Partial<Settings>) => {
    const settings = await window.launcher.setSettings(changes)
    setState((prev) => ({ ...prev, settings }))
  }, [])

  const pickSteamPath = useCallback(async () => {
    const settings = await window.launcher.pickSteamPath()
    if (settings) setState((prev) => ({ ...prev, settings }))
    return settings
  }, [])

  // Guarded: a renderer can hot-reload ahead of the preload that adds these.
  const pickBackground = useCallback(async () => {
    if (!window.launcher.pickBackground) return null
    const settings = await window.launcher.pickBackground()
    if (settings) setState((prev) => ({ ...prev, settings }))
    return settings
  }, [])

  const clearBackground = useCallback(async () => {
    if (!window.launcher.clearBackground) return
    const settings = await window.launcher.clearBackground()
    setState((prev) => ({ ...prev, settings }))
  }, [])

  return {
    ...state,
    refresh,
    scan,
    patch,
    launch,
    remove,
    addManual,
    pickArt,
    clearArt,
    updateSettings,
    pickSteamPath,
    pickBackground,
    clearBackground,
    openFolder: (id: string) => window.launcher.openFolder(id),
    stopTracking: (id: string) => window.launcher.stopTracking(id)
  }
}
