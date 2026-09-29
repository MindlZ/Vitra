import { useRef, useState, type FocusEvent } from 'react'
import { CloudDownload, Play, Star } from 'lucide-react'
import type { Game } from '@shared/types'
import { formatPlaytimeShort } from '../lib/format'
import { playSound } from '../lib/sound'
import CoverImage from './CoverImage'
import CoverReflection from './CoverReflection'

interface Props {
  game: Game
  running: boolean
  onOpen: () => void
  onPlay: () => void
  onToggleFavorite: () => void
}

/**
 * "Active" is hover or keyboard/controller focus; either one lifts the card.
 * Tracked in JS rather than :hover so the wobble can play on the way *out*
 * as well, and not on first render.
 */
function useActive() {
  const hovered = useRef(false)
  const focused = useRef(false)
  const active = useRef(false)
  const [phase, setPhase] = useState<'in' | 'out'>()

  const sync = (): void => {
    const next = hovered.current || focused.current
    if (next === active.current) return
    active.current = next
    setPhase(next ? 'in' : 'out')
    playSound(next ? 'card-hover' : 'card-leave')
  }

  return {
    phase,
    handlers: {
      onMouseEnter: () => {
        hovered.current = true
        sync()
      },
      onMouseLeave: () => {
        hovered.current = false
        sync()
      },
      // Only visible focus counts: a mouse click also focuses the button, and
      // that shouldn't keep the card lifted after the pointer leaves.
      onFocus: (event: FocusEvent<HTMLElement>) => {
        if ((event.target as HTMLElement).matches(':focus-visible')) focused.current = true
        sync()
      },
      onBlur: (event: FocusEvent<HTMLElement>) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) focused.current = false
        sync()
      }
    }
  }
}

export default function GameCard({ game, running, onOpen, onPlay, onToggleFavorite }: Props) {
  const { phase, handlers } = useActive()

  return (
    // content-visibility clips paint to this box, so the padding (cancelled by
    // the negative margin) is room for the glow; while active the clip is
    // lifted entirely (.vitra-card[data-active]). The data-nav-* attributes are
    // for controller navigation (lib/gamepad.ts).
    <div
      className="vitra-card group -m-4 p-4"
      data-active={phase === 'in' || undefined}
      data-wobble={phase}
      data-nav-group
      data-game-id={game.id}
    >
      {/* Grows from its bottom edge, so the card rises off the waterline
          rather than swelling in place. */}
      <div className="vitra-card__lift relative" {...handlers}>
        <button
          onClick={onOpen}
          title={game.name}
          data-nav-primary
          className={`vitra-card__cover relative block aspect-[2/3] w-full overflow-hidden rounded-[10px] bg-raised text-left transition-[box-shadow,filter] duration-200 ease-out ${
            running ? 'shadow-[0_0_0_1px_rgb(var(--accent-rgb)/0.7),0_0_34px_-4px_rgb(var(--accent-rgb)/0.6)]' : ''
          }`}
        >
          <div
            className={`h-full w-full transition-all duration-200 ${
              game.installed ? '' : 'opacity-45 saturate-[0.3] group-data-[active]:opacity-70'
            }`}
          >
            <CoverImage game={game} />
          </div>

          {/* Name plate, revealed when active so the art stays clean at rest. */}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/92 via-black/55 to-transparent px-3 pt-10 pb-2.5 opacity-0 transition-opacity duration-200 group-data-[active]:opacity-100">
            <div className="truncate font-display text-[14px] leading-tight font-semibold text-snow [font-stretch:88%]">
              {game.name}
            </div>
            <div className="mt-0.5 text-[10.5px] text-snow/60">
              {game.installed ? formatPlaytimeShort(game.playtimeSeconds) : 'Not installed'}
            </div>
          </div>

          {running && (
            <span className="absolute top-2.5 left-2.5 flex items-center gap-1.5 rounded-full bg-black/55 py-[3px] pr-2.5 pl-1.5 text-[10.5px] font-medium text-snow backdrop-blur-md">
              <span className="vitra-sun h-2.5 w-2.5 animate-pulse-dot" />
              Playing
            </span>
          )}

          {!running && !game.installed && (
            <span
              title="Owned, not installed"
              className="absolute top-2.5 left-2.5 flex h-6 w-6 items-center justify-center rounded-full border border-snow/12 bg-black/45 text-snow/70 backdrop-blur-md"
            >
              <CloudDownload className="h-3 w-3" />
            </span>
          )}
        </button>

        {/* Hover-only for the mouse; a controller reaches these with X and Y. */}
        {game.installed && (
          <button
            onClick={onPlay}
            aria-label={`Play ${game.name}`}
            data-nav-skip
            data-nav-x
            className="absolute right-2.5 bottom-2.5 flex h-9 w-9 translate-y-1.5 items-center justify-center rounded-full bg-accent text-black opacity-0 shadow-[0_6px_20px_-4px_rgb(var(--accent-rgb)/0.8)] transition-all duration-200 group-data-[active]:translate-y-0 group-data-[active]:opacity-100 hover:bg-accent-strong"
          >
            <Play className="h-3.5 w-3.5 translate-x-px fill-current" />
          </button>
        )}

        <button
          onClick={onToggleFavorite}
          aria-label={game.favorite ? 'Remove from favourites' : 'Add to favourites'}
          data-nav-skip
          data-nav-y
          className={`absolute top-2 right-2 flex h-7 w-7 items-center justify-center rounded-full transition-all duration-200 ${
            game.favorite
              ? 'text-ember opacity-100 drop-shadow-[0_1px_4px_rgba(0,0,0,0.9)]'
              : 'text-snow/70 opacity-0 group-data-[active]:opacity-100 hover:text-snow'
          }`}
        >
          <Star className={`h-4 w-4 ${game.favorite ? 'fill-current' : ''}`} />
        </button>
      </div>

      <CoverReflection game={game} className="mt-[5px]" />
    </div>
  )
}
