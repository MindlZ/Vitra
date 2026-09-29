import { useEffect, useState, type ReactNode } from 'react'
import {
  ArrowLeft,
  Download,
  Eye,
  EyeOff,
  FolderOpen,
  Image as ImageIcon,
  Play,
  Star,
  Trash2,
  X
} from 'lucide-react'
import type { ArtKind } from '@shared/api'
import type { Game, RunningState } from '@shared/types'
import { useArt } from '../lib/art'
import {
  formatDuration,
  formatLastPlayed,
  formatPlaytime,
  hueFor,
  isSoftware,
  sourceLabel
} from '../lib/format'
import { CaptureGrid, CaptureViewer, useCaptures } from './Captures'
import CoverImage from './CoverImage'
import CoverReflection from './CoverReflection'
import TagInput from './TagInput'

interface Props {
  game: Game
  session?: RunningState
  allTags: string[]
  onBack: () => void
  /** Where Back goes: "Home", "All games", a tag… */
  backLabel: string
  onPlay: () => void
  onStopTracking: () => void
  onPatch: (changes: Partial<Game>) => void
  onRemove: () => void
  onOpenFolder: () => void
  onPickArt: (kind: ArtKind) => void
  onClearArt: (kind: ArtKind) => void
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="font-display text-[24px] leading-tight font-bold tabular-nums text-ink [font-stretch:85%]">
        {value}
      </div>
      <div className="mt-0.5 text-[12px] text-muted">{label}</div>
    </div>
  )
}

function Heading({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <h2 className={`font-display text-[17px] font-semibold text-ink [font-stretch:88%] ${className}`}>
      {children}
    </h2>
  )
}

function DetailRow({ label, value }: { label: string; value?: string }) {
  if (!value) return null
  return (
    <div className="hairline-b flex gap-4 py-2.5 last:border-0">
      <span className="w-[112px] shrink-0 text-[12px] text-muted">{label}</span>
      <span className="min-w-0 flex-1 truncate text-[12px] text-dim" title={value}>
        {value}
      </span>
    </div>
  )
}

function Chip({ children, tone = 'glass' }: { children: ReactNode; tone?: 'glass' | 'live' }) {
  return (
    <span
      className={
        tone === 'live'
          ? 'glass-soft flex items-center gap-2 rounded-full py-1 pr-2.5 pl-1.5 text-[11px] font-medium tabular-nums text-ink'
          : 'glass-soft rounded-full px-2.5 py-1 text-[11px] text-dim'
      }
    >
      {children}
    </span>
  )
}

function IconButton({
  label,
  onClick,
  children
}: {
  label: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      className="glass-btn flex h-11 w-11 items-center justify-center rounded-[11px] text-dim hover:text-ink"
    >
      {children}
    </button>
  )
}

/** Ticks once a second while a tracked session is confirmed running. */
function useElapsed(session?: RunningState): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!session?.confirmed) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [session?.confirmed, session?.startedAt])

  return session?.confirmed ? Math.max(0, Math.round((now - session.startedAt) / 1000)) : 0
}

