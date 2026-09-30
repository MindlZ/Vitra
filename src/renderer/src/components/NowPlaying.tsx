import { Music, Pause, Play, SkipBack, SkipForward } from 'lucide-react'
import type { ReactNode } from 'react'
import { playerName, sendMedia, useMedia, useMediaPosition } from '../lib/media'

function Control({
  label,
  onClick,
  disabled,
  children
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  children: ReactNode
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className="flex h-10 w-10 items-center justify-center rounded-full text-dim transition-colors hover:bg-white/6 hover:text-ink disabled:opacity-35 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  )
}

export default function NowPlaying() {
  const media = useMedia()
  const position = useMediaPosition(media)

  if (!media?.active || !media.title) return null

  const playing = media.status === 'Playing'
  const duration = media.durationMs ?? 0
  const player = playerName(media.app)
  const byline = media.artist || media.album || player

  return (
    <section
      aria-label="Now playing"
      className="group flex w-[380px] max-w-full flex-col gap-1.5 animate-fade-up"
    >
      <div className="flex items-center gap-3">
        <div
          className="h-9 w-9 shrink-0 overflow-hidden rounded-[6px] bg-raised opacity-85"
          title={player || undefined}
        >
          {media.art ? (
            <img src={media.art} alt="" draggable={false} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-muted">
              <Music className="h-3.5 w-3.5" />
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="truncate text-[12.5px] leading-tight text-dim" title={media.title}>
            {media.title}
          </div>
          {byline && (
            <div className="mt-0.5 truncate text-[11px] text-muted" title={byline}>
              {byline}
            </div>
          )}
        </div>

        <div className="-mr-2 flex shrink-0 items-center opacity-50 transition-opacity duration-200 group-focus-within:opacity-100 group-hover:opacity-100">
          <Control
            label="Previous track"
            onClick={() => sendMedia('previous')}
            disabled={media.canPrevious === false}
          >
            <SkipBack className="h-3.5 w-3.5 fill-current" />
          </Control>
          <Control
            label={playing ? 'Pause' : 'Play'}
            onClick={() => sendMedia('toggle')}
            disabled={media.canPlayPause === false}
          >
            {playing ? (
              <Pause className="h-4 w-4 fill-current" />
            ) : (
              <Play className="h-4 w-4 translate-x-px fill-current" />
            )}
          </Control>
          <Control
            label="Next track"
            onClick={() => sendMedia('next')}
            disabled={media.canNext === false}
          >
            <SkipForward className="h-3.5 w-3.5 fill-current" />
          </Control>
        </div>
      </div>

      {duration > 0 && (
        <div className="h-px w-full overflow-hidden bg-white/8">
          <div
            className="h-full bg-white/35"
            style={{ width: `${Math.min(100, (position / duration) * 100)}%` }}
          />
        </div>
      )}
    </section>
  )
}
