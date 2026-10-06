import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MutableRefObject,
  type ReactNode
} from 'react'
import {
  ArrowLeft,
  Download,
  Info,
  LogOut,
  Menu as MenuIcon,
  Minimize2,
  Moon,
  Play,
  Power,
  RotateCcw,
  Settings as SettingsIcon,
  Star
} from 'lucide-react'
import {
  GAME_SOURCES,
  type Appearance,
  type Game,
  type GameSource,
  type ProgramsView,
  type RunningState
} from '@shared/types'
import logo from '../assets/vitra-logo.png'
import { useArt } from '../lib/art'
import {
  formatLastPlayed,
  formatPlaytime,
  hasSource,
  hueFor,
  inLibrary,
  isSoftware,
  sourceLabel
} from '../lib/format'
import { playSound } from '../lib/sound'
import Backdrop from './Backdrop'
import type { ActiveWallpaper } from '../lib/wallpapers'
import CoverImage from './CoverImage'
import CoverReflection from './CoverReflection'
import { Clock, Friends, lastPlayedPhrase, useMinute } from './Home'
import NowPlaying from './NowPlaying'
import StoreLogo, { type StoreLogoKind } from './StoreLogo'
import Lyrics from './Lyrics'
import Visualiser from './Visualiser'

// A plays, X details, Y favourite, LB/RB tabs, B back (never exits), View exits

interface Tab {
  id: string
  label: string
  games: Game[]
}

interface Props {
  games: Game[]
  running: RunningState[]
  programsView: ProgramsView
  backgroundDim: number
  backgroundParticles: boolean
  wallpaper: ActiveWallpaper
  // used on Home only; the library tabs sit over game art and stay dark
  appearance: Appearance
  // Settings is open above: leave Escape to it
  suspended: boolean
  onPlay: (game: Game) => void
  onToggleFavorite: (game: Game) => void
  onOpenSettings: () => void
  onExit: () => void
  // App's B calls this; true = handled here
  backRef: MutableRefObject<(() => boolean) | null>
}


function byName(a: Game, b: Game): number {
  if (a.installed !== b.installed) return a.installed ? -1 : 1
  return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
}

function canLaunch(game: Game): boolean {
  return game.installed || Boolean(game.steamAppId || game.epicLaunchUri || game.launchUri)
}

function usingPad(): boolean {
  return document.documentElement.dataset.input === 'gamepad'
}

function Glyph({ children, tone }: { children: ReactNode; tone?: string }) {
  return (
    <span
      className={`inline-flex h-[26px] min-w-[26px] items-center justify-center rounded-full border border-snow/25 bg-black/45 px-1.5 text-[11px] font-bold ${
        tone ?? 'text-snow'
      }`}
    >
      {children}
    </span>
  )
}

const TAB_FADE = 56