export default function GameDetail({
  game,
  session,
  allTags,
  onBack,
  backLabel,
  onPlay,
  onStopTracking,
  onPatch,
  onRemove,
  onOpenFolder,
  onPickArt,
  onClearArt
}: Props) {
  const hero = useArt(game.id, 'hero')
  const elapsed = useElapsed(session)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const hue = hueFor(game.name)
  // Each store's URI opens its install prompt for anything not on disk:
  // Steam's rungameid, Epic's ?action=install, GOG Galaxy's game page.
  const canInstall =
    !game.installed && Boolean(game.steamAppId || game.epicLaunchUri || game.launchUri)

  const captures = useCaptures(game.id, Boolean(session))
  const [viewing, setViewing] = useState<number | null>(null)

  useEffect(() => {
    setConfirmRemove(false)
    setViewing(null)
  }, [game.id])

  // Rendered twice: once as the sky, once flipped as its reflection.
  const sky = hero ? (
    <img src={hero} alt="" className="h-full w-full object-cover object-[50%_30%]" />
  ) : (
    <div
      className="h-full w-full"
      style={{
        background: `radial-gradient(120% 110% at 70% 100%, hsl(${hue} 48% 30%) 0%, hsl(${(hue + 30) % 360} 40% 14%) 55%, #0c0713 100%)`
      }}
    />
  )

  return (
    <>
    <div className="animate-fade-up min-h-0 flex-1 overflow-y-auto">
      <div className="relative pb-8">
        {/* The hero is the sky: it ends in a hard horizon at the cover's foot
            and is mirrored below it, as still water. */}
        <div className="absolute inset-x-0 top-0 bottom-8">
          {sky}
          {/* Darken the side the title sits on, and the top under the back button. */}
          <div className="absolute inset-0 bg-gradient-to-r from-base/90 via-base/45 to-base/5" />
          <div className="absolute inset-0 bg-gradient-to-b from-base/60 via-transparent to-transparent" />
          <div aria-hidden className="vitra-hero-reflection">
            {sky}
            <div className="absolute inset-0 bg-gradient-to-r from-base/90 via-base/45 to-base/5" />
          </div>
        </div>

        <div className="relative px-8 pt-5">
          <button
            onClick={onBack}
            className="glass-btn mb-14 flex h-8 items-center gap-2 rounded-full pr-3.5 pl-2.5 text-[12px] text-dim transition-colors hover:text-ink"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            {backLabel}
          </button>

          <div className="flex items-end gap-7">
            <div className="relative w-[182px] shrink-0">
              <div className="aspect-[2/3] overflow-hidden rounded-[10px] bg-raised">
                <CoverImage game={game} captionless />
              </div>
              <div className="absolute inset-x-0 top-full mt-[5px]">
                <CoverReflection game={game} />
              </div>
            </div>

            <div className="min-w-0 flex-1 pb-4">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <Chip>{sourceLabel(game.source)}</Chip>
                {!game.installed && <Chip>Not installed</Chip>}
                {session && (
                  <Chip tone="live">
                    <span className="vitra-sun h-2.5 w-2.5 animate-pulse-dot" />
                    {session.confirmed ? `Playing ${formatDuration(elapsed)}` : 'Starting'}
                  </Chip>
                )}
              </div>

              <h1
                title={game.name}
                className="line-clamp-2 font-display text-[46px] leading-[0.95] font-extrabold tracking-[-0.025em] text-ink [font-stretch:78%]"
              >
                {game.name}
              </h1>

              <div className="mt-7 flex items-center gap-2.5">
                <button
                  onClick={onPlay}
                  disabled={(!game.installed && !canInstall) || Boolean(session)}
                  className="flex h-11 items-center gap-2.5 rounded-[11px] bg-accent px-7 font-display text-[16px] font-bold text-black [font-stretch:88%] shadow-[0_8px_26px_-8px_rgb(var(--accent-rgb)/0.9)] transition-all hover:bg-accent-strong disabled:cursor-not-allowed disabled:bg-white/6 disabled:text-muted disabled:shadow-none"
                >
                  {game.installed ? (
                    <Play className="h-4 w-4 fill-current" />
                  ) : (
                    <Download className="h-4 w-4" />
                  )}
                  {session ? 'Running' : game.installed ? 'Play' : 'Install'}
                </button>

                <IconButton
                  label={game.favorite ? 'Remove from favourites' : 'Add to favourites'}
                  onClick={() => onPatch({ favorite: !game.favorite })}
                >
                  <Star
                    className={`h-4 w-4 ${game.favorite ? 'fill-current text-ember' : ''}`}
                  />
                </IconButton>

                <IconButton label="Open install folder" onClick={onOpenFolder}>
                  <FolderOpen className="h-4 w-4" />
                </IconButton>

                <IconButton
                  label={game.hidden ? 'Unhide' : 'Hide from library'}
                  onClick={() => onPatch({ hidden: !game.hidden })}
                >
                  {game.hidden ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                </IconButton>

                {session && (
                  <button
                    onClick={onStopTracking}
                    title="Stop counting this session — use it if Vitra latched onto the wrong process"
                    className="ml-1 flex h-11 items-center rounded-[11px] px-2.5 text-[12px] text-muted transition-colors hover:text-ink"
                  >
                    Stop tracking
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* After the content so the horizon also crosses the cover's foot. The
            reflection itself stays clean: no ripple bands on this page. */}
        <div className="vitra-horizon absolute inset-x-0 top-[calc(100%-2rem)]" />
      </div>

      {/* Positioned so it paints above the reflections, which are. */}
      <div className="relative px-8 pt-6 pb-12">
        <div className="mb-12 grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-7">
          <Stat label="Time played" value={formatPlaytime(game.playtimeSeconds)} />
          <Stat label="Last played" value={formatLastPlayed(game.lastPlayed)} />
          <Stat label="Sessions" value={game.sessions ? String(game.sessions) : '—'} />
          <Stat
            label="Added"
            value={new Date(game.addedAt).toLocaleDateString(undefined, {
              day: 'numeric',
              month: 'short',
              year: 'numeric'
            })}
          />
        </div>

        {captures.length > 0 && (
          <section className="mb-12">
            <div className="mb-3 flex items-baseline gap-2.5">
              <Heading>Captures</Heading>
              <span className="font-display text-[13px] font-medium tabular-nums text-muted">
                {captures.length}
              </span>
            </div>
            <CaptureGrid key={game.id} captures={captures} onOpen={setViewing} />
          </section>
        )}

        <div className="grid gap-12 lg:grid-cols-[1fr_320px]">
          <div>
            <Heading className="mb-3">Tags</Heading>
            <TagInput tags={game.tags} suggestions={allTags} onChange={(tags) => onPatch({ tags })} />

            <Heading className="mt-11 mb-3">Type</Heading>
            <div role="radiogroup" aria-label="Type" className="glass-soft inline-flex rounded-[11px] p-1">
              {([false, true] as const).map((app) => {
                const selected = isSoftware(game) === app
                return (
                  <button
                    key={String(app)}
                    role="radio"
                    aria-checked={selected}
                    onClick={() => onPatch({ softwareOverride: app })}
                    className={`h-9 rounded-[8px] px-5 text-[12.5px] transition-colors ${
                      selected ? 'bg-white/12 text-ink' : 'text-dim hover:text-ink'
                    }`}
                  >
                    {app ? 'App' : 'Game'}
                  </button>
                )
              })}
            </div>

            <Heading className="mt-11 mb-1">Details</Heading>
            <div>
              <DetailRow label="Store" value={sourceLabel(game.source)} />
              <DetailRow label="Steam app ID" value={game.steamAppId} />
              <DetailRow label="Install folder" value={game.installDir} />
              <DetailRow label="Executable" value={game.exePath} />
              <DetailRow
                label="Tracked as"
                value={game.processHints?.length ? game.processHints.join(', ') : undefined}
              />
            </div>
          </div>

          <div>
            <Heading className="mb-3">Artwork</Heading>
            <div className="flex flex-col gap-2.5">
              {(['cover', 'hero'] as const).map((kind) => (
                <div key={kind} className="flex items-center gap-2.5">
                  <button
                    onClick={() => onPickArt(kind)}
                    className="glass-btn flex h-9 flex-1 items-center gap-2 rounded-[10px] px-3 text-[12px] text-dim transition-colors hover:text-ink"
                  >
                    <ImageIcon className="h-3.5 w-3.5" />
                    Set {kind === 'cover' ? 'cover' : 'background'}
                  </button>
                  <button
                    onClick={() => onClearArt(kind)}
                    title={`Reset ${kind}`}
                    aria-label={`Reset ${kind}`}
                    className="glass-btn flex h-9 w-9 items-center justify-center rounded-[10px] text-muted transition-colors hover:text-danger"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>

            {game.source === 'manual' && (
              <>
                <Heading className="mt-11 mb-3">Remove</Heading>
                {confirmRemove ? (
                  <div className="flex items-center gap-2.5">
                    <button
                      onClick={onRemove}
                      className="flex h-9 flex-1 items-center justify-center rounded-[10px] bg-danger px-3 text-[12px] font-medium text-black"
                    >
                      Remove permanently
                    </button>
                    <button
                      onClick={() => setConfirmRemove(false)}
                      className="glass-btn flex h-9 items-center rounded-[10px] px-3 text-[12px] text-dim hover:text-ink"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmRemove(true)}
                    className="glass-btn flex h-9 w-full items-center gap-2 rounded-[10px] px-3 text-[12px] text-dim hover:text-danger"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Remove from library
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>

    {/* Outside the animated wrapper: its transform would trap `fixed`. */}
    {viewing !== null && (
      <CaptureViewer
        captures={captures}
        index={viewing}
        onIndex={setViewing}
        onClose={() => setViewing(null)}
      />
    )}
    </>
  )
}
