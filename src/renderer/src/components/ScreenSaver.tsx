import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { artColours, quietFrom, type ArtColours } from '../lib/artColour'
import { useMedia } from '../lib/media'
import { triple } from '../lib/theme'
import { Clock } from './Home'
import Lyrics from './Lyrics'
import Visualiser from './Visualiser'
import Wave from './Wave'

interface Props {
  leaving: boolean
  wave: boolean
}

// burn-in protection
const DRIFT_PX = 28
const DRIFT_EVERY_MS = 60_000

// "r g b" strings; share = how much of a
function mix(a: string, b: string, share: number): string {
  const [ar, ag, ab] = a.split(/s+/).map(Number)
  const [br, bg, bb] = b.split(/s+/).map(Number)
  if (![ar, ag, ab].every(Number.isFinite)) return b
  return [ar * share + br * (1 - share), ag * share + bg * (1 - share), ab * share + bb * (1 - share)]
    .map(Math.round)
    .join(' ')
}

export default function ScreenSaver({ leaving, wave }: Props) {
  const media = useMedia()
  const [shown, setShown] = useState(false)
  const [drift, setDrift] = useState({ x: 0, y: 0 })

  // two frames: the opacity-0 state must paint before the transition starts
  useEffect(() => {
    let second = 0
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setShown(true))
    })
    return () => {
      cancelAnimationFrame(first)
      cancelAnimationFrame(second)
    }
  }, [])

  useEffect(() => {
    const timer = setInterval(() => {
      setDrift({
        x: Math.round((Math.random() * 2 - 1) * DRIFT_PX),
        y: Math.round((Math.random() * 2 - 1) * DRIFT_PX)
      })
    }, DRIFT_EVERY_MS)
    return () => clearInterval(timer)
  }, [])

  const track = media?.active && media.title ? media : null
  const art = track?.art

  const root = useRef<HTMLDivElement>(null)
  const [colours, setColours] = useState<ArtColours | null>(null)
  useEffect(() => {
    // no art: the saver's own backdrop, read inside its dark subtree
    const backdrop = (): ArtColours | null => {
      const base = root.current && getComputedStyle(root.current).getPropertyValue('--color-base').trim()
      return base?.startsWith('#') ? quietFrom(triple(base)) : null
    }
    if (!art) {
      setColours(backdrop())
      return
    }
    let alive = true
    artColours(art)
      .then((next) => alive && setColours(next ?? backdrop()))
      .catch(() => alive && setColours(backdrop()))
    return () => {
      alive = false
    }
  }, [art])

  // the canvas reads its colours on this event, after the new vars are on it
  useEffect(() => {
    window.dispatchEvent(new Event('vitra:palette'))
  }, [colours])

  // the theme accent at the tips, fading into the quiet art colour lower down; the
  // body stays quiet so it doesn't draw the eye
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent-rgb').trim()
  const visualiserColours = colours
    ? ({
        '--accent-rgb': colours.accent,
        '--accent-tint-rgb': colours.tint,
        '--vis-peak': `rgb(${mix(accent, colours.peak, 0.7)})`,
        '--vis-mid': `rgb(${mix(accent, colours.tint, 0.3)} / 0.85)`,
        '--vis-bottom': `rgb(${colours.accent} / 0.55)`,
        '--vis-line': colours.line
      } as CSSProperties)
    : undefined

  return (
    <div
      ref={root}
      aria-hidden
      data-state={leaving ? 'leaving' : shown ? 'shown' : 'entering'}
      data-appearance="dark"
      className="vitra-saver"
    >
      {art && <img src={art} alt="" draggable={false} className="vitra-saver__glow" />}
      <div className="vitra-saver__veil" />
      {wave && <Wave appearance="dark" centre={0.36} />}

      <div
        className="vitra-saver__stage"
        style={{ transform: `translate(${drift.x}px, ${drift.y}px)` }}
      >
        <Clock size="tv" />

        {track && (
          <div className="mt-[6vh] flex items-center gap-[clamp(24px,3vw,56px)]">
            {art && (
              <div className="relative h-[clamp(120px,24vh,300px)] w-[clamp(120px,24vh,300px)] shrink-0">
                <img
                  src={art}
                  alt=""
                  draggable={false}
                  className="h-full w-full rounded-[14px] object-cover shadow-[0_30px_70px_-20px_rgba(0,0,0,0.85)]"
                />
                <img src={art} alt="" draggable={false} className="vitra-saver__reflection" />
              </div>
            )}
            <div className="relative max-w-[40vw] min-w-0">
              <div className="line-clamp-2 font-display text-[clamp(26px,2.8vw,48px)] leading-[1.02] font-bold text-ink [font-stretch:85%]">
                {track.title}
              </div>
              {(track.artist || track.album) && (
                <div className="mt-2 truncate text-[clamp(14px,1.2vw,20px)] text-dim">
                  {[track.artist, track.album].filter(Boolean).join(' · ')}
                </div>
              )}
              {track.status && track.status !== 'Playing' && (
                <div className="mt-3 text-[clamp(12px,0.9vw,15px)] text-muted">{track.status}</div>
              )}
              {/* out of flow: its width changes every line, which re-centred the row and moved the art */}
              <Lyrics place="saver" className="absolute top-full left-0 mt-[3vh] w-[40vw]" />
            </div>
          </div>
        )}
      </div>

      <Visualiser className="vitra-saver__visualiser" style={visualiserColours} glow={false} />
    </div>
  )
}