// LB/RB pinned outside the scroller so they never scroll away
function TabStrip({
  tabs,
  activeId,
  onSelect
}: {
  tabs: Tab[]
  activeId: string
  onSelect: (id: string) => void
}) {
  const strip = useRef<HTMLElement>(null)
  const [fade, setFade] = useState({ left: false, right: false })

  const measure = (): void => {
    const el = strip.current
    if (!el) return
    const left = el.scrollLeft > 1
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1
    setFade((was) => (was.left === left && was.right === right ? was : { left, right }))
  }

  useEffect(() => {
    const el = strip.current
    if (!el) return
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    // native: React's onWheel is passive and can't preventDefault
    const onWheel = (event: WheelEvent): void => {
      if (el.scrollWidth <= el.clientWidth || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return
      event.preventDefault()
      el.scrollLeft += event.deltaY
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      observer.disconnect()
      el.removeEventListener('wheel', onWheel)
    }
  }, [tabs.length])

  // scrollTo, not scrollIntoView, which would scroll ancestors too
  useEffect(() => {
    const el = strip.current
    const button = el?.querySelector<HTMLElement>(`[data-nav-view="${CSS.escape(activeId)}"]`)
    if (!el || !button) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    el.scrollTo({
      left: button.offsetLeft - el.clientWidth / 2 + button.offsetWidth / 2,
      behavior: reduced ? 'auto' : 'smooth'
    })
  }, [activeId])

  const edge = (on: boolean): string => (on ? `transparent 0, #000 ${TAB_FADE}px` : '#000 0')
  const mask = `linear-gradient(to right, ${edge(fade.left)}, ${
    fade.right ? `#000 calc(100% - ${TAB_FADE}px), transparent 100%` : '#000 100%'
  })`

  return (
    <div className="flex min-w-0 flex-1 items-center gap-3">
      <Glyph>LB</Glyph>
      {/* py-3: overflow-x clips y too, and the sun marker hangs below the tab */}
      <nav
        ref={strip}
        aria-label="Big picture sections"
        onScroll={measure}
        className="min-w-0 flex-1 overflow-x-auto py-3 [scrollbar-width:none]"
        style={{ maskImage: mask, WebkitMaskImage: mask }}
      >
        <div className="flex w-max items-center gap-1.5 px-2">
          {tabs.map((entry) => {
            const active = entry.id === activeId
            return (
              <button
                key={entry.id}
                onClick={() => onSelect(entry.id)}
                data-nav-view={entry.id}
                aria-current={active ? 'page' : undefined}
                className={`relative h-11 shrink-0 rounded-full px-4 text-[clamp(15px,1.25vw,19px)] transition-colors ${
                  active ? 'bg-white/10 text-ink' : 'text-dim hover:bg-white/6 hover:text-ink'
                }`}
              >
                {entry.label}
                {active && (
                  <span className="vitra-sun absolute -bottom-2 left-1/2 h-[6px] w-[6px] -translate-x-1/2" />
                )}
              </button>
            )
          })}
        </div>
      </nav>
      <Glyph>RB</Glyph>
    </div>
  )
}

function Hints({ items }: { items: Array<[ReactNode, string]> }) {
  return (
    <div className="flex items-center gap-6">
      {items.map(([glyph, label]) => (
        <span key={label} className="flex items-center gap-2 text-[13px] text-dim">
          {glyph}
          {label}
        </span>
      ))}
    </div>
  )
}

const A = <Glyph tone="text-[#7ddc7d]">A</Glyph>
const B = <Glyph tone="text-[#f07a7a]">B</Glyph>
const X = <Glyph tone="text-[#7ab8f5]">X</Glyph>
const Y = <Glyph tone="text-[#f5d36b]">Y</Glyph>
const BUMPERS = (
  <span className="flex gap-1">
    <Glyph>LB</Glyph>
    <Glyph>RB</Glyph>
  </span>
)
const VIEW = <Glyph>View</Glyph>
const TRIGGERS = (
  <span className="flex gap-1">
    <Glyph>LT</Glyph>
    <Glyph>RT</Glyph>
  </span>
)

// Library's store filter. stepped by LT/RT (data-nav-subview), so it's never a d-pad stop
function StoreRow({
  stores,
  active,
  onSelect
}: {
  stores: GameSource[]
  active: GameSource | 'all'
  onSelect: (store: GameSource | 'all') => void
}) {
  const entries: Array<GameSource | 'all'> = ['all', ...stores]
  return (
    <div className="relative flex shrink-0 items-center gap-3 px-14 pb-2">
      <Glyph>LT</Glyph>
      <div className="flex flex-wrap items-center gap-1.5">
        {entries.map((store) => {
          const current = store === active
          const label = store === 'all' ? 'All' : store === 'manual' ? 'Local' : sourceLabel(store)
          const logo = store === 'all' ? undefined : (store as StoreLogoKind)
          return (
            <button
              key={store}
              onClick={() => onSelect(store)}
              data-nav-subview={store}
              data-nav-skip
              tabIndex={-1}
              aria-current={current ? 'page' : undefined}
              aria-label={label}
              title={label}
              className={`flex h-9 items-center justify-center rounded-full px-3.5 text-[14px] transition-colors ${
                current ? 'bg-white/12 text-ink' : 'text-muted hover:bg-white/6 hover:text-ink'
              }`}
            >
              {logo ? <StoreLogo kind={logo} className="h-[18px] w-[18px]" /> : label}
            </button>
          )
        })}
      </div>
      <Glyph>RT</Glyph>
    </div>
  )
}

// layers are tagged by game so one without a hero fades to the wallpaper instead
// of keeping the previous game's art
function HeroBackdrop({ gameId }: { gameId: string }) {
  const url = useArt(gameId, 'hero')
  const [layers, setLayers] = useState<Array<{ id: string; src: string }>>([])

  useEffect(() => {
    if (!url) return
    setLayers((prev) =>
      prev.some((layer) => layer.src === url) ? prev : [...prev.slice(-1), { id: gameId, src: url }]
    )
  }, [url, gameId])

  return (
    <>
      {layers.map((layer) => (
        <img
          key={layer.src}
          src={layer.src}
          alt=""
          draggable={false}
          className="vitra-bp-hero"
          style={{ opacity: layer.id === gameId && layer.src === url ? 1 : 0 }}
        />
      ))}
    </>
  )
}

function Veils() {
  return (
    <>
      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgb(11_7_17/0.9)_0%,rgb(11_7_17/0.55)_42%,rgb(11_7_17/0.12)_100%)]" />
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgb(11_7_17/0.75)_0%,transparent_20%,transparent_42%,rgb(11_7_17/0.92)_100%)]" />
    </>
  )
}

function ShelfItem({
  game,
  active,
  running,
  isDefault,
  onSelect,
  onPlay,
  onDetails,
  onFavorite
}: {
  game: Game
  active: boolean
  running: boolean
  isDefault: boolean
  onSelect: () => void
  onPlay: () => void
  onDetails: () => void
  onFavorite: () => void
}) {
  return (
    <div
      data-nav-group
      data-game-id={game.id}
      data-active={active || undefined}
      className="vitra-bp-item relative"
    >
      <button
        data-nav-primary
        data-nav-default={isDefault || undefined}
        aria-label={`${game.name}${game.installed ? '' : ', not installed'}${running ? ', playing' : ''}`}
        onFocus={onSelect}
        // detail 0 = pad A / Enter: play. a mouse click only selects
        onClick={(event) => (event.detail === 0 ? onPlay() : onSelect())}
        onDoubleClick={onPlay}
        className="vitra-bp-cover relative overflow-hidden rounded-[12px] bg-raised"
      >
        <div className={`h-full w-full ${game.installed ? '' : 'opacity-45 saturate-[0.3]'}`}>
          <CoverImage game={game} />
        </div>
        {running && (
          <span className="absolute top-3 left-3 flex items-center gap-1.5 rounded-full bg-black/60 py-1 pr-3 pl-2 text-[12px] font-medium text-snow backdrop-blur-md">
            <span className="vitra-sun h-2.5 w-2.5 animate-pulse-dot" />
            Playing
          </span>
        )}
        {game.favorite && (
          <Star className="absolute top-3 right-3 h-5 w-5 fill-current text-ember drop-shadow-[0_1px_4px_rgba(0,0,0,0.9)]" />
        )}
      </button>
      <CoverReflection game={game} className="mt-[6px]" />
      {/* pad X / Y only */}
      <button data-nav-skip data-nav-x tabIndex={-1} onClick={onDetails} className="sr-only">
        Details
      </button>
      <button data-nav-skip data-nav-y tabIndex={-1} onClick={onFavorite} className="sr-only">
        {game.favorite ? 'Remove from favourites' : 'Add to favourites'}
      </button>
    </div>
  )
}

function Shelf({
  games,
  activeId,
  runningIds,
  onSelect,
  onPlay,
  onDetails,
  onFavorite
}: {
  games: Game[]
  activeId?: string
  runningIds: Set<string>
  onSelect: (game: Game) => void
  onPlay: (game: Game) => void
  onDetails: (game: Game) => void
  onFavorite: (game: Game) => void
}) {
  const scroller = useRef<HTMLDivElement>(null)

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    const covers = [...(scroller.current?.querySelectorAll<HTMLElement>('[data-nav-primary]') ?? [])]
    const at = covers.indexOf(document.activeElement as HTMLElement)
    const next = covers[at + (event.key === 'ArrowRight' ? 1 : -1)]
    if (!next) return
    event.preventDefault()
    next.focus()
    next.closest('[data-nav-group]')?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' })
  }

  return (
    <div className="vitra-bp-shelf relative">
      <div className="vitra-horizon vitra-bp-horizon absolute inset-x-0" />
      <div
        ref={scroller}
        data-nav-center
        onKeyDown={onKeyDown}
        onWheel={(event) => {
          if (scroller.current && Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
            scroller.current.scrollLeft += event.deltaY
          }
        }}
        className="vitra-bp-row flex items-end overflow-x-auto px-14"
      >
        {games.map((game, index) => (
          <ShelfItem
            key={game.id}
            game={game}
            active={game.id === activeId}
            running={runningIds.has(game.id)}
            isDefault={index === 0}
            onSelect={() => onSelect(game)}
            onPlay={() => onPlay(game)}
            onDetails={() => onDetails(game)}
            onFavorite={() => onFavorite(game)}
          />
        ))}
        {/* Room to centre the last cover. */}
        <div aria-hidden className="h-px w-[40vw] shrink-0" />
      </div>
    </div>
  )
}

function GameInfo({
  game,
  running,
  onPlay,
  onDetails
}: {
  game: Game
  running: boolean
  onPlay: () => void
  onDetails: () => void
}) {
  return (
    <div key={game.id} className="animate-fade-up max-w-[60vw] px-14">
      <div className="mb-3 flex items-center gap-2.5 text-[14px] text-dim">
        <span>{sourceLabel(game.source)}</span>
        {!game.installed && (
          <>
            <span className="text-muted">·</span>
            <span>Not installed</span>
          </>
        )}
        {running && (
          <>
            <span className="text-muted">·</span>
            <span className="flex items-center gap-1.5 text-ink">
              <span className="vitra-sun h-2.5 w-2.5 animate-pulse-dot" />
              Playing now
            </span>
          </>
        )}
      </div>
      <h1 className="line-clamp-2 font-display text-[clamp(40px,5vw,84px)] leading-[0.95] font-extrabold tracking-[-0.025em] text-ink [font-stretch:78%]">
        {game.name}
      </h1>
      <div className="mt-3 text-[clamp(14px,1.1vw,18px)] text-dim">
        {game.playtimeSeconds > 0 ? `${formatPlaytime(game.playtimeSeconds)} played` : 'Never played'}
        {game.lastPlayed ? ` · ${lastPlayedPhrase(game.lastPlayed)}` : ''}
      </div>
      {/* mouse only; the pad uses A / X on the cover */}
      <div className="mt-6 flex items-center gap-3">
        <button
          data-nav-skip
          onClick={onPlay}
          disabled={running || !canLaunch(game)}
          className="flex h-12 items-center gap-2.5 rounded-[12px] bg-accent px-7 font-display text-[17px] font-bold text-black [font-stretch:88%] shadow-[0_8px_26px_-8px_rgb(var(--accent-rgb)/0.9)] transition-colors hover:bg-accent-strong disabled:bg-white/8 disabled:text-muted disabled:shadow-none"
        >
          {game.installed ? <Play className="h-4 w-4 fill-current" /> : <Download className="h-4 w-4" />}
          {running ? 'Playing' : game.installed ? 'Play' : 'Install'}
        </button>
        <button
          data-nav-skip
          onClick={onDetails}
          className="glass-btn flex h-12 items-center gap-2 rounded-[12px] px-5 text-[14px] text-dim transition-colors hover:text-ink"
        >
          <Info className="h-4 w-4" />
          Details
        </button>
      </div>
    </div>
  )
}

function ContinueTile({
  game,
  running,
  onPlay,
  onDetails
}: {
  game: Game
  running: boolean
  onPlay: () => void
  onDetails: () => void
}) {
  const hero = useArt(game.id, 'hero')
  const hue = hueFor(game.name)
  const action = running ? 'Open' : game.installed ? 'Play' : 'Install'

  return (
    <div data-nav-group data-game-id={game.id} className="relative min-w-0">
      <button
        data-nav-primary
        data-nav-default
        onClick={running ? onDetails : onPlay}
        aria-label={`${action} ${game.name}`}
        className="group flex max-w-[46vw] items-center gap-5 rounded-[16px] p-2.5 pr-4 text-left transition-colors hover:bg-white/6 focus-visible:bg-white/8 focus-visible:outline-none"
      >
        <div
          className={`aspect-video h-[clamp(64px,8.5vh,100px)] shrink-0 overflow-hidden rounded-[10px] bg-raised opacity-80 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 ${
            game.installed ? '' : 'saturate-[0.3]'
          }`}
        >
          {hero ? (
            <img src={hero} alt="" draggable={false} className="h-full w-full object-cover" />
          ) : (
            <div
              className="h-full w-full"
              style={{
                background: `radial-gradient(120% 120% at 80% 100%, hsl(${hue} 48% 30%) 0%, hsl(${(hue + 30) % 360} 40% 14%) 55%, #0c0713 100%)`
              }}
            />
          )}
        </div>
        <div className="min-w-0">
          <div className="text-[14px] text-muted">{running ? 'Playing now' : 'Continue'}</div>
          <div className="truncate font-display text-[clamp(20px,1.8vw,30px)] leading-tight font-bold text-dim transition-colors group-hover:text-ink group-focus-visible:text-ink [font-stretch:85%]">
            {game.name}
          </div>
          {!running && (
            <div className="truncate text-[13px] text-muted">{lastPlayedPhrase(game.lastPlayed)}</div>
          )}
        </div>
        <span className="ml-3 flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-dim transition-colors group-hover:bg-accent group-hover:text-black group-focus-visible:bg-accent group-focus-visible:text-black">
          {running ? (
            <span className="vitra-sun h-3 w-3 animate-pulse-dot" />
          ) : game.installed ? (
            <Play className="h-5 w-5 translate-x-px fill-current" />
          ) : (
            <Download className="h-5 w-5" />
          )}
        </span>
      </button>
      <button data-nav-skip data-nav-x tabIndex={-1} onClick={onDetails} className="sr-only">
        Details
      </button>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[13px] text-muted">{label}</div>
      <div className="mt-1 font-display text-[clamp(20px,1.8vw,30px)] font-bold text-ink [font-stretch:85%]">
        {value}
      </div>
    </div>
  )
}

