import { useEffect, useRef, type RefObject } from 'react'
import { pace } from '../lib/pace'
import { readPalette } from '../lib/theme'

interface Props {
  className?: string
}

const HORIZON = 0.68
const BAR = 4
const GAP = 4
// per 60fps frame; rises are instant so beats land
const DECAY = 0.88
// capped: rAF runs at the monitor's rate (144Hz+) otherwise. idle swell needs less
const FRAME_MS = 1000 / 60
const IDLE_FRAME_MS = 1000 / 30
const SLOW_FRAME_MS = 1000 / 20
// peaks, in bar heights /s and /s². the bar throws its dot at a share of its own speed
const GRAVITY = 5
const KICK = 0.12
const MAX_KICK = 1.4
const DOT_GAP = 3
const GLOW_BLUR = 12

// set by App; read every frame so a toggle lands without a remount
const look = { peaks: true, glow: true }
export function setVisualiserLook(next: { peaks: boolean; glow: boolean }): void {
  look.peaks = next.peaks
  look.glow = next.glow
}

const RETRY_MS = [1000, 2000, 4000, 8000, 15000]
const DEVICE_SETTLE_MS = 800
const SILENT_MS = 5000
const WATCHDOG_MS = [15000, 30000, 60000]

// loopback sticks to the device it started on. switching outputs can:
// end the track (reconnect), fail mid-switch (retry forever with backoff), or
// keep a live track that hears only the old device (devicechange + silence watchdog)

// one capture shared by every visualiser (the saver fades in over Home, so two can
// be mounted). released after a grace period so a hand-off doesn't reconnect
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
  // a slow attempt that loses the race throws its stream away
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
      // video is required by the API; stopping it keeps audio running (verified)
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
      // not to destination: that would play the audio twice
      context.createMediaStreamSource(stream).connect(node)
      analyser.current = node
      failures = 0
    } catch (err) {
      if (cancelled || attempt !== generation) return
      console.warn('[visualiser] no system audio, retrying:', (err as Error).message)
      schedule(RETRY_MS[Math.min(failures++, RETRY_MS.length - 1)])
    }
  }

  // arrives in bursts; one reconnect once they settle
  const onDeviceChange = (): void => schedule(DEVICE_SETTLE_MS)
  navigator.mediaDevices.addEventListener('devicechange', onDeviceChange)

  // for switches Windows doesn't announce. backed off: real silence costs <= 1 reconnect/min
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

// hidden = minimised, in the tray or covered by a game: no capture until it's back
function syncCapture(): void {
  if (users > 0 && document.visibilityState === 'visible') {
    clearTimeout(releaseTimer)
    releaseTimer = undefined
    stopCapture ??= startCapture()
  } else if (stopCapture && releaseTimer === undefined) {
    releaseTimer = setTimeout(() => {
      releaseTimer = undefined
      stopCapture?.()
      stopCapture = null
    }, RELEASE_MS)
  }
}
document.addEventListener('visibilitychange', syncCapture)

