import { useEffect, useMemo, useState } from 'react'
import { Download, KeyRound, Play } from 'lucide-react'
import type { Friend, Game, RunningState } from '@shared/types'
import { useArt } from '../lib/art'
import { formatLastPlayed, formatPlaytime, hueFor, isSoftware } from '../lib/format'
import { STATE_DOT, STATE_LABEL, useFriends } from '../lib/friends'
import NowPlaying from './NowPlaying'
import Visualiser from './Visualiser'

interface Props {
  games: Game[]
  running: RunningState[]
  onOpen: (game: Game) => void
  onPlay: (game: Game) => void
  onBrowse: () => void
  onOpenSettings: () => void
}

/** A handful of faces; the rest is a "+n". */
const FRIENDS_SHOWN = 6

/** Re-renders on each minute boundary rather than every second. */
export function useMinute(): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const schedule = (): void => {
      timer = setTimeout(
        () => {
          setNow(new Date())
          schedule()
        },
        60_000 - (Date.now() % 60_000) + 50
      )
    }
    schedule()
    return () => clearTimeout(timer)
  }, [])
  return now
}

/** Home's clock. `tv` is big picture's size: larger, and read from a sofa. */
export function Clock({ size = 'normal' }: { size?: 'normal' | 'tv' }) {
  const now = useMinute()
  // Follows the Windows 12/24-hour setting; the AM/PM part is set small.
  const parts = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).formatToParts(now)
  const period = parts.find((part) => part.type === 'dayPeriod')?.value

  return (
    <div className="flex flex-col items-center select-none">
      {/* Thin, condensed and tabular reads as a display readout rather than a
          headline; the colon breathes (.vitra-colon) so it feels live without
          a seconds counter. */}
      <div
        role="timer"
        aria-label={now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
        className={`relative flex items-start font-display leading-[0.9] font-extralight tracking-[0.03em] text-ink tabular-nums [font-stretch:75%] [text-shadow:0_0_48px_rgb(var(--accent-rgb)/0.22)] ${
          size === 'tv'
            ? 'text-[clamp(72px,min(12vw,16vh),220px)]'
            : 'text-[clamp(56px,min(10vw,17vh),136px)]'
        }`}
      >
        {parts
          .filter((part) => part.type !== 'dayPeriod')
          .map((part, i) =>
            part.type === 'literal' ? (
              part.value.trim() && (
                <span key={i} className="vitra-colon relative -top-[0.05em] px-[0.04em] text-accent">
                  {part.value.trim()}
                </span>
              )
            ) : (
              <span key={i}>{part.value}</span>
            )
          )}
        {/* Hung just outside the digits, so it takes no width and the time
            itself sits dead centre. */}
        {period && (
          <span
            className={`absolute top-[0.35em] left-full ml-3 font-normal tracking-[0.06em] whitespace-nowrap text-muted [font-stretch:100%] [text-shadow:none] ${
              size === 'tv' ? 'text-[22px]' : 'text-[16px]'
            }`}
          >
            {period}
          </span>
        )}
      </div>
      <div className={`mt-4 text-muted ${size === 'tv' ? 'text-[18px]' : 'text-[13px]'}`}>
        {now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
      </div>
    </div>
  )
}

/** "Last played yesterday", but never lowercases a date ("Sep 12, 2025"). */
export function lastPlayedPhrase(timestamp?: number): string {
  const when = formatLastPlayed(timestamp)
  const relative = when === 'Today' || when === 'Yesterday' || when.endsWith(' ago')
  return `Last played ${relative ? when.toLowerCase() : when}`
}

/**
 * The one game to pick back up, as a slim card: a small strip of hero art,
 * the name, when you last played, and a ghost Play that only turns magenta
 * on hover or focus.
 */
function ContinueCard({
  game,
  running,
  onOpen,
  onPlay
}: {
  game: Game
  running: boolean
  onOpen: () => void
  onPlay: () => void
}) {
  const hero = useArt(game.id, 'hero')
  const hue = hueFor(game.name)
  const canPlay = game.installed || Boolean(game.steamAppId)
  const action = running ? 'Playing' : game.installed ? 'Play' : 'Install'

  return (
    <div
      data-nav-group
      data-game-id={game.id}
      className="group relative flex w-[340px] max-w-full items-center gap-3 rounded-[12px] p-2 pr-2.5 transition-colors hover:bg-white/4"
    >
      {/* The whole card opens the game; Play sits above it. */}
      <button
        onClick={onOpen}
        aria-label={`Open ${game.name}`}
        data-nav-primary
        data-nav-default
        className="absolute inset-0 rounded-[12px]"
      />

      <div
        className={`pointer-events-none h-[52px] w-[92px] shrink-0 overflow-hidden rounded-[8px] bg-raised opacity-80 transition-opacity group-hover:opacity-100 ${
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

      <div className="pointer-events-none min-w-0 flex-1">
        <div className="truncate text-[13px] text-dim transition-colors group-hover:text-ink">
          {game.name}
        </div>
        <div className="mt-0.5 truncate text-[11px] text-muted">
          {running ? 'Playing now' : lastPlayedPhrase(game.lastPlayed)}
          {!running && game.playtimeSeconds > 0 && ` · ${formatPlaytime(game.playtimeSeconds)}`}
        </div>
      </div>

      <button
        onClick={onPlay}
        disabled={running || !canPlay}
        title={action}
        aria-label={`${action} ${game.name}`}
        data-nav-skip
        data-nav-x
        className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-dim transition-colors hover:bg-accent hover:text-black focus-visible:bg-accent focus-visible:text-black disabled:hover:bg-transparent disabled:hover:text-dim"
      >
        {running ? (
          <span className="vitra-sun h-2.5 w-2.5 animate-pulse-dot" />
        ) : game.installed ? (
          <Play className="h-4 w-4 translate-x-px fill-current" />
        ) : (
          <Download className="h-4 w-4" />
        )}
      </button>
    </div>
  )
}

function FriendFace({ friend, faded }: { friend: Friend; faded: boolean }) {
  const [failed, setFailed] = useState(false)
  const status = friend.playing ?? STATE_LABEL[friend.state]

  // Faces only; the name and status live in the tooltip.
  return (
    <button
      onClick={() => friend.profileUrl && window.open(friend.profileUrl, '_blank')}
      title={faded ? `${friend.name} is offline` : `${friend.name}: ${status}`}
      aria-label={faded ? `${friend.name}, offline` : `${friend.name}, ${status}`}
      className={`flex h-10 w-10 items-center justify-center rounded-full transition-opacity ${
        faded ? 'opacity-35 grayscale hover:opacity-70' : 'opacity-85 hover:opacity-100'
      }`}
    >
      <span className="relative">
        {friend.avatar && !failed ? (
          <img
            src={friend.avatar}
            alt=""
            onError={() => setFailed(true)}
            className="h-8 w-8 rounded-full object-cover"
          />
        ) : (
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/8 text-[11px] font-medium text-dim">
            {friend.name.slice(0, 2).toUpperCase()}
          </span>
        )}
        {!faded && (
          <span
            className={`absolute -right-px -bottom-px h-2.5 w-2.5 rounded-full border-2 border-base ${STATE_DOT[friend.state]}`}
          />
        )}
      </span>
    </button>
  )
}

export function Friends({ onOpenSettings }: { onOpenSettings: () => void }) {
  const { snapshot } = useFriends()

  if (!snapshot) return null

  if (snapshot.status === 'no-key') {
    return (
      <button
        onClick={onOpenSettings}
        className="flex h-10 items-center gap-2 rounded-[10px] px-3 text-[12px] text-muted transition-colors hover:text-dim"
      >
        <KeyRound className="h-3.5 w-3.5" />
        Add a Steam key to see friends
      </button>
    )
  }

  if (snapshot.status !== 'ok') {
    return (
      <p className="max-w-[280px] truncate text-[12px] text-muted" title={snapshot.message}>
        {snapshot.message ?? 'Could not load your friends list.'}
      </p>
    )
  }

  // Older main processes don't send `offline`; treat it as empty.
  const offline = snapshot.offline ?? []
  const anyoneOn = snapshot.friends.length > 0
  const shown = (anyoneOn ? snapshot.friends : offline).slice(0, FRIENDS_SHOWN)
  const more = (anyoneOn ? snapshot.friends.length : 0) - shown.length

  return (
    <section aria-label="Friends" className="flex min-w-0 flex-col items-end gap-1">
      <div className="text-[11.5px] text-muted tabular-nums">
        {anyoneOn
          ? `${snapshot.friends.length} online`
          : snapshot.offlineCount
            ? "Nobody's online"
            : 'No friends yet'}
      </div>
      {shown.length > 0 && (
        <div className="-mr-1 flex items-center">
          {shown.map((friend) => (
            <FriendFace key={friend.steamId} friend={friend} faded={!anyoneOn} />
          ))}
          {more > 0 && <span className="pl-1.5 text-[11.5px] text-muted tabular-nums">+{more}</span>}
        </div>
      )}
    </section>
  )
}

export default function Home({ games, running, onOpen, onPlay, onBrowse, onOpenSettings }: Props) {
  const runningIds = useMemo(() => new Set(running.map((state) => state.gameId)), [running])

  // A running game always leads, then the most recently played. Software is
  // left out: Wallpaper Engine and friends run all day and would always win.
  const featured = useMemo(() => {
    const rank = (game: Game): number =>
      runningIds.has(game.id) ? Infinity : (game.lastPlayed ?? 0)
    let best: Game | undefined
    for (const game of games) {
      if (game.hidden || isSoftware(game) || rank(game) === 0) continue
      if (!best || rank(game) > rank(best)) best = game
    }
    return best
  }, [games, runningIds])

  // Fits the window, never scrolls: the centred column takes whatever height
  // is left above the slim bottom bar, and sizes itself to it.
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-8 pt-4">
        <Clock />
        <Visualiser className="mt-[clamp(8px,2.5vh,24px)] h-[clamp(70px,15vh,130px)] max-w-[760px] shrink-0 [mask-image:linear-gradient(to_right,transparent,black_18%,black_82%,transparent)]" />
        {/* Held open so the page doesn't jump when a track starts or stops. */}
        <div className="flex min-h-[52px] w-full shrink-0 justify-center">
          <NowPlaying />
        </div>
      </div>

      <div className="mx-auto flex w-full max-w-[1080px] shrink-0 items-end justify-between gap-6 px-6 pt-4 pb-6">
        {featured ? (
          <ContinueCard
            game={featured}
            running={runningIds.has(featured.id)}
            onOpen={() => onOpen(featured)}
            onPlay={() => onPlay(featured)}
          />
        ) : (
          <button
            onClick={onBrowse}
            className="flex h-10 items-center rounded-[10px] px-3 text-[12px] text-muted transition-colors hover:text-dim"
          >
            Browse library
          </button>
        )}
        <Friends onOpenSettings={onOpenSettings} />
      </div>
    </div>
  )
}
