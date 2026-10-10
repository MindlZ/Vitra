import { useArt } from '../lib/art'
import { hueFor, initials } from '../lib/format'
import type { Game } from '@shared/types'

interface Props {
  game: Game
  className?: string
  captionless?: boolean
}

export default function CoverImage({ game, className = '', captionless = false }: Props) {
  const url = useArt(game.id, 'cover')
  const hue = hueFor(game.name)

  // .icon. files are square (art.ts); letterbox, don't crop
  const isIcon = Boolean(url && url.includes('.icon.'))

  const plate = `linear-gradient(158deg, hsl(${hue} 38% 26%) 0%, hsl(${(hue + 42) % 360} 34% 14%) 56%, #0c0709 100%)`

  if (url && !isIcon) {
    return (
      <img
        src={url}
        alt=""
        draggable={false}
        loading="lazy"
        className={`h-full w-full object-cover ${className}`}
      />
    )
  }

  return (
    <div
      className={`relative flex h-full w-full flex-col items-center justify-center gap-3 px-4 ${className}`}
      style={{ background: plate }}
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_80%_at_50%_0%,rgba(255,255,255,0.14),transparent_62%)]" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(100%_70%_at_50%_120%,rgba(0,0,0,0.45),transparent_60%)]" />

      {isIcon ? (
        <img
          src={url ?? undefined}
          alt=""
          draggable={false}
          loading="lazy"
          className="relative w-[46%] max-w-[104px] drop-shadow-[0_6px_18px_rgba(0,0,0,0.6)]"
        />
      ) : (
        <span
          className="relative font-display font-bold tracking-tight text-snow/85 drop-shadow-[0_2px_10px_rgba(0,0,0,0.5)] [font-stretch:80%]"
          style={{ fontSize: 'clamp(24px, 3.6vw, 42px)' }}
        >
          {initials(game.name)}
        </span>
      )}

      {!captionless && (
        <span className="relative line-clamp-3 text-center text-[11px] leading-snug text-snow/55">
          {game.name}
        </span>
      )}
    </div>
  )
}