// seconds; sleep and quit don't count down
const POWER_COUNTDOWN = 5

const POWER_WORDS: Record<'restart' | 'shutdown', { doing: string; now: string }> = {
  restart: { doing: 'Restarting', now: 'Restart now' },
  shutdown: { doing: 'Shutting down', now: 'Shut down now' }
}

function PowerRow({
  icon: Icon,
  label,
  onClick,
  first = false
}: {
  icon: typeof Power
  label: string
  onClick: () => void
  first?: boolean
}) {
  return (
    <button
      onClick={onClick}
      data-nav-default={first || undefined}
      className="flex h-16 w-full items-center gap-4 rounded-[14px] px-5 text-left text-[19px] text-dim transition-colors hover:bg-white/8 hover:text-ink focus-visible:bg-white/8 focus-visible:text-ink"
    >
      <Icon className="h-6 w-6 shrink-0" />
      {label}
    </button>
  )
}

// restart/shutdown count down so one stray A can't power the PC off
function PowerMenu({
  pending,
  onPending,
  onClose,
  onExit,
  onOpenSettings
}: {
  pending: 'restart' | 'shutdown' | null
  onPending: (action: 'restart' | 'shutdown' | null) => void
  onClose: () => void
  onExit: () => void
  onOpenSettings: () => void
}) {
  const root = useRef<HTMLDivElement>(null)
  const [left, setLeft] = useState(POWER_COUNTDOWN)
  const [sent, setSent] = useState(false)

  // focus Cancel on a countdown so a second A doesn't confirm
  useEffect(() => {
    root.current
      ?.querySelector<HTMLElement>('[data-nav-default]')
      ?.focus({ preventScroll: true, focusVisible: usingPad() } as FocusOptions)
  }, [pending])

  useEffect(() => {
    if (!pending) return
    setLeft(POWER_COUNTDOWN)
    setSent(false)
    const timer = setInterval(() => setLeft((value) => value - 1), 1000)
    return () => clearInterval(timer)
  }, [pending])

  useEffect(() => {
    if (!pending || left > 0 || sent) return
    setSent(true)
    void window.launcher.power?.(pending)
  }, [pending, left, sent])

  const act = (action: 'sleep' | 'quit'): void => {
    onClose()
    void window.launcher.power?.(action)
  }

  return (
    <div
      ref={root}
      role="dialog"
      aria-modal="true"
      aria-label="Power"
      data-appearance="dark"
      className="animate-fade-up absolute inset-0 z-40 flex items-center justify-center bg-black/60 backdrop-blur-md"
      onClick={(event) => {
        if (event.target === event.currentTarget && !pending) onClose()
      }}
    >
      {pending ? (
        <div className="flex flex-col items-center text-center">
          <div className="text-[18px] text-dim">
            {sent ? `${POWER_WORDS[pending].doing}…` : POWER_WORDS[pending].doing}
          </div>
          <div className="mt-2 font-display text-[clamp(96px,12vw,180px)] leading-none font-extrabold tabular-nums text-ink [font-stretch:78%]">
            {sent ? '' : Math.max(left, 0)}
          </div>
          {!sent && (
            <div className="mt-10 flex items-center gap-3">
              <button
                onClick={() => onPending(null)}
                data-nav-default
                className="glass-btn flex h-14 items-center rounded-[14px] px-9 text-[17px] text-ink"
              >
                Cancel
              </button>
              <button
                onClick={() => setLeft(0)}
                className="flex h-14 items-center rounded-[14px] px-7 text-[17px] text-dim transition-colors hover:bg-white/8 hover:text-ink"
              >
                {POWER_WORDS[pending].now}
              </button>
            </div>
          )}
          <div className="mt-12">
            <Hints items={[[<Glyph key="b">B</Glyph>, 'Cancel']]} />
          </div>
        </div>
      ) : (
        <div className="glass-strong w-[min(460px,90vw)] rounded-[22px] p-3">
          <div className="px-5 pt-3 pb-2 font-display text-[22px] font-bold text-ink [font-stretch:85%]">
            Menu
          </div>
          <PowerRow
            icon={SettingsIcon}
            label="Settings"
            first
            onClick={() => {
              onClose()
              onOpenSettings()
            }}
          />
          <div className="mx-5 my-2 h-px bg-white/10" />
          <PowerRow icon={Moon} label="Sleep" onClick={() => act('sleep')} />
          <PowerRow icon={RotateCcw} label="Restart" onClick={() => onPending('restart')} />
          <PowerRow icon={Power} label="Shut down" onClick={() => onPending('shutdown')} />
          <div className="mx-5 my-2 h-px bg-white/10" />
          <PowerRow
            icon={Minimize2}
            label="Exit big picture"
            onClick={() => {
              onClose()
              onExit()
            }}
          />
          <PowerRow icon={LogOut} label="Quit Vitra" onClick={() => act('quit')} />
          <div className="flex justify-end px-5 pt-3 pb-2">
            <Hints
              items={[
                [<Glyph key="a">A</Glyph>, 'Select'],
                [<Glyph key="b">B</Glyph>, 'Back']
              ]}
            />
          </div>
        </div>
      )}
    </div>
  )
}