function useSystemAudio(): RefObject<AnalyserNode | null> {
  useEffect(() => {
    users++
    syncCapture()
    return () => {
      users--
      syncCapture()
    }
  }, [])

  return analyser
}

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
    // what was drawn last frame, so a peak knows how fast its bar rose
    let shown = new Float32Array(0)
    let peaks = new Float32Array(0)
    let speeds = new Float32Array(0)
    let bins = new Uint8Array(0)
    let frame = 0
    let last = 0

    const resize = (): void => {
      const dpr = window.devicePixelRatio || 1
      width = canvas.clientWidth
      height = canvas.clientHeight
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      const half = Math.ceil(width / (BAR + GAP) / 2)
      levels = new Float32Array(half)
      shown = new Float32Array(half)
      peaks = new Float32Array(half)
      speeds = new Float32Array(half)
      paintsFor = -1
    }

    let colours = readPalette(canvas)
    // built once per size/palette, not per frame
    let sky: CanvasGradient | undefined
    let fade: CanvasGradient | undefined
    let line: CanvasGradient | undefined
    let glowColour = ''
    let paintsFor = -1
    const buildPaints = (horizon: number, maxBar: number): void => {
      sky = ctx.createLinearGradient(0, horizon - maxBar, 0, horizon)
      sky.addColorStop(0, colours.peak)
      sky.addColorStop(0.55, colours.mid)
      sky.addColorStop(1, `rgb(${colours.accent})`)
      // the edge fade, as one destination-in pass instead of an alpha per bar
      fade = ctx.createLinearGradient(0, 0, width, 0)
      fade.addColorStop(0, 'rgba(0, 0, 0, 0.3)')
      fade.addColorStop(0.5, 'rgba(0, 0, 0, 1)')
      fade.addColorStop(1, 'rgba(0, 0, 0, 0.3)')
      line = ctx.createLinearGradient(0, 0, width, 0)
      line.addColorStop(0, `rgb(${colours.tint} / 0)`)
      line.addColorStop(0.5, colours.line)
      line.addColorStop(1, `rgb(${colours.tint} / 0)`)
      glowColour = `rgb(${colours.accent} / 0.6)`
      paintsFor = maxBar
    }

    const observer = new ResizeObserver(resize)
    observer.observe(canvas)
    resize()

    const onPalette = (): void => {
      colours = readPalette(canvas)
      paintsFor = -1
    }
    window.addEventListener('vitra:palette', onPalette)

    const draw = (time: number): void => {
      frame = requestAnimationFrame(draw)
      const node = analyser.current
      const speed = pace()
      if (speed === 'paused') return
      const frameMs = speed === 'slow' ? SLOW_FRAME_MS : node ? FRAME_MS : IDLE_FRAME_MS
      // a little slack: rAF timestamps jitter, and a strict cap halves the rate
      if (time - last < frameMs - 2) return
      // capped: rAF pauses while hidden, don't jump on return
      const dt = Math.min(0.1, (time - last) / 1000)
      last = time
      const decay = Math.pow(DECAY, dt * 60)

      const half = levels.length
      if (node) {
        if (bins.length !== node.frequencyBinCount) bins = new Uint8Array(node.frequencyBinCount)
        node.getByteFrequencyData(bins)
      }

      // log bands ~40Hz-14kHz, bass in the middle
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
          // treble reads quieter than it sounds
          target = Math.pow(sum / (b - a) / 255, 1.5) * (1 + (i / half) * 0.6)
          loud = Math.max(loud, target)
        }
        levels[i] = Math.max(target, levels[i] * decay)
      }

      const swell = loud < 0.02 && !reduceMotion
      for (let i = 0; i < half; i++) {
        let v = Math.min(1, levels[i])
        if (swell) v = Math.max(v, 0.035 + 0.03 * Math.sin(time / 700 + i * 0.32))
        if (v >= peaks[i]) {
          speeds[i] = Math.max(speeds[i], Math.min(MAX_KICK, ((v - shown[i]) / dt) * KICK))
        }
        shown[i] = v
        speeds[i] -= GRAVITY * dt
        peaks[i] += speeds[i] * dt
        if (peaks[i] <= v) {
          peaks[i] = v
          if (speeds[i] < 0) speeds[i] = 0
        } else if (peaks[i] >= 1) {
          peaks[i] = 1
          if (speeds[i] > 0) speeds[i] = 0
        }
      }

      const { peaks: withPeaks, glow } = look
      const dot = BAR / 2
      const horizon = Math.round(height * HORIZON)
      // headroom for a dot on a full bar
      const maxBar = horizon - (withPeaks ? 6 + DOT_GAP + BAR : 6)
      if (maxBar !== paintsFor) buildPaints(horizon, maxBar)
      const cx = width / 2

      ctx.clearRect(0, 0, width, height)

      // one path, one fill: the glow is a single blur, not one per bar
      ctx.beginPath()
      for (let i = 0; i < half; i++) {
        const h = Math.max(2, shown[i] * maxBar)
        const offset = i * (BAR + GAP) + GAP / 2
        ctx.roundRect(cx + offset, horizon - h, BAR, h, [2, 2, 0, 0])
        ctx.roundRect(cx - offset - BAR, horizon - h, BAR, h, [2, 2, 0, 0])
      }
      ctx.fillStyle = sky!
      if (glow) {
        ctx.shadowColor = glowColour
        ctx.shadowBlur = GLOW_BLUR
      }
      ctx.fill()

      if (withPeaks) {
        ctx.beginPath()
        for (let i = 0; i < half; i++) {
          const y = horizon - Math.max(2, peaks[i] * maxBar) - DOT_GAP - dot
          const offset = i * (BAR + GAP) + GAP / 2
          ctx.moveTo(cx + offset + BAR, y)
          ctx.arc(cx + offset + dot, y, dot, 0, Math.PI * 2)
          ctx.moveTo(cx - offset, y)
          ctx.arc(cx - offset - dot, y, dot, 0, Math.PI * 2)
        }
        ctx.fillStyle = colours.peak
        ctx.fill()
      }
      ctx.shadowBlur = 0

      ctx.globalAlpha = 0.3
      ctx.beginPath()
      for (let i = 0; i < half; i++) {
        const h = Math.max(2, shown[i] * maxBar)
        const offset = i * (BAR + GAP) + GAP / 2
        ctx.rect(cx + offset, horizon + 2, BAR, h * 0.55)
        ctx.rect(cx - offset - BAR, horizon + 2, BAR, h * 0.55)
        if (withPeaks) {
          const y = horizon + 2 + (Math.max(2, peaks[i] * maxBar) + DOT_GAP + dot) * 0.55
          ctx.rect(cx + offset, y - 1, BAR, 2)
          ctx.rect(cx - offset - BAR, y - 1, BAR, 2)
        }
      }
      ctx.fillStyle = `rgb(${colours.accent})`
      ctx.fill()
      ctx.globalAlpha = 1

      ctx.globalCompositeOperation = 'destination-in'
      ctx.fillStyle = fade!
      ctx.fillRect(0, 0, width, height)

      // ripples cut out of the reflection
      ctx.globalCompositeOperation = 'destination-out'
      for (let y = horizon + 4, gap = 2; y < height; y += gap + 1.5, gap += 0.6) {
        ctx.fillRect(0, y, width, 1.5)
      }
      ctx.globalCompositeOperation = 'source-over'

      ctx.fillStyle = line!
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
