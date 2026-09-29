import type { Game } from '@shared/types'
import CoverImage from './CoverImage'

interface Props {
  game: Game
  className?: string
}

/**
 * A cover's reflection on the waterline, as real DOM rather than
 * -webkit-box-reflect: Chromium keeps box-reflect off the fast path, so a grid
 * of them repaints on every scroll frame. This is an ordinary flipped image
 * that rasterises once and then just scrolls.
 *
 * The strip is 20% of the cover's height (a 2:3 cover gives 10:3), showing the
 * cover's bottom edge mirrored and fading out. useArt is cached, so the second
 * CoverImage costs no extra request.
 */
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
