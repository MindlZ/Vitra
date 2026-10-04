import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ArtKind } from '@shared/api'
import type { Game, GameSource, RunningState, ScanResult, Settings } from '@shared/types'
import { forgetMissingArt, invalidateArt } from './art'
import { copyIds, mergeDuplicates } from './duplicates'

const DEFAULT_SETTINGS: Settings = {
  scanOnStart: true,
  trackPlaytime: true,
  minimiseOnLaunch: true,
  showFriends: true,
  backgroundDim: 65,
  backgroundParticles: true,
  glassBlur: true,
  visualiserPeaks: true,
  visualiserGlow: true,
  slowWhenUnfocused: true,
  perfOverlay: false,
  wallpaper: 'sunset',
  theme: 'auto',
  matchBackgroundColours: true,
  programsView: 'library',
  bigPictureOnStart: false,
  closeToTray: true,
  openAtLogin: false,
  startInTray: false,
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
      forgetMissingArt()
      if (mounted.current) setState((prev) => ({ ...prev, lastScan: result, scanning: false }))
      return result
    } catch (err) {
      if (mounted.current) setState((prev) => ({ ...prev, scanning: false }))
      throw err
    }
  }, [refresh])

  // optimistic; main's broadcast reconciles
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
    if ('steamGridDbKey' in changes || 'steamPath' in changes) forgetMissingArt()
  }, [])

  const pickSteamPath = useCallback(async () => {
    const settings = await window.launcher.pickSteamPath()
    if (settings) {
      setState((prev) => ({ ...prev, settings }))
      forgetMissingArt()
    }
    return settings
  }, [])

  // renderer can hot-reload ahead of preload
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

  // state.games stays raw so a patch lands on the copy it names
  const games = useMemo(() => mergeDuplicates(state.games), [state.games])
  // sessions on a sibling show on the stand-in's card
  const running = useMemo(() => {
    const standIn = new Map<string, string>()
    for (const game of games) for (const sibling of game.siblings ?? []) standIn.set(sibling.id, game.id)
    if (!standIn.size) return state.running
    return state.running.map((session) => ({
      ...session,
      gameId: standIn.get(session.gameId) ?? session.gameId
    }))
  }, [games, state.running])

  // favourite + tags belong to the stand-in, so carry them to the new one
  const setPreferredStore = useCallback(
    async (game: Game, store: GameSource) => {
      const carried = { preferredStore: store, favorite: game.favorite, tags: game.tags }
      await Promise.all(copyIds(game).map((id) => patch(id, carried)))
    },
    [patch]
  )

  return {
    ...state,
    games,
    running,
    setPreferredStore,
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
    // the session may be on any copy
    stopTracking: (id: string) => {
      const game = games.find((candidate) => candidate.id === id)
      return Promise.all((game ? copyIds(game) : [id]).map((copy) => window.launcher.stopTracking(copy)))
    }
  }
}
