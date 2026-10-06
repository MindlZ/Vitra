import { useLyricIndex, useLyrics, useLyricsShown, type LyricsPlace } from '../lib/lyrics'
import { useMedia } from '../lib/media'

// current line (wraps to two, never an ellipsis), plus the next one faint where there's
// room. box = space held while lyrics are on here, so lines coming and going shift nothing
const STYLES: Record<LyricsPlace, { box: string; current: string; next?: string; align?: string }> = {
  home: { box: 'min-h-[38px]', current: 'text-[13px] leading-[1.35] text-dim' },
  tv: { box: 'min-h-[60px]', current: 'text-[clamp(16px,1.3vw,22px)] leading-[1.3] text-dim' },
  saver: {
    box: '',
    align: 'text-left',
    current: 'font-display text-[clamp(18px,1.7vw,30px)] leading-[1.15] font-semibold text-ink/85 [font-stretch:88%]',
    next: 'truncate text-[clamp(13px,1.1vw,18px)] text-muted'
  },
  // its own window: sized off the window height (two lines fit at every size preset),
  // real white with a shadow over game art, whatever the app's appearance
  widget: {
    box: '',
    current:
      'font-display text-[28vh] leading-[1.25] font-semibold text-snow [font-stretch:88%] [text-shadow:0_1px_8px_rgb(0_0_0/0.85)]'
  }
}

export default function Lyrics({ place, className = '' }: { place: LyricsPlace; className?: string }) {
  const shown = useLyricsShown(place)
  const media = useMedia()
  const lines = useLyrics(media, place)
  const index = useLyricIndex(lines, media)
  const style = STYLES[place]
  if (!shown) return null

  const current = media?.active && lines && index >= 0 ? lines[index].text : null
  const next = lines && index >= 0 ? lines.slice(index + 1).find((line) => line.text)?.text : undefined

  return (
    <div aria-live="off" className={`min-w-0 ${style.align ?? 'text-center'} ${style.box} ${className}`}>
      {current !== null && (
        // keyed: each new line fades up instead of swapping
        <div key={index} className={`animate-fade-up line-clamp-2 ${style.current}`}>
          {current || '♪'}
        </div>
      )}
      {style.next && next && <div className={`mt-1 ${style.next}`}>{next}</div>}
    </div>
  )
}
