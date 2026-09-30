import type { Game } from '@shared/types'
import CoverImage from './CoverImage'

interface Props {
  game: Game
  className?: string
}

// flipped DOM, never -webkit-box-reflect: that's off Chromium's fast path and a
// grid of them made scrolling stutter
export default function CoverReflection({ game, className = '' }: Props) {
  return (
    <div aria-hidden className={`vitra-reflection relative aspect-[10/3] ${className}`}>
      <div
        className={`vitra-reflection__flip ${
          game.installed ? '' : 'opacity-45 saturate-[0.3]'
        }`}
      >
        <CoverImage game={game} captionless />
      </div>
    </div>
  )
}
