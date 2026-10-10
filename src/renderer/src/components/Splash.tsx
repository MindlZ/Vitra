import { useCallback, useEffect, useRef, useState } from 'react'
import LogoDraw from './LogoDraw'
import { playStartup } from '../lib/sound'

interface Props {
  ready: boolean
  onDone: () => void
}

// the line draws, the water fills, then the sun rises behind it: ~5s from the
// beat, timed to startup.mp3. the sun's delay in .vitra-splash__sun follows these
const MIN_MS = 5400
const MAX_MS = 8000
const LOGO_DELAY_MS = 300
const LOGO_DRAW_MS = 2600
const LOGO_FILL_MS = 1400
// matches the .vitra-splash transition
const LEAVE_MS = 560

const SOUND_WAIT_MS = 900

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

// the window starts hidden until ready-to-show; anything started before that plays to nobody
function whenVisible(): Promise<void> {
  if (document.visibilityState === 'visible') return Promise.resolve()
  return new Promise((resolve) => {
    const check = (): void => {
      if (document.visibilityState !== 'visible') return
      document.removeEventListener('visibilitychange', check)
      resolve()
    }
    document.addEventListener('visibilitychange', check)
  })
}

// module-level so StrictMode's double mount doesn't play it twice
let startup: Promise<void> | undefined
function startStartupSound(): Promise<void> {
  startup ??= whenVisible().then(() => playStartup(0.45))
  return startup
}

// the sun and the drawn V; mounted on the beat so the drawing starts with the sound
function Scene({ started }: { started: boolean }) {
  return (
    <>
      <div className="vitra-splash__sun" />
      {started && (
        <div className="vitra-splash__mark">
          <LogoDraw size={150} delay={LOGO_DELAY_MS} drawMs={LOGO_DRAW_MS} fillMs={LOGO_FILL_MS} />
        </div>
      )}
    </>
  )
}

export default function Splash({ ready, onDone }: Props) {
  const [leaving, setLeaving] = useState(false)
  const [minElapsed, setMinElapsed] = useState(false)
  // held on frame one until the sound starts, so they always begin together
  const [started, setStarted] = useState(false)
  const done = useRef(onDone)
  done.current = onDone

  const leave = useCallback(() => setLeaving(true), [])

  useEffect(() => {
    // sound isn't motion: still plays under reduced motion
    if (prefersReducedMotion()) {
      void startStartupSound()
      done.current()
      return
    }
    let cancelled = false
    let fallback: ReturnType<typeof setTimeout> | undefined
    const begin = (): void => {
      if (!cancelled) setStarted(true)
    }
    void whenVisible().then(() => {
      if (!cancelled) fallback = setTimeout(begin, SOUND_WAIT_MS)
    })
    void startStartupSound().finally(begin)
    return () => {
      cancelled = true
      clearTimeout(fallback)
    }
  }, [])

  // timed from the real start, not mount
  useEffect(() => {
    if (!started) return
    const min = setTimeout(() => setMinElapsed(true), MIN_MS)
    const max = setTimeout(leave, MAX_MS)
    return () => {
      clearTimeout(min)
      clearTimeout(max)
    }
  }, [started, leave])

  useEffect(() => {
    if (ready && minElapsed) leave()
  }, [ready, minElapsed, leave])

  useEffect(() => {
    if (!leaving) return
    const timer = setTimeout(() => done.current(), LEAVE_MS)
    return () => clearTimeout(timer)
  }, [leaving])

  useEffect(() => {
    window.addEventListener('keydown', leave)
    return () => window.removeEventListener('keydown', leave)
  }, [leave])

  return (
    <div
      aria-hidden
      onPointerDown={leave}
      data-appearance="dark"
      className={`vitra-splash ${started ? 'is-started' : ''} ${leaving ? 'is-leaving' : ''}`}
    >
      <div className="vitra-splash__drag" />
      <div className="vitra-splash__glow" />
      <div className="vitra-splash__sky">
        <Scene started={started} />
      </div>
      {/* a second copy, flipped and bent by the ripple filter: water, not a mirror */}
      <div className="vitra-splash__reflection">
        <div className="vitra-splash__mirror">
          <Scene started={started} />
        </div>
      </div>
      <div className="vitra-horizon vitra-splash__horizon" />
      <svg aria-hidden width="0" height="0" className="absolute">
        <filter id="vitra-splash-ripple" x="-5%" y="-5%" width="110%" height="110%">
          {/* wide, flat noise: the reflection bends sideways in bands, like swell */}
          <feTurbulence type="fractalNoise" baseFrequency="0.004 0.055" numOctaves="2" seed="7">
            <animate
              attributeName="baseFrequency"
              values="0.004 0.055;0.0046 0.064;0.004 0.055"
              dur="6s"
              repeatCount="indefinite"
            />
          </feTurbulence>
          <feDisplacementMap in="SourceGraphic" scale="26" xChannelSelector="R" yChannelSelector="G" />
          {/* a little scatter, mostly vertical */}
          <feGaussianBlur stdDeviation="0.8 2.2" />
        </filter>
      </svg>
    </div>
  )
}
