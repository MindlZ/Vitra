import { ArrowDownCircle, Loader2, Plus, RefreshCw, Search, Settings, Tv, Users, X } from 'lucide-react'
import logo from '../assets/vitra-logo.png'
import WindowControls from './WindowControls'
import { useUpdate } from '../lib/update'

interface Props {
  query: string
  onQueryChange: (value: string) => void
  onScan: () => void
  onAdd: () => void
  onOpenSettings: () => void
  onToggleFriends: () => void
  onBigPicture: () => void
  friendsOpen: boolean
  scanning: boolean
}

function UpdatePill() {
  const update = useUpdate()
  if (!update || !['available', 'downloading', 'installing'].includes(update.status)) return null

  const busy = update.status !== 'available'
  const label =
    update.status === 'available'
      ? `Update to ${update.version}`
      : update.status === 'downloading'
        ? `Updating ${update.percent ?? 0}%`
        : 'Installing'

  return (
    <button
      onClick={() => void window.launcher.installUpdate()}
      disabled={busy}
      className="animate-fade-up relative mr-1.5 flex h-8 items-center gap-2 overflow-hidden rounded-full bg-[rgb(var(--accent-rgb)/0.14)] pr-3.5 pl-3 text-[12px] font-medium text-accent tabular-nums ring-1 ring-[rgb(var(--accent-rgb)/0.35)] transition-colors hover:bg-[rgb(var(--accent-rgb)/0.22)] disabled:cursor-default"
    >
      {update.status === 'downloading' && (
        <span
          aria-hidden
          className="absolute inset-y-0 left-0 bg-[rgb(var(--accent-rgb)/0.18)] transition-[width] duration-300"
          style={{ width: `${update.percent ?? 0}%` }}
        />
      )}
      {busy ? (
        <Loader2 className="relative h-3.5 w-3.5 animate-spin" />
      ) : (
        <ArrowDownCircle className="relative h-3.5 w-3.5" />
      )}
      <span className="relative">{label}</span>
    </button>
  )
}

export default function TitleBar({
  query,
  onQueryChange,
  onScan,
  onAdd,
  onOpenSettings,
  onToggleFriends,
  onBigPicture,
  friendsOpen,
  scanning
}: Props) {
  return (
    <header className="glass-chrome hairline-b drag-region flex h-[52px] shrink-0 items-center gap-4 pl-5">
      <div className="flex items-center gap-2.5 select-none">
        <img
          src={logo}
          alt=""
          draggable={false}
          className="h-[24px] w-[24px] drop-shadow-[0_0_8px_rgb(var(--accent-rgb)/0.55)]"
        />
        <span className="font-display text-[17px] leading-none font-bold tracking-[-0.01em] text-ink [font-stretch:85%]">
          Vitra
        </span>
      </div>

      <div className="no-drag relative ml-3 w-[320px]">
        <Search className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
        <input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Search library"
          spellCheck={false}
          className="glass-btn h-8 w-full rounded-[9px] pr-8 pl-9 text-[13px] text-ink placeholder:text-muted"
        />
        {query && (
          <button
            onClick={() => onQueryChange('')}
            aria-label="Clear search"
            className="absolute top-1/2 right-2 -translate-y-1/2 rounded-full p-1 text-muted transition-colors hover:bg-white/8 hover:text-ink"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>

      <div className="no-drag ml-auto flex items-center gap-1">
        <UpdatePill />
        <button
          onClick={onAdd}
          title="Add a game manually"
          className="flex h-8 items-center gap-1.5 rounded-[9px] px-2.5 text-[12px] text-dim transition-colors hover:bg-white/7 hover:text-ink"
        >
          <Plus className="h-3.5 w-3.5" />
          Add game
        </button>
        <button
          onClick={onScan}
          disabled={scanning}
          title="Rescan game libraries"
          className="flex h-8 items-center gap-1.5 rounded-[9px] px-2.5 text-[12px] text-dim transition-colors hover:bg-white/7 hover:text-ink disabled:opacity-50"
        >
          {scanning ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          {scanning ? 'Scanning' : 'Rescan'}
        </button>
        <button
          onClick={onBigPicture}
          title="Big picture mode (F11, or View on a controller)"
          aria-label="Big picture mode"
          className="flex h-8 w-8 items-center justify-center rounded-[9px] text-dim transition-colors hover:bg-white/7 hover:text-ink"
        >
          <Tv className="h-4 w-4" />
        </button>
        <button
          onClick={onToggleFriends}
          title={friendsOpen ? 'Hide friends' : 'Show friends'}
          aria-label={friendsOpen ? 'Hide friends' : 'Show friends'}
          aria-pressed={friendsOpen}
          className={`flex h-8 w-8 items-center justify-center rounded-[9px] transition-colors hover:bg-white/7 hover:text-ink ${
            friendsOpen ? 'text-accent' : 'text-dim'
          }`}
        >
          <Users className="h-4 w-4" />
        </button>
        <button
          onClick={onOpenSettings}
          title="Settings"
          aria-label="Settings"
          className="flex h-8 w-8 items-center justify-center rounded-[9px] text-dim transition-colors hover:bg-white/7 hover:text-ink"
        >
          <Settings className="h-4 w-4" />
        </button>
      </div>

      <div aria-hidden className="-mx-1 h-5 w-px shrink-0 bg-white/10" />
      <WindowControls />
    </header>
  )
}
