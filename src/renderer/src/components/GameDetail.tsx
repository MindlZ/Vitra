import { useEffect, useState, type ReactNode } from 'react'
import {
  AppWindow,
  ArrowLeft,
  Download,
  Eye,
  EyeOff,
  FolderOpen,
  Image as ImageIcon,
  Play,
  Plus,
  Star,
  Trash2,
  X
} from 'lucide-react'
import type { ArtKind } from '@shared/api'
import {
  GAME_SOURCES,
  type AchievementSummary,
  type Game,
  type GameSource,
  type RunningState
} from '@shared/types'
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
  backLabel: string
  onPlay: () => void
  onStopTracking: () => void
  onPatch: (changes: Partial<Game>) => void
  onSetStore: (store: GameSource) => void
  // after main changed the game itself (companion dialogs)
  onRefresh: () => void
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

function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

// paths are picked in main's own dialog; this only asks
function Companions({ game, onChanged }: { game: Game; onChanged: () => void }) {
  const companions = game.companions ?? []
  const after = (clear?: boolean): void => void window.launcher.setAfterExit(game.id, clear).then(onChanged)

  return (
    <div className="flex max-w-[460px] flex-col gap-2">
      {companions.map((path, index) => (
        <div key={path} className="glass-soft flex h-9 items-center gap-2 rounded-[10px] pr-1 pl-3">
          <AppWindow className="h-3.5 w-3.5 shrink-0 text-muted" />
          <span className="min-w-0 flex-1 truncate text-[12px] text-dim" title={path}>
            {fileName(path)}
          </span>
          <button
            onClick={() => void window.launcher.removeCompanion(game.id, index).then(onChanged)}
            aria-label={`Remove ${fileName(path)}`}
            className="flex h-7 w-7 items-center justify-center rounded-[8px] text-muted hover:text-ink"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      <button
        onClick={() => void window.launcher.addCompanion(game.id).then(onChanged)}
        className="glass-btn flex h-9 items-center gap-2 rounded-[10px] px-3 text-[12px] text-dim hover:text-ink"
      >
        <Plus className="h-3.5 w-3.5" />
        Start a program with it
      </button>
      {companions.length > 0 && (
        <button
          role="switch"
          aria-checked={Boolean(game.closeCompanions)}
          onClick={() => onChangeClose(!game.closeCompanions)}
          className="flex h-9 items-center justify-between rounded-[10px] px-3 text-[12px] text-dim hover:text-ink"
        >
          Close them afterwards
          <span
            className={`relative h-5 w-9 rounded-full transition-colors ${
              game.closeCompanions ? 'bg-accent' : 'bg-white/12'
            }`}
          >
            <span
              className={`absolute top-0.5 h-4 w-4 rounded-full bg-snow transition-[left] ${
                game.closeCompanions ? 'left-[18px]' : 'left-0.5'
              }`}
            />
          </span>
        </button>
      )}
      {game.afterExit ? (
        <div className="glass-soft flex h-9 items-center gap-2 rounded-[10px] pr-1 pl-3">
          <span className="shrink-0 text-[12px] text-muted">Afterwards</span>
          <span className="min-w-0 flex-1 truncate text-[12px] text-dim" title={game.afterExit}>
            {fileName(game.afterExit)}
          </span>
          <button
            onClick={() => after(true)}
            aria-label="Remove the program run afterwards"
            className="flex h-7 w-7 items-center justify-center rounded-[8px] text-muted hover:text-ink"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <button
          onClick={() => after()}
          className="glass-btn flex h-9 items-center gap-2 rounded-[10px] px-3 text-[12px] text-dim hover:text-ink"
        >
          <Plus className="h-3.5 w-3.5" />
          Run something when it closes
        </button>
      )}
    </div>
  )

  function onChangeClose(value: boolean): void {
    void window.launcher.patchGame(game.id, { closeCompanions: value }).then(onChanged)
  }
}

// any Steam copy of a merged game will do
function Achievements({ game }: { game: Game }) {
  const steamCopy = [game, ...(game.siblings ?? [])].find((copy) => copy.steamAppId)
  const [summary, setSummary] = useState<AchievementSummary | null>(null)

  useEffect(() => {
    setSummary(null)
    if (!steamCopy || !window.launcher.getAchievements) return
    let alive = true
    void window.launcher.getAchievements(steamCopy.id).then((result) => {
      if (alive) setSummary(result)
    })
    return () => {
      alive = false
    }
  }, [steamCopy?.id])

  if (summary?.status === 'private') {
    return <p className="mb-12 text-[12px] text-muted">Achievements private on Steam</p>
  }
  if (summary?.status !== 'ok' || !summary.total) return null
  const share = summary.unlocked / summary.total

  return (
    <section className="mb-12">
      <div className="mb-3 flex items-baseline gap-2.5">
        <Heading>Achievements</Heading>
        <span className="font-display text-[13px] font-medium tabular-nums text-muted">
          {summary.unlocked} / {summary.total}
        </span>
      </div>
      <div
        role="meter"
        aria-label="Achievements unlocked"
        aria-valuemin={0}
        aria-valuemax={summary.total}
        aria-valuenow={summary.unlocked}
        className="mb-5 h-1.5 max-w-[420px] overflow-hidden rounded-full bg-white/8"
      >
        <div className="h-full rounded-full bg-accent" style={{ width: `${share * 100}%` }} />
      </div>
      {summary.rarest.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-3">
          {summary.rarest.map((achievement) => (
            <div key={achievement.name} className="flex min-w-0 items-center gap-3" title={achievement.description}>
              {achievement.icon ? (
                <img src={achievement.icon} alt="" className="h-10 w-10 shrink-0 rounded-[8px]" />
              ) : (
                <div className="h-10 w-10 shrink-0 rounded-[8px] bg-white/8" />
              )}
              <div className="min-w-0">
                <div className="truncate text-[12.5px] text-ink">{achievement.name}</div>
                {achievement.percent !== undefined && (
                  <div className="text-[11px] tabular-nums text-muted">
                    {achievement.percent < 1 ? achievement.percent.toFixed(1) : Math.round(achievement.percent)}% of
                    players
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

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
  onSetStore,
  onRefresh,
  onRemove,
  onOpenFolder,
  onPickArt,
  onClearArt
}: Props) {
  const hero = useArt(game.id, 'hero')
  const elapsed = useElapsed(session)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const hue = hueFor(game.name)
  // each store's URI doubles as its install prompt
  const canInstall =
    !game.installed && Boolean(game.steamAppId || game.epicLaunchUri || game.launchUri)

  const captures = useCaptures(game.id, Boolean(session))
  const [viewing, setViewing] = useState<number | null>(null)

  useEffect(() => {
    setConfirmRemove(false)
    setViewing(null)
  }, [game.id])

  // rendered twice: sky + flipped reflection
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
        <div className="absolute inset-x-0 top-0 bottom-8">
          {sky}
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
                {game.siblings?.map((copy) => <Chip key={copy.id}>{sourceLabel(copy.source)}</Chip>)}
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

        {/* after the content so the line also crosses the cover's foot */}
        <div className="vitra-horizon absolute inset-x-0 top-[calc(100%-2rem)]" />
      </div>

      {/* relative: paints above the (positioned) reflections */}
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

        <Achievements game={game} />

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

            {game.siblings?.length ? (
              <>
                <Heading className="mt-11 mb-3">Launch from</Heading>
                <div role="radiogroup" aria-label="Launch from" className="glass-soft inline-flex flex-wrap rounded-[11px] p-1">
                  {[game, ...game.siblings]
                    .sort((a, b) => GAME_SOURCES.indexOf(a.source) - GAME_SOURCES.indexOf(b.source))
                    .map((copy) => {
                      const selected = copy.id === game.id
                      return (
                        <button
                          key={copy.id}
                          role="radio"
                          aria-checked={selected}
                          onClick={() => !selected && onSetStore(copy.source)}
                          title={copy.installed ? undefined : 'Not installed'}
                          className={`h-9 rounded-[8px] px-5 text-[12.5px] transition-colors ${
                            selected ? 'bg-white/12 text-ink' : 'text-dim hover:text-ink'
                          } ${copy.installed ? '' : 'opacity-60'}`}
                        >
                          {sourceLabel(copy.source)}
                        </button>
                      )
                    })}
                </div>
              </>
            ) : null}

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

            {/* renderer can hot-reload ahead of preload */}
            {game.installed && 'addCompanion' in window.launcher && (
              <>
                <Heading className="mt-11 mb-3">With this game</Heading>
                <Companions game={game} onChanged={onRefresh} />
              </>
            )}

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

    {/* outside the animated wrapper: its transform would trap `fixed` */}
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
