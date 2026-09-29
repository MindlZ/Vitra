import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, Plus, RefreshCw, SearchX } from 'lucide-react'
import type { ArtKind } from '@shared/api'
import type { Game, Palette, ProgramsView, SortKey } from '@shared/types'
import Backdrop from './components/Backdrop'
import BigPicture from './components/BigPicture'
import Dropdown from './components/Dropdown'
import FriendsPanel from './components/FriendsPanel'
import GameDetail from './components/GameDetail'
import GameGrid from './components/GameGrid'
import Home from './components/Home'
import SettingsDialog from './components/SettingsDialog'
import Sidebar, { type Filter } from './components/Sidebar'
import ScreenSaver from './components/ScreenSaver'
import Splash from './components/Splash'
import TitleBar from './components/TitleBar'
import Toast from './components/Toast'
import { inLibrary, isSoftware, matchesQuery, sourceLabel } from './lib/format'
import { useGamepad } from './lib/gamepad'
import { useIdle } from './lib/idle'
import { playSound } from './lib/sound'
import { applyAppearance, applyPalette } from './lib/theme'
import { activeWallpaper, appearanceFor } from './lib/wallpapers'
import { useLibrary } from './lib/useLibrary'

const SORT_LABELS: Record<SortKey, string> = {
  name: 'Name',
  lastPlayed: 'Last played',
  playtime: 'Most played',
  added: 'Recently added'
}

function titleFor(filter: Filter): string {
  if (filter === 'home') return 'Home'
  if (filter === 'all') return 'All games'
  if (filter === 'recent') return 'Recently played'
  if (filter === 'favorites') return 'Favourites'
  if (filter === 'unplayed') return 'Never played'
  if (filter === 'uninstalled') return 'Not installed'
  if (filter === 'hidden') return 'Hidden'
  if (filter === 'programs') return 'Programs'
  if (filter.startsWith('source:')) {
    const source = filter.slice(7)
    return source === 'manual' ? 'Local files' : sourceLabel(source)
  }
  if (filter.startsWith('tag:')) return filter.slice(4)
  return 'Library'
}

/**
 * Applies the sidebar scope. Games that are owned but not on disk belong to
 * every view — "Not installed" is a lens on the library, not a partition of it.
 * Kept in step with the counts Sidebar shows (both go through inLibrary).
 */
function inScope(game: Game, filter: Filter, programsView: ProgramsView): boolean {
  if (filter === 'hidden') return game.hidden
  if (filter === 'programs') return !game.hidden && isSoftware(game)
  if (!inLibrary(game, programsView)) return false

  if (filter === 'all') return true
  if (filter === 'uninstalled') return !game.installed
  if (filter === 'favorites') return game.favorite
  if (filter === 'recent') return Boolean(game.lastPlayed)
  if (filter === 'unplayed') return !game.playtimeSeconds
  if (filter.startsWith('source:')) return game.source === filter.slice(7)
  if (filter.startsWith('tag:')) return game.tags.includes(filter.slice(4))
  return true
}

/*
 * The sidebar's state is a per-machine view preference, not library data, so
 * it lives in localStorage rather than library.json and the settings IPC.
 * Storage can throw (blocked site data), hence the guards.
 */
const SIDEBAR_KEY = 'vitra.sidebarCollapsed'

function readSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_KEY) === '1'
  } catch {
    return false
  }
}

function writeSidebarCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(SIDEBAR_KEY, collapsed ? '1' : '0')
  } catch {
    // Not worth surfacing: it only means the choice isn't remembered.
  }
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** Resolves after `count` painted frames. */
function frames(count: number): Promise<void> {
  return new Promise((resolve) => {
    const step = (left: number): void => {
      if (left <= 0) resolve()
      else requestAnimationFrame(() => step(left - 1))
    }
    step(count)
  })
}

