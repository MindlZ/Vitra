import { useEffect, useRef, type RefObject } from 'react'
import { readPalette } from '../lib/theme'

interface Props {
  className?: string
}

/** Horizon position, as a fraction of the canvas height. */
const HORIZON = 0.68
const BAR = 4
const GAP = 4
/** Per-frame fall-off; rises are instant so beats land. */
const DECAY = 0.88

/** Waits between failed connection attempts: quick at first, then patient. */
const RETRY_MS = [1000, 2000, 4000, 8000, 15000]
/** Let Windows finish switching devices before capturing the new one. */
const DEVICE_SETTLE_MS = 800
/** Silence this long on a live capture makes the watchdog try a fresh one. */
const SILENT_MS = 5000
/** How often the watchdog may reconnect during silence, backing off to the last. */
const WATCHDOG_MS = [15000, 30000, 60000]

/**
 * Asks the main process for Windows loopback audio (see registerAudioCapture)
 * and returns an analyser on it, or null if that isn't available. Only the
 * frequency levels are ever read; the stream isn't played or stored.
 *
 * Loopback captures the output device that was the default when it started,
 * so switching (headset to speakers) can break it three ways, all handled:
 *   - the track ends: reconnect;
 *   - a reconnect fails mid-switch: keep retrying with backoff, never give up;
 *   - the track stays live but hears only the old, now-silent device: a
 *     `devicechange` reconnects at once, and a slow watchdog reconnects after
 *     sustained silence in case Windows didn't announce the change.
 */
/*
 * One capture for every visualiser on screen. The screen saver fades in over
 * Home, so two visualisers can be mounted at once; they share this analyser
 * rather than each opening its own loopback. The last one to leave closes it
 * after a grace period, so a hand-off (Home to the screen saver and back)
 * doesn't reconnect.
 */
const analyser: { current: AnalyserNode | null } = { current: null }
let users = 0
let stopCapture: (() => void) | null = null
let releaseTimer: ReturnType<typeof setTimeout> | undefined
const RELEASE_MS = 3000

function startCapture(): () => void {
  let cancelled = false
  let stream: MediaStream | undefined
  let context: AudioContext | undefined
  let retry: ReturnType<typeof setTimeout> | undefined
  let failures = 0
  // Bumped on every (re)connect, so a slow attempt that loses the race to a
  // newer one throws its stream away instead of overwriting it.
  let generation = 0

  const release = (): void => {
    analyser.current = null
    stream?.getTracks().forEach((track) => track.stop())
    stream = undefined
    void context?.close()
    context = undefined
  }

  const schedule = (ms: number): void => {
    clearTimeout(retry)
    if (!cancelled) retry = setTimeout(() => void connect(), ms)
  }

  const connect = async (): Promise<void> => {
    const attempt = ++generation
    release()
    try {
      const next = await navigator.mediaDevices.getDisplayMedia({
        video: { width: 1, height: 1, frameRate: 1 },
        audio: true
      })
      // Video is only there because the API requires it; stopping it leaves
      // the audio running (checked against live loopback capture).
      next.getVideoTracks().forEach((track) => track.stop())
      const [track] = next.getAudioTracks()
      if (cancelled || attempt !== generation) {
        next.getTracks().forEach((t) => t.stop())
        return
      }
      if (!track) {
        next.getTracks().forEach((t) => t.stop())
        throw new Error('no audio track')
      }
      stream = next
      track.addEventListener('ended', () => {
        if (attempt === generation) schedule(DEVICE_SETTLE_MS)
      })
      context = new AudioContext()
      const node = context.createAnalyser()
      node.fftSize = 2048
      node.smoothingTimeConstant = 0.72
      // Not connected to the destination: that would play the audio twice.
      context.createMediaStreamSource(stream).connect(node)
      analyser.current = node
      failures = 0
    } catch (err) {
      if (cancelled || attempt !== generation) return
      // The visualiser shows its idle swell meanwhile, so this is only a note.
      // A main process started before registerAudioCapture() lands here.
      console.warn('[visualiser] no system audio, retrying:', (err as Error).message)
      schedule(RETRY_MS[Math.min(failures++, RETRY_MS.length - 1)])
    }
  }

  // Windows announces output changes (switching default, plugging a headset
  // in or out) as a device change. Several can arrive in a burst; one
  // reconnect after they settle is enough.
  const onDeviceChange = (): void => schedule(DEVICE_SETTLE_MS)
  navigator.mediaDevices.addEventListener('devicechange', onDeviceChange)

  // Safety net for a switch Windows didn't announce: a live capture that
  // has heard nothing for a while gets replaced. Rate-limited with backoff,
  // so real silence (nothing playing) costs a reconnect a minute at most.
  let heardAt = performance.now()
  let watchdogAt = performance.now()
  let watchdogStep = 0
  let probe = new Uint8Array(0)
  const watchdog = setInterval(() => {
    const node = analyser.current
    if (!node) return
    if (probe.length !== node.frequencyBinCount) probe = new Uint8Array(node.frequencyBinCount)
    node.getByteFrequencyData(probe)
    const now = performance.now()
    if (probe.some((level) => level > 0)) {
      heardAt = now
      watchdogStep = 0
      return
    }
    const wait = WATCHDOG_MS[Math.min(watchdogStep, WATCHDOG_MS.length - 1)]
    if (now - heardAt > SILENT_MS && now - watchdogAt > wait) {
      watchdogAt = now
      watchdogStep++
      void connect()
    }
  }, 1000)

  void connect()

  return () => {
    cancelled = true
    clearTimeout(retry)
    clearInterval(watchdog)
    navigator.mediaDevices.removeEventListener('devicechange', onDeviceChange)
    release()
  }
}