function Detail({
  game,
  running,
  onPlay,
  onToggleFavorite,
  onClose
}: {
  game: Game
  running: boolean
  onPlay: () => void
  onToggleFavorite: () => void
  onClose: () => void
}) {
  const play = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    play.current?.focus({ preventScroll: true, focusVisible: usingPad() } as FocusOptions)
  }, [])

  const action = running ? 'Playing' : game.installed ? 'Play' : 'Install'

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={game.name}
      data-appearance="dark"
      className="animate-fade-up absolute inset-0 z-30 flex flex-col bg-base"
    >
      <div className="absolute inset-0 overflow-hidden">
        <HeroBackdrop gameId={game.id} />
        <Veils />
      </div>

      <div className="relative flex min-h-0 flex-1 items-end gap-[clamp(28px,4vw,72px)] px-14 pb-[10vh]">
        <div className="w-[clamp(200px,19vw,330px)] shrink-0">
          <div className="aspect-[2/3] overflow-hidden rounded-[14px] bg-raised shadow-[0_30px_80px_-20px_rgba(0,0,0,0.9)]">
            <CoverImage game={game} captionless />
          </div>
          <CoverReflection game={game} className="mt-[6px]" />
        </div>

        {/* pb = reflection height (0.3 x cover width + gap): text foot meets cover foot */}
        <div className="min-w-0 flex-1 pb-[calc(clamp(200px,19vw,330px)*0.3_+_6px)]">
          <div className="mb-3 text-[15px] text-dim">
            {sourceLabel(game.source)}
            {!game.installed && ' · Not installed'}
          </div>
          <h1 className="line-clamp-2 font-display text-[clamp(44px,5.6vw,96px)] leading-[0.95] font-extrabold tracking-[-0.025em] text-ink [font-stretch:78%]">
            {game.name}
          </h1>

          <div className="mt-8 flex flex-wrap gap-x-14 gap-y-5">
            <Stat label="Played" value={game.playtimeSeconds ? formatPlaytime(game.playtimeSeconds) : 'Never'} />
            <Stat label="Sessions" value={String(game.sessions)} />
            <Stat label="Last played" value={formatLastPlayed(game.lastPlayed)} />
          </div>

          <div className="mt-10 flex items-center gap-3">
            <button
              ref={play}
              onClick={onPlay}
              disabled={running || !canLaunch(game)}
              data-nav-default
              className="flex h-14 items-center gap-3 rounded-[14px] bg-accent px-9 font-display text-[20px] font-bold text-black [font-stretch:88%] shadow-[0_10px_30px_-8px_rgb(var(--accent-rgb)/0.9)] transition-colors hover:bg-accent-strong focus-visible:outline-offset-4 disabled:bg-white/8 disabled:text-muted disabled:shadow-none"
            >
              {game.installed ? <Play className="h-5 w-5 fill-current" /> : <Download className="h-5 w-5" />}
              {action}
            </button>
            <button
              onClick={onToggleFavorite}
              aria-pressed={game.favorite}
              className="glass-btn flex h-14 items-center gap-2.5 rounded-[14px] px-6 text-[15px] text-dim transition-colors hover:text-ink"
            >
              <Star className={`h-5 w-5 ${game.favorite ? 'fill-current text-ember' : ''}`} />
              {game.favorite ? 'Favourite' : 'Add to favourites'}
            </button>
            <button
              onClick={onClose}
              className="glass-btn flex h-14 items-center gap-2.5 rounded-[14px] px-6 text-[15px] text-dim transition-colors hover:text-ink"
            >
              <ArrowLeft className="h-5 w-5" />
              Back
            </button>
          </div>
        </div>
      </div>

      <footer className="relative flex h-16 shrink-0 items-center justify-end px-14">
        <Hints items={[[A, 'Select'], [B, 'Back']]} />
      </footer>
    </div>
  )
}

