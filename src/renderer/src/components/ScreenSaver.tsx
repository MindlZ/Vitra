import { useEffect, useState } from 'react'
import { useMedia } from '../lib/media'
import { Clock } from './Home'
import Visualiser from './Visualiser'

interface Props {
  /** Fading out: the user is back. */
  leaving: boolean
}

/** How far the composition wanders, and how often, so nothing burns in. */
const DRIFT_PX = 28
const DRIFT_EVERY_MS = 60_000

/**
 * The ambient screen after a spell of inactivity: the clock, what's playing
 * (album art reflected on the waterline, title and artist), and the
 * visualiser along the bottom, over the album art blurred into a glow.
 *
 * It never appears suddenly. App collapses the chrome first (title bar and
 * sidebar slide away, the page fades), then this fades up; waking reverses
 * it. Any input wakes it (lib/idle.ts), and the waking input goes nowhere.
 */
export default function ScreenSaver({ leaving }: Props) {
  const media = useMedia()
  const [shown, setShown] = useState(false)
  const [drift, setDrift] = useState({ x: 0, y: 0 })

  // Mount at opacity 0, then transition up once that's been painted.
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

  return (
    <div
      aria-hidden
      data-state={leaving ? 'leaving' : shown ? 'shown' : 'entering'}
      // A saver stays dark: it may run for hours, and in a dark room.
      data-appearance="dark"
      className="vitra-saver"
    >
      {art && <img src={art} alt="" draggable={false} className="vitra-saver__glow" />}
      <div className="vitra-saver__veil" />

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
                {/* Standing on the waterline, like every cover in Vitra. */}
                <img src={art} alt="" draggable={false} className="vitra-saver__reflection" />
              </div>
            )}
            <div className="max-w-[40vw] min-w-0">
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
            </div>
          </div>
        )}
      </div>

      <Visualiser className="vitra-saver__visualiser" />
    </div>
  )
}
