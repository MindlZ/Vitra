import { useCallback, useEffect, useRef, useState } from 'react'
import logo from '../assets/vitra-logo.png'
import { playStartup } from '../lib/sound'

interface Props {
  /** True once the library has loaded; the splash won't leave before this. */
  ready: boolean
  onDone: () => void
}

/** Long enough for the sun to clear the horizon and the mark to light. */
const MIN_MS = 2250
/** Never hold the app hostage to a slow first read. */
const MAX_MS = 5000
/** Matches the .vitra-splash transition. */
const LEAVE_MS = 560

/** The longest the sunrise will wait for its sound before going without it. */
const SOUND_WAIT_MS = 900

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * Resolves once the window is actually on screen. Electron creates it hidden
 * and shows it on ready-to-show, and the renderer is often running before
 * that: starting the sound or the sunrise earlier plays them to nobody.
 */
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

/*
 * Once per app start, shared across StrictMode's double mount: both mounts
 * await the same playback rather than the second one playing it again.
 * Resolves when sound is actually coming out (or it failed, or was absent).
 */
let startup: Promise<void> | undefined
function startStartupSound(): Promise<void> {
  startup ??= whenVisible().then(() => playStartup(0.45))
  return startup
}

/**
 * Sunrise over the waterline, shown once per start. It doubles as the loading
 * state: it stays until the library is read (or MAX_MS), so the grid appears
 * already populated. Any click or key skips it.
 */
export default function Splash({ ready, onDone }: Props) {
  const [leaving, setLeaving] = useState(false)
  const [minElapsed, setMinElapsed] = useState(false)
  // The sunrise holds on its first frame until the sound starts, so the two
  // always begin on the same beat however long the file took to load.
  const [started, setStarted] = useState(false)
  const done = useRef(onDone)
  done.current = onDone

  const leave = useCallback(() => setLeaving(true), [])

  useEffect(() => {
    // Sound isn't motion, so it plays even when the sunrise is skipped.
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
    // The wait for sound only counts once there's a window to see.
    void whenVisible().then(() => {
      if (!cancelled) fallback = setTimeout(begin, SOUND_WAIT_MS)
    })
    void startStartupSound().finally(begin)
    return () => {
      cancelled = true
      clearTimeout(fallback)
    }
  }, [])

  // The minimum and maximum run from when the sunrise actually starts.
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
      // The sunrise is always the dark one, whatever the app's appearance.
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
