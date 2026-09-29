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
  Minimize2,
  Moon,
  Play,
  Power,
  RotateCcw,
  Settings as SettingsIcon,
  Star
} from 'lucide-react'
import type { Appearance, Game, ProgramsView, RunningState } from '@shared/types'
import logo from '../assets/vitra-logo.png'
import { useArt } from '../lib/art'
import {
  formatLastPlayed,
  formatPlaytime,
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
import Visualiser from './Visualiser'

/*
 * Big picture mode: the launcher for a TV and a controller. Fullscreen, large
 * type, and one horizontal shelf of covers standing on the waterline, with
 * the focused game's art filling the screen behind it.
 *
 * It's a modal layer over the desktop UI (aria-modal scopes the controller to
 * it), built from the same parts: Home's clock, visualiser, Now playing and
 * friends; CoverImage and CoverReflection; the wallpaper and its colours.
 * Controller: d-pad/stick move, A plays, X details, Y favourite, LB/RB switch
 * tabs, B steps back, View leaves. Mouse and keyboard work throughout.
 */

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
  /** The wallpaper on screen (activeWallpaper), and its fallback. */
  wallpaper: ActiveWallpaper
  /** The app's appearance; big picture uses it on Home only. */
  appearance: Appearance
  /** A dialog is open above (Settings): leave Escape to it. */
  suspended: boolean
  onPlay: (game: Game) => void
  onToggleFavorite: (game: Game) => void
  onOpenSettings: () => void
  onExit: () => void
  /** App's controller B calls this; true if big picture handled it. */
  backRef: MutableRefObject<(() => boolean) | null>
}

const SOURCES = ['steam', 'epic', 'gog', 'xbox', 'manual'] as const

/** Installed first, then by name: the same order as the desktop grid. */
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

/** A face button, drawn the way the controller labels it. */
/** A controller button, drawn as the pad draws it: dark, in either appearance. */
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

/**
 * The focused game's hero art, full-bleed. Each image fades in over the last;
 * layers remember which game they belong to, so a game without a hero (or
 * one still loading) fades back to the wallpaper rather than keeping the
 * previous game's art behind it.
 */
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

/** Veils that keep the title, tabs and shelf readable over any artwork. */
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
        // A controller's A and the keyboard's Enter arrive as detail 0: play.
        // A mouse click only selects, so the background can be browsed
        // without launching anything; double-click plays.
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
      {/* Reached by the controller's X and Y (lib/gamepad.ts), never a stop. */}
      <button data-nav-skip data-nav-x tabIndex={-1} onClick={onDetails} className="sr-only">
        Details
      </button>
      <button data-nav-skip data-nav-y tabIndex={-1} onClick={onFavorite} className="sr-only">
        {game.favorite ? 'Remove from favourites' : 'Add to favourites'}
      </button>
    </div>
  )
}

/**
 * One row of covers on the waterline. The focused cover lifts, glows and its
 * reflection follows; the scroller keeps it centred (data-nav-center).
 */
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

  // Arrow keys walk the shelf for keyboard users; the pad has its own nav.
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
        // A mouse wheel scrolls the shelf sideways.
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

/** Name, store and time played, large enough to read across a room. */
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
      {/* For the mouse; the controller uses A and X on the cover itself. */}
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

/**
 * Home's one game to pick back up, at TV size: the desktop Continue card's
 * idea (hero strip, name, when you last played) with a ghost Play that only
 * lights up on focus or hover. A plays it; X opens its page.
 */
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
        // Already running: there's nothing to launch, so show its page.
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

/** A game's page at TV scale: art, stats, and the three things you'd do. */
/** Seconds to back out of a restart or shutdown. Sleep and quit act at once. */
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

/**
 * The power menu, like a console's: sleep, restart or shut down the PC,
 * leave big picture, or quit Vitra. Restart and shut down count down first
 * (B or Cancel backs out), so one stray A can't turn the PC off. B steps
 * back through it via big picture's own back(): countdown, then menu.
 */