function SmallClock() {
  const now = useMinute()
  return (
    <span className="font-display text-[22px] font-light text-ink tabular-nums [font-stretch:80%]">
      {now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
    </span>
  )
}

export default function BigPicture({
  games,
  running,
  programsView,
  backgroundDim,
  backgroundParticles,
  wallpaper,
  appearance,
  suspended,
  onPlay,
  onToggleFavorite,
  onOpenSettings,
  onExit,
  backRef
}: Props) {
  const root = useRef<HTMLDivElement>(null)
  const [tabId, setTabId] = useState('home')
  const [storeFilter, setStoreFilter] = useState<GameSource | 'all'>('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [powerOpen, setPowerOpen] = useState(false)
  const [powerPending, setPowerPending] = useState<'restart' | 'shutdown' | null>(null)

  const runningIds = useMemo(() => new Set(running.map((state) => state.gameId)), [running])

  const tabs = useMemo(() => {
    const library = games.filter((game) => inLibrary(game, programsView))
    const list: Tab[] = [{ id: 'home', label: 'Home', games: [] }]
    const recent = library
      .filter((game) => game.lastPlayed)
      .sort((a, b) => (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0))
    if (recent.length) list.push({ id: 'recent', label: 'Recent', games: recent })
    const favourites = library.filter((game) => game.favorite).sort(byName)
    if (favourites.length) list.push({ id: 'favorites', label: 'Favourites', games: favourites })
    // stores are a second row inside Library (LT/RT), not tabs of their own
    const inStore = storeFilter === 'all' ? library : library.filter((game) => hasSource(game, storeFilter))
    list.push({ id: 'library', label: 'Library', games: [...inStore].sort(byName) })
    if (programsView === 'tab') {
      const programs = games.filter((game) => !game.hidden && isSoftware(game)).sort(byName)
      list.push({ id: 'programs', label: 'Programs', games: programs })
    }
    return list
  }, [games, programsView, storeFilter])

  const stores = useMemo(() => {
    const library = games.filter((game) => inLibrary(game, programsView))
    return GAME_SOURCES.filter((source) => library.some((game) => hasSource(game, source)))
  }, [games, programsView])

  // a store that emptied out (or a stale pick) falls back to All
  useEffect(() => {
    if (storeFilter !== 'all' && !stores.includes(storeFilter)) setStoreFilter('all')
  }, [stores, storeFilter])

  const featured = useMemo(() => {
    const rank = (game: Game): number => (runningIds.has(game.id) ? Infinity : (game.lastPlayed ?? 0))
    let best: Game | undefined
    for (const game of games) {
      if (game.hidden || isSoftware(game) || rank(game) === 0) continue
      if (!best || rank(game) > rank(best)) best = game
    }
    return best
  }, [games, runningIds])

  const tab = tabs.find((entry) => entry.id === tabId) ?? tabs[0]
  const shelf = tab.id === 'home' ? [] : tab.games
  const selected = shelf.find((game) => game.id === selectedId) ?? shelf[0]
  const detail = detailId ? games.find((game) => game.id === detailId) : undefined

  const selectTab = (id: string): void => {
    setTabId(id)
    setSelectedId(null)
  }

  const selectStore = (store: GameSource | 'all'): void => {
    setStoreFilter(store)
    setSelectedId(null)
  }

  // pad only: the mouse keeps its focus where it is
  useEffect(() => {
    if (!usingPad()) return
    const frame = requestAnimationFrame(() => {
      root.current
        ?.querySelector<HTMLElement>('[data-nav-default]')
        ?.focus({ preventScroll: true, focusVisible: true } as FocusOptions)
    })
    return () => cancelAnimationFrame(frame)
  }, [tab.id, storeFilter])

  const select = (game: Game): void => {
    if (game.id === selected?.id) return
    setSelectedId(game.id)
    playSound('card-hover', 0.22)
  }

  // B never leaves big picture: only View, F11 or Exit do
  const back = (): boolean => {
    // countdown -> menu -> closed
    if (powerPending) {
      setPowerPending(null)
      return true
    }
    if (powerOpen) {
      setPowerOpen(false)
      return true
    }
    if (detailId) {
      setDetailId(null)
      return true
    }
    if (tab.id !== 'home') {
      selectTab('home')
      return true
    }
    return false
  }
  backRef.current = back

  useEffect(() => {
    return () => {
      backRef.current = null
    }
  }, [backRef])

  useEffect(() => {
    if (suspended) return
    const onKey = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape' && backRef.current?.()) event.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [suspended, backRef])

  const onHome = tab.id === 'home'

  return (
    <div
      ref={root}
      role="dialog"
      aria-modal="true"
      aria-label="Big picture"
      data-appearance={onHome ? appearance : 'dark'}
      className="vitra-bp fixed inset-0 z-[45] flex flex-col overflow-hidden bg-base"
    >
      <Backdrop
        dim={backgroundDim}
        appearance={onHome ? appearance : 'dark'}
        particles={backgroundParticles}
        {...wallpaper}
      />
      {!onHome && selected && (
        <div className="absolute inset-0 overflow-hidden">
          <HeroBackdrop gameId={selected.id} />
          <Veils />
        </div>
      )}

      <header className="relative flex h-[clamp(68px,10vh,104px)] shrink-0 items-center gap-8 px-14">
        <img
          src={logo}
          alt="Vitra"
          draggable={false}
          className="h-9 w-9 drop-shadow-[0_0_10px_rgb(var(--accent-rgb)/0.6)]"
        />

        <TabStrip tabs={tabs} activeId={tab.id} onSelect={selectTab} />

        <div className="ml-auto flex shrink-0 items-center gap-4">
          {!onHome && <SmallClock />}
          <button
            onClick={() => setPowerOpen(true)}
            aria-label="Menu"
            title="Menu"
            className="flex h-11 w-11 items-center justify-center rounded-full text-dim transition-colors hover:bg-white/8 hover:text-ink"
          >
            <MenuIcon className="h-5 w-5" />
          </button>
        </div>
      </header>

      {tab.id === 'library' && stores.length > 1 && (
        <StoreRow stores={stores} active={storeFilter} onSelect={selectStore} />
      )}

      {onHome ? (
        <div key="home" className="animate-fade-up relative flex min-h-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center">
            <Clock size="tv" />
            <Visualiser className="mt-[2.5vh] h-[clamp(80px,14vh,170px)] max-w-[1100px] shrink-0 [mask-image:linear-gradient(to_right,transparent,black_18%,black_82%,transparent)]" />
            {/* zoom on a content-sized wrapper, or the full-width row scales too */}
            <div className="flex min-h-[84px] w-full shrink-0 justify-center">
              <div className="[zoom:1.3]">
                <NowPlaying />
              </div>
            </div>
            <Lyrics place="tv" className="mt-2 w-full max-w-[900px] shrink-0" />
          </div>

          <div className="flex items-end justify-between gap-8 px-12 pb-2">
            {featured ? (
              <ContinueTile
                game={featured}
                running={runningIds.has(featured.id)}
                onPlay={() => onPlay(featured)}
                onDetails={() => setDetailId(featured.id)}
              />
            ) : (
              <button
                onClick={() => selectTab('library')}
                data-nav-default
                className="h-12 rounded-[12px] px-4 text-[15px] text-muted transition-colors hover:text-dim"
              >
                Browse your library
              </button>
            )}
            <div className="shrink-0 [zoom:1.25]">
              <Friends onOpenSettings={onOpenSettings} />
            </div>
          </div>
        </div>
      ) : (
        <div
          key={`${tab.id}:${storeFilter}`}
          className="animate-fade-up relative flex min-h-0 flex-1 flex-col justify-end"
        >
          {selected ? (
            <>
              <GameInfo
                game={selected}
                running={runningIds.has(selected.id)}
                onPlay={() => onPlay(selected)}
                onDetails={() => setDetailId(selected.id)}
              />
              <Shelf
                key={`${tab.id}:${storeFilter}`}
                games={shelf}
                activeId={selected.id}
                runningIds={runningIds}
                onSelect={select}
                onPlay={onPlay}
                onDetails={(game) => setDetailId(game.id)}
                onFavorite={onToggleFavorite}
              />
            </>
          ) : (
            <p className="px-14 pb-[20vh] text-[18px] text-muted">Nothing here yet.</p>
          )}
        </div>
      )}

      <footer className="relative flex h-16 shrink-0 items-center justify-between px-14">
        <Hints items={[[VIEW, 'Leave big picture']]} />
        <Hints
          items={
            onHome
              ? [
                  [A, 'Play'],
                  [X, 'Details'],
                  [BUMPERS, 'Switch']
                ]
              : [
                  [A, 'Play'],
                  [X, 'Details'],
                  [Y, 'Favourite'],
                  [BUMPERS, 'Switch'],
                  ...(tab.id === 'library' && stores.length > 1
                    ? [[TRIGGERS, 'Store'] as [ReactNode, string]]
                    : []),
                  [B, 'Back']
                ]
          }
        />
      </footer>

      {detail && (
        <Detail
          key={detail.id}
          game={detail}
          running={runningIds.has(detail.id)}
          onPlay={() => onPlay(detail)}
          onToggleFavorite={() => onToggleFavorite(detail)}
          onClose={() => setDetailId(null)}
        />
      )}

      {/* last: gamepad scope() takes the last aria-modal */}
      {powerOpen && (
        <PowerMenu
          pending={powerPending}
          onPending={setPowerPending}
          onClose={() => {
            setPowerPending(null)
            setPowerOpen(false)
          }}
          onExit={onExit}
          onOpenSettings={onOpenSettings}
        />
      )}
    </div>
  )
}
