import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight, FolderOpen, Play, X } from 'lucide-react'
import type { Capture } from '@shared/types'

const captureUrl = (capture: Capture): string => `applib://capture/${capture.id}`
const thumbUrl = (capture: Capture): string => `applib://capture/${capture.id}/thumb`

const SOURCE_LABEL: Record<Capture['source'], string> = {
  steam: 'Steam',
  gamebar: 'Xbox Game Bar',
  folder: 'Videos folder'
}

function formatTaken(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  })
}

// re-read on session end and window focus: new screenshots show up on return
export function useCaptures(gameId: string, playing: boolean): Capture[] {
  // tagged by game: a re-read doesn't blank the grid, and another game's never flash up
  const [state, setState] = useState<{ gameId: string; list: Capture[] } | null>(null)

  useEffect(() => {
    // renderer can hot-reload ahead of preload
    if (!window.launcher.listCaptures) return
    let alive = true
    const load = (): void => {
      void window.launcher
        .listCaptures(gameId)
        .then((list) => alive && setState({ gameId, list }))
        .catch(() => undefined)
    }
    load()
    window.addEventListener('focus', load)
    return () => {
      alive = false
      window.removeEventListener('focus', load)
    }
  }, [gameId, playing])

  return state?.gameId === gameId ? state.list : NONE
}

const NONE: Capture[] = []

function Thumb({ capture }: { capture: Capture }) {
  const [failed, setFailed] = useState(false)
  return failed ? (
    <div className="h-full w-full bg-gradient-to-br from-white/8 to-white/2" />
  ) : (
    <img
      src={thumbUrl(capture)}
      alt=""
      loading="lazy"
      decoding="async"
      draggable={false}
      onError={() => setFailed(true)}
      className="h-full w-full object-cover transition-transform duration-300 ease-out group-hover:scale-[1.03] group-focus-visible:scale-[1.03]"
    />
  )
}

const FIRST_SHOWN = 8

export function CaptureGrid({
  captures,
  onOpen
}: {
  captures: Capture[]
  onOpen: (index: number) => void
}) {
  const [all, setAll] = useState(false)
  const shown = all ? captures : captures.slice(0, FIRST_SHOWN)

  return (
    <>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-3">
        {shown.map((capture, index) => (
          <button
            key={capture.id}
            onClick={() => onOpen(index)}
            title={`${formatTaken(capture.takenAt)} · ${SOURCE_LABEL[capture.source]}`}
            aria-label={`${capture.kind === 'video' ? 'Clip' : 'Screenshot'}, ${formatTaken(capture.takenAt)}`}
            className="group relative aspect-video overflow-hidden rounded-[10px] bg-raised ring-1 ring-white/8 transition-shadow hover:ring-[rgb(var(--accent-rgb)/0.55)]"
          >
            <Thumb capture={capture} />
            {capture.kind === 'video' && (
              <span className="glass-soft absolute bottom-2 left-2 flex items-center gap-1.5 rounded-full py-0.5 pr-2 pl-1.5 text-[10.5px] text-ink">
                <Play className="h-3 w-3 fill-current" />
                Clip
              </span>
            )}
          </button>
        ))}
      </div>
      {captures.length > FIRST_SHOWN && (
        <button
          onClick={() => setAll((open) => !open)}
          className="glass-btn mt-3 flex h-8 items-center rounded-full px-3.5 text-[12px] text-dim transition-colors hover:text-ink"
        >
          {all ? 'Show fewer' : `Show all ${captures.length}`}
        </button>
      )}
    </>
  )
}

function StepButton({
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
      aria-label={label}
      title={label}
      className="glass-btn flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-dim hover:text-ink"
    >
      {children}
    </button>
  )
}

// must render outside GameDetail's animated wrapper: a transformed ancestor traps `fixed`
export function CaptureViewer({
  captures,
  index,
  onIndex,
  onClose
}: {
  captures: Capture[]
  index: number
  onIndex: (index: number) => void
  onClose: () => void
}) {
  const root = useRef<HTMLDivElement>(null)
  const capture = captures[index]
  const count = captures.length
  const step = (by: number): void => onIndex((index + by + count) % count)

  const latest = useRef({ step, onClose })
  latest.current = { step, onClose }

  useEffect(() => {
    // capture phase, so Escape doesn't also close the game page
    const onKey = (event: KeyboardEvent): void => {
      // Settings can open above this
      const modals = document.querySelectorAll('[aria-modal="true"]')
      if (modals[modals.length - 1] !== root.current) return

      if (event.key === 'Escape') latest.current.onClose()
      // a focused video seeks with the arrows
      else if (event.target instanceof HTMLVideoElement) return
      else if (event.key === 'ArrowLeft') latest.current.step(-1)
      else if (event.key === 'ArrowRight') latest.current.step(1)
      else return
      event.preventDefault()
      event.stopPropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  if (!capture) return null

  return (
    <div
      ref={root}
      role="dialog"
      aria-modal="true"
      aria-label="Captures"
      data-appearance="dark"
      data-nav-dismiss
      className="animate-fade-up fixed inset-x-0 top-[52px] bottom-0 z-40 flex flex-col bg-black/82 backdrop-blur-md"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="flex h-14 shrink-0 items-center gap-3 px-6">
        <span className="font-display text-[15px] font-semibold tabular-nums text-ink [font-stretch:85%]">
          {index + 1} <span className="text-muted">/ {count}</span>
        </span>
        <span className="truncate text-[12px] text-muted">
          {formatTaken(capture.takenAt)} · {SOURCE_LABEL[capture.source]}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => void window.launcher.revealCapture(capture.id)}
            className="glass-btn flex h-9 items-center gap-2 rounded-[10px] px-3 text-[12px] text-dim transition-colors hover:text-ink"
          >
            <FolderOpen className="h-3.5 w-3.5" />
            Show in folder
          </button>
          <button
            onClick={onClose}
            aria-label="Close"
            title="Close"
            autoFocus
            data-nav-default
            className="glass-btn flex h-9 w-9 items-center justify-center rounded-[10px] text-dim hover:text-ink"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div
        className="flex min-h-0 flex-1 items-center gap-4 px-6 pb-6"
        onClick={(event) => {
          if (event.target === event.currentTarget) onClose()
        }}
      >
        {count > 1 ? (
          <StepButton label="Previous" onClick={() => step(-1)}>
            <ChevronLeft className="h-5 w-5" />
          </StepButton>
        ) : (
          <span className="w-11 shrink-0" />
        )}

        <div
          className="flex h-full min-w-0 flex-1 items-center justify-center"
          onClick={(event) => {
            if (event.target === event.currentTarget) onClose()
          }}
        >
          {capture.kind === 'video' ? (
            <video
              key={capture.id}
              src={captureUrl(capture)}
              controls
              autoPlay
              className="max-h-full max-w-full rounded-[10px] bg-black shadow-[0_30px_80px_-24px_rgba(0,0,0,0.9)]"
            />
          ) : (
            <img
              key={capture.id}
              src={captureUrl(capture)}
              alt={capture.name}
              draggable={false}
              className="max-h-full max-w-full rounded-[10px] object-contain shadow-[0_30px_80px_-24px_rgba(0,0,0,0.9)]"
            />
          )}
        </div>

        {count > 1 ? (
          <StepButton label="Next" onClick={() => step(1)}>
            <ChevronRight className="h-5 w-5" />
          </StepButton>
        ) : (
          <span className="w-11 shrink-0" />
        )}
      </div>
    </div>
  )
}