function useSystemAudio(): RefObject<AnalyserNode | null> {
  useEffect(() => {
    users++
    clearTimeout(releaseTimer)
    stopCapture ??= startCapture()
    return () => {
      users--
      if (users > 0) return
      releaseTimer = setTimeout(() => {
        if (users > 0) return
        stopCapture?.()
        stopCapture = null
      }, RELEASE_MS)
    }
  }, [])

  return analyser
}

/**
 * The waterline, live: bars rise from a horizon with the bass at the centre,
 * like the sun's column on the wallpaper's water, and are mirrored below with
 * ripples cut through the reflection. With nothing playing it settles into a
 * slow swell rather than a dead line.
 */
export default function Visualiser({ className = '' }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const analyser = useSystemAudio()

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let width = 0
    let height = 0
    let levels = new Float32Array(0)
    let bins = new Uint8Array(0)
    let frame = 0
    let tick = 0

    const resize = (): void => {
      const dpr = window.devicePixelRatio || 1
      width = canvas.clientWidth
      height = canvas.clientHeight
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      levels = new Float32Array(Math.ceil(width / (BAR + GAP) / 2))
    }
    const observer = new ResizeObserver(resize)
    observer.observe(canvas)
    resize()

    // Canvas can't see CSS variables; re-read them when the palette changes.
    let colours = readPalette(canvas)
    const onPalette = (): void => {
      colours = readPalette(canvas)
    }
    window.addEventListener('vitra:palette', onPalette)

    const draw = (time: number): void => {
      frame = requestAnimationFrame(draw)
      const node = analyser.current
      // Idle, the swell only needs half the frame rate.
      if (!node && tick++ % 2) return

      const half = levels.length
      if (node) {
        if (bins.length !== node.frequencyBinCount) bins = new Uint8Array(node.frequencyBinCount)
        node.getByteFrequencyData(bins)
      }

      // Log-spaced bands from ~40 Hz to ~14 kHz, bass at the centre.
      const lo = 2
      const hi = Math.min(bins.length || 1024, 660)
      let loud = 0
      for (let i = 0; i < half; i++) {
        let target = 0
        if (node) {
          const a = Math.floor(lo * Math.pow(hi / lo, i / half))
          const b = Math.max(a + 1, Math.floor(lo * Math.pow(hi / lo, (i + 1) / half)))
          let sum = 0
          for (let k = a; k < b; k++) sum += bins[k]
          // Treble reads quieter than it sounds; lift it a little.
          target = Math.pow(sum / (b - a) / 255, 1.5) * (1 + (i / half) * 0.6)
          loud = Math.max(loud, target)
        }
        levels[i] = Math.max(target, levels[i] * DECAY)
      }

      const swell = loud < 0.02 && !reduceMotion
      const horizon = Math.round(height * HORIZON)
      const maxBar = horizon - 6
      const cx = width / 2

      ctx.clearRect(0, 0, width, height)

      const sky = ctx.createLinearGradient(0, horizon - maxBar, 0, horizon)
      sky.addColorStop(0, colours.peak)
      sky.addColorStop(0.55, colours.mid)
      sky.addColorStop(1, `rgb(${colours.accent})`)

      for (let pass = 0; pass < 2; pass++) {
        const reflect = pass === 1
        ctx.fillStyle = reflect ? `rgb(${colours.accent})` : sky
        for (let i = 0; i < half; i++) {
          let v = Math.min(1, levels[i])
          if (swell) v = Math.max(v, 0.035 + 0.03 * Math.sin(time / 700 + i * 0.32))
          const h = Math.max(2, v * maxBar)
          // Brightest in the middle, fading toward the edges like the sun's glint.
          ctx.globalAlpha = (1 - (i / half) * 0.7) * (reflect ? 0.3 : 1)
          const offset = i * (BAR + GAP) + GAP / 2
          for (const x of [cx + offset, cx - offset - BAR]) {
            if (reflect) ctx.fillRect(x, horizon + 2, BAR, h * 0.55)
            else {
              ctx.beginPath()
              ctx.roundRect(x, horizon - h, BAR, h, [2, 2, 0, 0])
              ctx.fill()
            }
          }
        }
      }
      ctx.globalAlpha = 1

      // Ripples: bands cut out of the reflection, widening with distance.
      ctx.globalCompositeOperation = 'destination-out'
      for (let y = horizon + 4, gap = 2; y < height; y += gap + 1.5, gap += 0.6) {
        ctx.fillRect(0, y, width, 1.5)
      }
      ctx.globalCompositeOperation = 'source-over'

      const line = ctx.createLinearGradient(0, 0, width, 0)
      line.addColorStop(0, `rgb(${colours.tint} / 0)`)
      line.addColorStop(0.5, colours.line)
      line.addColorStop(1, `rgb(${colours.tint} / 0)`)
      ctx.fillStyle = line
      ctx.fillRect(0, horizon, width, 1)
    }
    frame = requestAnimationFrame(draw)

    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener('vitra:palette', onPalette)
    }
  }, [analyser])

  return <canvas ref={canvasRef} aria-hidden className={`block w-full ${className}`} />
}