export default function App() {
  const library = useLibrary()
  const { games, running, loading, scanning, settings, lastScan } = library

  const [filter, setFilter] = useState<Filter>('home')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortKey>('name')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(readSidebarCollapsed)
  const [splash, setSplash] = useState(true)
  const endSplash = useCallback(() => setSplash(false), [])

  // Big picture: fullscreen, controller-first. Its B handling lives inside it.
  const [bigPicture, setBigPicture] = useState(false)
  const bigPictureBack = useRef<(() => boolean) | null>(null)
  const bigPictureNow = useRef(bigPicture)
  bigPictureNow.current = bigPicture
  /*
   * Going in or out resizes the window in one jump, so it happens behind a
   * curtain (.vitra-curtain): fade it up, resize, swap the view once the new
   * size has landed, then lift it while the new view settles. A toggle that
   * arrives mid-way takes over; the one it interrupted stops where it is.
   */
  const [curtain, setCurtain] = useState<'off' | 'in' | 'out'>('off')
  const transition = useRef(0)
  const toggleBigPicture = useCallback((on?: boolean) => {
    const next = on ?? !bigPictureNow.current
    if (next === bigPictureNow.current) return
    bigPictureNow.current = next
    const run = ++transition.current
    const current = (): boolean => run === transition.current
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches

    void (async () => {
      setCurtain('in')
      await wait(reduced ? 80 : 450)
      if (!current()) return
      // Resolves once Windows says the switch is done. Guarded: a renderer
      // can hot-reload ahead of the preload that adds it.
      await window.launcher.setFullScreen?.(next)
      await frames(2)
      if (!current()) return
      setBigPicture(next)
      // Let the new view lay out and paint at the new size under the curtain,
      // and hold a beat so the change reads as a breath, not a blink.
      await frames(2)
      if (!reduced) await wait(150)
      if (!current()) return
      setCurtain('out')
      // The curtain's fade (800ms) and the view's settle (1000ms): the class
      // driving the settle goes when this does, so wait out the longer one.
      await wait(reduced ? 160 : 1000)
      if (current()) setCurtain('off')
    })()
  }, [])

  // The tray menu's "Big picture".
  useEffect(() => window.launcher.onOpenBigPicture?.(() => toggleBigPicture(true)), [toggleBigPicture])

  /*
   * The screen saver, choreographed rather than cut to: going idle slides the
   * title bar up and the sidebar and friends away and fades the page (500ms),
   * then the saver fades up over it. Waking fades the saver out while the
   * chrome slides back. `saverShown` keeps it mounted through its fade-out.
   */
  const { idle, sleep } = useIdle(settings.screenSaverMinutes, splash || loading || settingsOpen)
  const [saverShown, setSaverShown] = useState(false)
  useEffect(() => {
    if (idle) {
      setSaverShown(true)
      return
    }
    const timer = setTimeout(() => setSaverShown(false), 500)
    return () => clearTimeout(timer)
  }, [idle])
  // Slow in both directions while the saver is involved; the collapse button
  // keeps its own quick slide.
  const slowChrome = idle || saverShown

  // "Start in big picture": main already opened the window fullscreen; enter
  // the mode once, as soon as the real settings have arrived.
  const startedIn = useRef(false)
  useEffect(() => {
    if (loading || startedIn.current) return
    startedIn.current = true
    if (settings.bigPictureOnStart) setBigPicture(true)
  }, [loading, settings.bigPictureOnStart])

  // Wait for real settings: the defaults have no palette, and clearing the one
  // restored from localStorage would flash magenta before it came back.
  // Bundled wallpapers have colours of their own, like a picked one.
  const wallpaper = activeWallpaper(settings)
  const palette = settings.matchBackgroundColours ? wallpaper.palette : undefined
  const paletteKey = palette ? JSON.stringify(palette) : ''
  useEffect(() => {
    if (!loading) applyPalette(paletteKey ? (JSON.parse(paletteKey) as Palette) : undefined)
  }, [loading, paletteKey])

  // Light wallpapers get the light UI (on Auto); same wait for real settings.
  const appearance = appearanceFor(settings, wallpaper)
  useEffect(() => {
    if (!loading) applyAppearance(appearance)
  }, [loading, appearance])

  const selected = useMemo(
    () => games.find((game) => game.id === selectedId) ?? null,
    [games, selectedId]
  )

  const allTags = useMemo(
    () => [...new Set(games.flatMap((game) => game.tags))].sort((a, b) => a.localeCompare(b)),
    [games]
  )

  const shown = useMemo(() => {
    const filtered = games.filter(
      (game) =>
        inScope(game, filter, settings.programsView) &&
        (matchesQuery(game.name, query) || game.tags.some((tag) => matchesQuery(tag, query)))
    )

    const sorted = [...filtered]
    sorted.sort((a, b) => {
      if (sort === 'lastPlayed') return (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0)
      if (sort === 'playtime') return b.playtimeSeconds - a.playtimeSeconds
      if (sort === 'added') return b.addedAt - a.addedAt
      // Installed first, so an owned-but-absent game never outranks something
      // you can actually press play on.
      if (a.installed !== b.installed) return a.installed ? -1 : 1
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
    })
    return sorted
  }, [games, filter, query, sort, settings.programsView])

  // The Programs tab only exists in tab mode; don't strand the view on it.
  useEffect(() => {
    if (filter === 'programs' && settings.programsView !== 'tab') setFilter('all')
  }, [filter, settings.programsView])

  const changeFilter = useCallback((next: Filter) => {
    setFilter(next)
    setSelectedId(null)
    if (next === 'recent') setSort('lastPlayed')
    else if (next === 'unplayed') setSort('name')
  }, [])

  // Home has no grid to filter, so typing a search moves you to the library.
  const changeQuery = useCallback((value: string) => {
    setQuery(value)
    if (value) setFilter((current) => (current === 'home' ? 'all' : current))
  }, [])

  const play = useCallback(
    async (game: Game) => {
      const result = await library.launch(game.id)
      if (!result.ok) setToast(result.error ?? `Could not start ${game.name}.`)
    },
    [library]
  )

  const scan = useCallback(async () => {
    try {
      const result = await library.scan()
      if (result.errors.length) setToast(result.errors[0])
    } catch (err) {
      setToast((err as Error).message)
    }
  }, [library])

  const addManual = useCallback(async () => {
    const game = await library.addManual()
    if (game) {
      setFilter('all')
      setSelectedId(game.id)
    }
  }, [library])

  const toggleSidebar = useCallback(() => setSidebarCollapsed((current) => !current), [])
  useEffect(() => writeSidebarCollapsed(sidebarCollapsed), [sidebarCollapsed])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'F11') {
        event.preventDefault()
        toggleBigPicture()
        return
      }
      // Big picture handles its own Escape.
      if (bigPicture) return
      if (event.key === 'Escape' && !settingsOpen && selectedId) setSelectedId(null)
      if (event.ctrlKey && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'b') {
        event.preventDefault()
        toggleSidebar()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedId, settingsOpen, toggleSidebar, toggleBigPicture, bigPicture])

  // One click sound for every button, delegated so no component has to opt
  // in. Controller presses go through el.click(), so they're covered too.
  useEffect(() => {
    const onClick = (event: MouseEvent): void => {
      const target = (event.target as Element | null)?.closest('button, a[href], select')
      if (target && !target.matches(':disabled')) playSound('ui-click')
    }
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [])

  // Controller: B peels back one layer at a time — settings, then a game's
  // page, then back to Home. Start toggles settings; View toggles big picture.
  useGamepad({
    onBack: () => {
      if (settingsOpen) setSettingsOpen(false)
      else if (bigPicture) bigPictureBack.current?.()
      else if (selectedId) setSelectedId(null)
      else if (filter !== 'home') changeFilter('home')
    },
    onStart: () => setSettingsOpen((open) => !open),
    onView: () => {
      if (!settingsOpen) toggleBigPicture()
    }
  })

  const hasAnyGames = games.length > 0

  return (
    <>
      {/* Sibling, not child: both layers are positioned with an explicit
          z-index, so the backdrop can't end up painting over the app. */}
      {/* Big picture brings its own; two would blur the wallpaper twice. */}
      {!bigPicture && (
        <Backdrop dim={settings.backgroundDim} appearance={appearance} {...wallpaper} />
      )}

      <div
        className={`relative z-10 flex h-full flex-col ${curtain === 'out' ? 'vitra-view-enter' : ''}`}
        data-to={bigPicture ? 'big-picture' : 'desktop'}
      >
        {/* Inside this layer, before Settings: Settings must stack above it,
            and the controller treats the last open modal as the one in front.
            The desktop UI isn't rendered underneath, so nothing runs twice
            (Home's visualiser would open a second audio capture). */}
        {bigPicture ? (
          <BigPicture
            games={games}
            running={running}
            programsView={settings.programsView}
            backgroundDim={settings.backgroundDim}
            wallpaper={wallpaper}
            appearance={appearance}
            suspended={settingsOpen}
            onPlay={(game) => void play(game)}
            onToggleFavorite={(game) => void library.patch(game.id, { favorite: !game.favorite })}
            onOpenSettings={() => setSettingsOpen(true)}
            onExit={() => toggleBigPicture(false)}
            backRef={bigPictureBack}
          />
        ) : (
        <>
        {/* Slides up out of the way for the screen saver. */}
        <div
          aria-hidden={idle || undefined}
          inert={idle || undefined}
          className={`shrink-0 overflow-hidden transition-[height,opacity] ${
            slowChrome ? 'duration-500 ease-in-out' : 'duration-200'
          } ${idle ? 'h-0 opacity-0' : 'h-[52px] opacity-100'}`}
        >
          <TitleBar
            query={query}
            onQueryChange={changeQuery}
            onScan={scan}
            onAdd={addManual}
            onOpenSettings={() => setSettingsOpen(true)}
            onToggleFriends={() =>
              void library.updateSettings({ showFriends: !settings.showFriends })
            }
            onBigPicture={() => toggleBigPicture(true)}
            friendsOpen={settings.showFriends}
            scanning={scanning}
          />
        </div>

        <div className="flex min-h-0 flex-1">
          <Sidebar
            games={games}
            value={filter}
            onChange={changeFilter}
            collapsed={sidebarCollapsed}
            onToggleCollapsed={toggleSidebar}
            programsView={settings.programsView}
            concealed={idle}
            slow={slowChrome}
          />

        <main
          className={`flex min-h-0 flex-1 flex-col transition-opacity duration-500 ${
            idle ? 'opacity-0' : 'opacity-100'
          }`}
        >
          {selected ? (
            <GameDetail
              game={selected}
              session={running.find((state) => state.gameId === selected.id)}
              allTags={allTags}
              onBack={() => setSelectedId(null)}
              backLabel={titleFor(filter)}
              onPlay={() => void play(selected)}
              onStopTracking={() => void library.stopTracking(selected.id)}
              onPatch={(changes) => void library.patch(selected.id, changes)}
              onRemove={() => {
                void library.remove(selected.id)
                setSelectedId(null)
              }}
              onOpenFolder={() => void library.openFolder(selected.id)}
              onPickArt={(kind: ArtKind) => void library.pickArt(selected.id, kind)}
              onClearArt={(kind: ArtKind) => void library.clearArt(selected.id, kind)}
            />
          ) : filter === 'home' ? (
            <Home
              games={games}
              running={running}
              onOpen={(game) => setSelectedId(game.id)}
              onPlay={(game) => void play(game)}
              onBrowse={() => changeFilter('all')}
              onOpenSettings={() => setSettingsOpen(true)}
            />
          ) : (
            <>
              <div className="flex h-[72px] shrink-0 items-end gap-3 px-8 pb-4">
                <h1 className="truncate font-display text-[30px] leading-none font-bold tracking-[-0.02em] text-ink [font-stretch:85%]">
                  {titleFor(filter)}
                </h1>
                <span className="shrink-0 font-display text-[15px] leading-none font-medium tabular-nums text-muted">
                  {shown.length}
                </span>

                <div className="ml-auto flex shrink-0 items-center gap-2.5 text-[11px] text-muted">
                  <span aria-hidden>Sort</span>
                  <Dropdown
                    label="Sort by"
                    value={sort}
                    onChange={setSort}
                    options={(Object.keys(SORT_LABELS) as SortKey[]).map((key) => ({
                      value: key,
                      label: SORT_LABELS[key]
                    }))}
                  />
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto">
                {loading ? (
                  <div className="flex h-full items-center justify-center gap-2.5 text-[13px] text-muted">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading library…
                  </div>
                ) : shown.length ? (
                  <GameGrid
                    games={shown}
                    running={running}
                    onOpen={(game) => setSelectedId(game.id)}
                    onPlay={(game) => void play(game)}
                    onToggleFavorite={(game) =>
                      void library.patch(game.id, { favorite: !game.favorite })
                    }
                  />
                ) : hasAnyGames ? (
                  <div className="grid-backdrop flex h-full flex-col items-center justify-center gap-4 px-8 text-center">
                    <SearchX className="h-7 w-7 text-muted" />
                    <p className="text-[13px] text-dim">Nothing here matches that.</p>
                    {query && (
                      <button
                        onClick={() => setQuery('')}
                        className="glass-btn h-9 rounded-[10px] px-4 text-[12px] text-dim transition-colors hover:text-ink"
                      >
                        Clear search
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="grid-backdrop flex h-full flex-col items-center justify-center px-8">
                    <div className="glass max-w-[460px] rounded-[16px] p-8 text-center">
                      <h2 className="font-display text-[22px] font-bold tracking-[-0.01em] text-ink [font-stretch:85%]">
                        Your library is empty
                      </h2>
                      <p className="mt-2.5 text-[12.5px] leading-relaxed text-muted">
                        Vitra reads your local Steam, Epic, GOG and Xbox files to build the library. Run a
                        scan, or point it at an executable for anything those stores don't know
                        about.
                      </p>
                      <div className="mt-6 flex items-center justify-center gap-2.5">
                        <button
                          onClick={scan}
                          disabled={scanning}
                          className="flex h-10 items-center gap-2 rounded-[11px] bg-accent px-5 text-[12px] font-semibold text-black shadow-[0_8px_24px_-8px_rgb(var(--accent-rgb)/0.9)] transition-colors hover:bg-accent-strong disabled:opacity-60"
                        >
                          {scanning ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <RefreshCw className="h-3.5 w-3.5" />
                          )}
                          Scan for games
                        </button>
                        <button
                          onClick={addManual}
                          className="glass-btn flex h-10 items-center gap-2 rounded-[11px] px-5 text-[12px] text-dim transition-colors hover:text-ink"
                        >
                          <Plus className="h-3.5 w-3.5" />
                          Add manually
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
          </main>

          {settings.showFriends && (
            // Slides away with the sidebar for the screen saver.
            <div
              aria-hidden={idle || undefined}
              inert={idle || undefined}
              // justify-end: the panel slides out to the right, not cropped.
              className={`flex shrink-0 justify-end overflow-hidden transition-[width,opacity] ${
                slowChrome ? 'duration-500 ease-in-out' : 'duration-200'
              } ${idle ? 'w-0 opacity-0' : 'w-[262px] opacity-100'}`}
            >
              <FriendsPanel
                onClose={() => void library.updateSettings({ showFriends: false })}
                onOpenSettings={() => setSettingsOpen(true)}
              />
            </div>
          )}
        </div>
        </>
        )}

        {settingsOpen && (
          <SettingsDialog
            settings={settings}
            lastScan={lastScan}
            scanning={scanning}
            onClose={() => setSettingsOpen(false)}
            onChange={(patch) => void library.updateSettings(patch)}
            onPickSteamPath={() => void library.pickSteamPath()}
            onPickBackground={() => void library.pickBackground()}
            onClearBackground={() => void library.clearBackground()}
            onOpenBigPicture={() => {
              setSettingsOpen(false)
              toggleBigPicture(true)
            }}
            onPreviewScreenSaver={() => {
              setSettingsOpen(false)
              sleep()
            }}
            onScan={scan}
          />
        )}

        {toast && <Toast message={toast} onDismiss={() => setToast(null)} />}

        {saverShown && <ScreenSaver leaving={!idle} />}
      </div>

      {curtain !== 'off' && <div aria-hidden className="vitra-curtain" data-phase={curtain} />}

      {splash && <Splash ready={!loading} onDone={endSplash} />}
    </>
  )
}