function PowerMenu({
  pending,
  onPending,
  onClose,
  onExit
}: {
  pending: 'restart' | 'shutdown' | null
  onPending: (action: 'restart' | 'shutdown' | null) => void
  onClose: () => void
  onExit: () => void
}) {
  const root = useRef<HTMLDivElement>(null)
  const [left, setLeft] = useState(POWER_COUNTDOWN)
  const [sent, setSent] = useState(false)

  // Land on the first row when the menu opens, and on Cancel when a
  // countdown starts, so a second A doesn't confirm by accident.
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
            Power
          </div>
          <PowerRow icon={Moon} label="Sleep" onClick={() => act('sleep')} first />
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

  // Land on Play, so A plays straight away.
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

        {/* Lifted by the reflection's height (30% of the cover's width, plus
            its gap), so the text's foot lines up with the cover's. */}
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
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [powerOpen, setPowerOpen] = useState(false)
  const [powerPending, setPowerPending] = useState<'restart' | 'shutdown' | null>(null)

  const runningIds = useMemo(() => new Set(running.map((state) => state.gameId)), [running])

  // The same scoping rules as the desktop library (inLibrary), as tabs.
  const tabs = useMemo(() => {
    const library = games.filter((game) => inLibrary(game, programsView))
    const list: Tab[] = [{ id: 'home', label: 'Home', games: [] }]
    const recent = library
      .filter((game) => game.lastPlayed)
      .sort((a, b) => (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0))
    if (recent.length) list.push({ id: 'recent', label: 'Recent', games: recent })
    const favourites = library.filter((game) => game.favorite).sort(byName)
    if (favourites.length) list.push({ id: 'favorites', label: 'Favourites', games: favourites })
    list.push({ id: 'all', label: 'All games', games: [...library].sort(byName) })
    for (const source of SOURCES) {
      const own = library.filter((game) => game.source === source).sort(byName)
      if (own.length) {
        list.push({
          id: `source:${source}`,
          label: source === 'manual' ? 'Local' : sourceLabel(source),
          games: own
        })
      }
    }
    if (programsView === 'tab') {
      const programs = games.filter((game) => !game.hidden && isSoftware(game)).sort(byName)
      list.push({ id: 'programs', label: 'Programs', games: programs })
    }
    return list
  }, [games, programsView])

  // Home's one game to continue: whatever's running, else the most recently
  // played. Programs stay out, as they do from Continue playing on the desktop.
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
  // Home has no shelf; the library tabs are one each.
  const shelf = tab.id === 'home' ? [] : tab.games
  const selected = shelf.find((game) => game.id === selectedId) ?? shelf[0]
  const detail = detailId ? games.find((game) => game.id === detailId) : undefined

  const selectTab = (id: string): void => {
    setTabId(id)
    setSelectedId(null)
  }

  // Switching tabs with the pad puts focus on the new tab's default (a shelf's
  // first cover, or Home's Continue); with the mouse, focus stays put.
  useEffect(() => {
    if (!usingPad()) return
    const frame = requestAnimationFrame(() => {
      root.current
        ?.querySelector<HTMLElement>('[data-nav-default]')
        ?.focus({ preventScroll: true, focusVisible: true } as FocusOptions)
    })
    return () => cancelAnimationFrame(frame)
  }, [tab.id])

  const select = (game: Game): void => {
    if (game.id === selected?.id) return
    setSelectedId(game.id)
    playSound('card-hover', 0.22)
  }

  // B, and Escape: close the page, then go back to Home. On Home it's a no-op;
  // leaving big picture is View, F11 or the Exit button, never an accident.
  const back = (): boolean => {
    // The power menu first: a countdown backs out to the menu, then it closes.
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
      // Home shows the wallpaper, so it follows the app. The library tabs sit
      // over game art, which stays dark whatever the wallpaper.
      data-appearance={onHome ? appearance : 'dark'}
      className="vitra-bp fixed inset-0 z-[45] flex flex-col overflow-hidden bg-base"
    >
      {/* The wallpaper, then (off Home) the selected game's art over it. */}
      <Backdrop dim={backgroundDim} appearance={onHome ? appearance : 'dark'} {...wallpaper} />
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

        {/* Scrolls sideways if a big library has more tabs than fit; the
            padding keeps the sun marker under the active tab unclipped. */}
        <nav
          aria-label="Big picture sections"
          className="flex min-w-0 items-center gap-1.5 overflow-x-auto py-3 [scrollbar-width:none]"
        >
          <span className="mr-2 hidden xl:inline-flex">
            <Glyph>LB</Glyph>
          </span>
          {tabs.map((entry) => {
            const active = entry.id === tab.id
            return (
              <button
                key={entry.id}
                onClick={() => selectTab(entry.id)}
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
          <span className="ml-2 hidden xl:inline-flex">
            <Glyph>RB</Glyph>
          </span>
        </nav>

        <div className="ml-auto flex shrink-0 items-center gap-2">
          {!onHome && (
            <span className="mr-4">
              <SmallClock />
            </span>
          )}
          <button
            onClick={onOpenSettings}
            aria-label="Settings"
            title="Settings"
            className="flex h-11 w-11 items-center justify-center rounded-full text-dim transition-colors hover:bg-white/8 hover:text-ink"
          >
            <SettingsIcon className="h-5 w-5" />
          </button>
          <button
            onClick={() => setPowerOpen(true)}
            aria-label="Power"
            title="Sleep, restart, shut down"
            className="flex h-11 w-11 items-center justify-center rounded-full text-dim transition-colors hover:bg-white/8 hover:text-ink"
          >
            <Power className="h-5 w-5" />
          </button>
          <button
            onClick={onExit}
            title="Leave big picture (View or F11)"
            className="flex h-11 items-center gap-2 rounded-full px-4 text-[14px] text-dim transition-colors hover:bg-white/8 hover:text-ink"
          >
            <Minimize2 className="h-4 w-4" />
            Exit
          </button>
        </div>
      </header>

      {onHome ? (
        <div key="home" className="animate-fade-up relative flex min-h-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center">
            <Clock size="tv" />
            <Visualiser className="mt-[2.5vh] h-[clamp(80px,14vh,170px)] max-w-[1100px] shrink-0 [mask-image:linear-gradient(to_right,transparent,black_18%,black_82%,transparent)]" />
            {/* Home's own Now playing, set larger for the room. The zoom sits on
                a content-sized wrapper so the full-width row isn't scaled too. */}
            <div className="flex min-h-[84px] w-full shrink-0 justify-center">
              <div className="[zoom:1.3]">
                <NowPlaying />
              </div>
            </div>
          </div>

          {/* A slim bottom bar, like the desktop Home: one game to continue
              and a few friends, nothing more. The library tabs hold the rest. */}
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
                onClick={() => selectTab('all')}
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
        <div key={tab.id} className="animate-fade-up relative flex min-h-0 flex-1 flex-col justify-end">
          {selected ? (
            <>
              <GameInfo
                game={selected}
                running={runningIds.has(selected.id)}
                onPlay={() => onPlay(selected)}
                onDetails={() => setDetailId(selected.id)}
              />
              <Shelf
                key={tab.id}
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

      {/* Last, so it's the aria-modal the controller scopes to. */}
      {powerOpen && (
        <PowerMenu
          pending={powerPending}
          onPending={setPowerPending}
          onClose={() => {
            setPowerPending(null)
            setPowerOpen(false)
          }}
          onExit={onExit}
        />
      )}
    </div>
  )
}
