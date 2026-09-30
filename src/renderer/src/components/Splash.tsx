import { useCallback, useEffect, useRef, useState } from 'react'
import logo from '../assets/vitra-logo.png'
import { playStartup } from '../lib/sound'

interface Props {
  ready: boolean
  onDone: () => void
}

const MIN_MS = 2250
const MAX_MS = 5000
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
        <div className="vitra-splash__sun" />
        <img src={logo} alt="" draggable={false} className="vitra-splash__mark" />
      </div>
      <div className="vitra-water vitra-splash__water" />
      <div className="vitra-horizon vitra-splash__horizon" />
    </div>
  )
}
