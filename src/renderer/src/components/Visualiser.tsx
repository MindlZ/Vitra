import { useEffect, useRef, type CSSProperties, type RefObject } from 'react'
import { ambientAnalyser } from '../lib/ambient'
import { useMedia } from '../lib/media'
import { pace } from '../lib/pace'
import { readPalette } from '../lib/theme'

interface Props {
  className?: string
  // colour overrides (--accent-rgb, --vis-*); readPalette reads them off the canvas
  style?: CSSProperties
  // overrides the glow setting for this one
  glow?: boolean
}

const HORIZON = 0.68
const BAR = 4
const GAP = 4
// per 60fps frame; big rises are instant so beats land
const DECAY = 0.88
// rises smaller than this ease in (share per 60fps frame): quiet, steady sound
// (the ambience) flickers in the narrow treble bands and the bars twitched
const JUMP = 0.12
const EASE = 0.22
// auto level: the loudest bar is steered towards PEAK_TARGET, so loud audio no
// longer pins every bar to the top. quiet audio is lifted, at most MAX_BOOST
const PEAK_TARGET = 0.8
const AGC_FLOOR = 0.22
const MAX_BOOST = 3
// share of the level it gives back per second once things get quieter
const AGC_RELEASE = 0.35
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
// bars share a gradient per height band: every bar gets tip-to-base shading at
// its own height, for BANDS fills a frame instead of one per bar
const BANDS = 12
// the glow is drawn off-canvas and only its shadow lands: a solid glow shape
// showed through the bars' faded bases
const SHADOW_SHIFT = 10000
// the reflection is copied under the line in strips this tall (css px), each
// nudged sideways by moving waves and sampled from a jittered row: water, like
// the splash's, for ~25 drawImage calls a frame instead of an svg filter
const STRIP = 2

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
// system audio is only listened to while a player reports Playing: game sounds and
// notifications on their own don't move the bars
let mediaPlaying = false
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
  if (users > 0 && mediaPlaying && document.visibilityState === 'visible') {
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
  const playing = useMedia()?.status === 'Playing'
  useEffect(() => {
    users++
    syncCapture()
    return () => {
      users--
      syncCapture()
    }
  }, [])

  useEffect(() => {
    mediaPlaying = playing
    syncCapture()
  }, [playing])

  return analyser
}

export default function Visualiser({ className = '', style, glow: glowOverride }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // a ref: the draw loop is set up once and reads this every frame
  const glowRef = useRef(glowOverride)
  glowRef.current = glowOverride
  const analyser = useSystemAudio()

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let width = 0
    let height = 0
    let levels = new Float32Array(0)
    let targets = new Float32Array(0)
    let envelope = 0
    // what was drawn last frame, so a peak knows how fast its bar rose
    let shown = new Float32Array(0)
    let peaks = new Float32Array(0)
    let speeds = new Float32Array(0)
    let bins = new Uint8Array(0)
    let frame = 0
    let last = 0

    const mirror = document.createElement('canvas')
    const mirrorCtx = mirror.getContext('2d')
    const resize = (): void => {
      const dpr = window.devicePixelRatio || 1
      width = canvas.clientWidth
      height = canvas.clientHeight
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      mirror.width = canvas.width
      mirror.height = canvas.height
      mirrorCtx?.setTransform(dpr, 0, 0, dpr, 0, 0)
      const half = Math.ceil(width / (BAR + GAP) / 2)
      levels = new Float32Array(half)
      shown = new Float32Array(half)
      peaks = new Float32Array(half)
      speeds = new Float32Array(half)
      paintsFor = -1
    }

    let colours = readPalette(canvas)
    // built once per size/palette, not per frame
    let bands: CanvasGradient[] = []
    let fade: CanvasGradient | undefined
    let line: CanvasGradient | undefined
    let glowColour = ''
    // white over the accent reads as a glassy edge in both themes
    const highlight = 'rgba(255, 255, 255, 0.3)'
    let paintsFor = -1
    const buildPaints = (horizon: number, maxBar: number): void => {
      // bright tip, tint, accent, then fading into the horizon line. short bands
      // start at the tint: a white tip on every small bar read as noise
      bands = Array.from({ length: BANDS }, (_, k) => {
        const tall = (k + 1) / BANDS
        const paint = ctx.createLinearGradient(0, horizon - maxBar * tall, 0, horizon)
        paint.addColorStop(0, tall > 0.3 ? colours.peak : colours.mid)
        paint.addColorStop(0.14, colours.mid)
        paint.addColorStop(0.5, colours.bottom)
        paint.addColorStop(1, `rgb(${colours.accent} / 0.12)`)
        return paint
      })
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
      // music when a player is playing, else Vitra's own ambience straight from the engine
      const node = mediaPlaying ? analyser.current : ambientAnalyser.current
      const speed = pace()
      if (speed === 'paused') return
      const frameMs = speed === 'slow' ? SLOW_FRAME_MS : node ? FRAME_MS : IDLE_FRAME_MS
      // a little slack: rAF timestamps jitter, and a strict cap halves the rate
      if (time - last < frameMs - 2) return
      // capped: rAF pauses while hidden, don't jump on return
      const dt = Math.min(0.1, (time - last) / 1000)
      last = time
      const decay = Math.pow(DECAY, dt * 60)
      const ease = 1 - Math.pow(1 - EASE, dt * 60)

      const half = levels.length
      if (node) {
        if (bins.length !== node.frequencyBinCount) bins = new Uint8Array(node.frequencyBinCount)
        node.getByteFrequencyData(bins)
      }

      // log bands ~40Hz-14kHz, bass in the middle
      const lo = 2
      const hi = Math.min(bins.length || 1024, 660)
      let loud = 0
      if (targets.length !== half) targets = new Float32Array(half)
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
        targets[i] = target
      }
      envelope =
        loud > envelope
          ? envelope + (loud - envelope) * Math.min(1, dt * 12)
          : envelope * Math.pow(1 - AGC_RELEASE, dt)
      const level = Math.min(MAX_BOOST, PEAK_TARGET / Math.max(envelope, AGC_FLOOR))
      for (let i = 0; i < half; i++) targets[i] *= level
      for (let i = 0; i < half; i++) {
        // a little of each neighbour: one band can't spike on its own
        const target =
          targets[i] * 0.5 + (targets[Math.max(0, i - 1)] + targets[Math.min(half - 1, i + 1)]) * 0.25
        const rise = target - levels[i]
        if (rise > JUMP) levels[i] = target
        else if (rise > 0) levels[i] += rise * ease
        else levels[i] = Math.max(target, levels[i] * decay)
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

      const withPeaks = look.peaks
      const glow = glowRef.current ?? look.glow
      const dot = BAR / 2
      const horizon = Math.round(height * HORIZON)
      // headroom for a dot on a full bar
      const maxBar = horizon - (withPeaks ? 6 + DOT_GAP + BAR : 6)
      if (maxBar !== paintsFor) buildPaints(horizon, maxBar)
      const cx = width / 2

      ctx.clearRect(0, 0, width, height)

      // one path, one blur for the glow, not one per bar
      if (glow) {
        const dpr = window.devicePixelRatio || 1
        ctx.translate(-SHADOW_SHIFT, 0)
        ctx.beginPath()
        for (let i = 0; i < half; i++) {
          const h = Math.max(2, shown[i] * maxBar)
          const offset = i * (BAR + GAP) + GAP / 2
          ctx.rect(cx + offset, horizon - h, BAR, h)
          ctx.rect(cx - offset - BAR, horizon - h, BAR, h)
        }
        ctx.fillStyle = glowColour
        ctx.shadowColor = glowColour
        ctx.shadowBlur = GLOW_BLUR
        // offsets are in device pixels, unlike the path
        ctx.shadowOffsetX = SHADOW_SHIFT * dpr
        ctx.fill()
        ctx.translate(SHADOW_SHIFT, 0)
        ctx.shadowOffsetX = 0
        ctx.shadowBlur = 0
      }

      for (let band = 0; band < BANDS; band++) {
        ctx.beginPath()
        let any = false
        for (let i = 0; i < half; i++) {
          const h = Math.max(2, shown[i] * maxBar)
          if (Math.min(BANDS - 1, Math.floor((h / maxBar) * BANDS)) !== band) continue
          any = true
          const offset = i * (BAR + GAP) + GAP / 2
          ctx.roundRect(cx + offset, horizon - h, BAR, h, [2, 2, 0, 0])
          ctx.roundRect(cx - offset - BAR, horizon - h, BAR, h, [2, 2, 0, 0])
        }
        if (!any) continue
        ctx.fillStyle = bands[band]
        ctx.fill()
      }

      // light catching one edge, down the upper part of each bar
      ctx.beginPath()
      for (let i = 0; i < half; i++) {
        const h = shown[i] * maxBar
        if (h < 8) continue
        const offset = i * (BAR + GAP) + GAP / 2
        ctx.rect(cx + offset + 1, horizon - h + 2, 1, h * 0.55)
        ctx.rect(cx - offset - BAR + 1, horizon - h + 2, 1, h * 0.55)
      }
      ctx.fillStyle = highlight
      ctx.fill()

      if (glow) {
        ctx.shadowColor = glowColour
        ctx.shadowBlur = GLOW_BLUR
      }

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

      const top = horizon + 2
      if (mirrorCtx) {
        mirrorCtx.clearRect(0, 0, width, height)
        mirrorCtx.beginPath()
        for (let i = 0; i < half; i++) {
          const h = Math.max(2, shown[i] * maxBar)
          const offset = i * (BAR + GAP) + GAP / 2
          mirrorCtx.rect(cx + offset, top, BAR, h * 0.55)
          mirrorCtx.rect(cx - offset - BAR, top, BAR, h * 0.55)
          if (withPeaks) {
            const y = top + (Math.max(2, peaks[i] * maxBar) + DOT_GAP + dot) * 0.55
            mirrorCtx.rect(cx + offset, y - 1, BAR, 2)
            mirrorCtx.rect(cx - offset - BAR, y - 1, BAR, 2)
          }
        }
        mirrorCtx.fillStyle = `rgb(${colours.accent})`
        mirrorCtx.fill()

        const dpr = canvas.width / width
        const depth = height - top
        const t = reduceMotion ? 0 : time / 1000
        for (let y = 0; y < depth; y += STRIP) {
          const far = y / depth
          // fades as it goes down, like the cut-out ripples used to
          ctx.globalAlpha = 0.32 * (1 - far * 0.85)
          // two waves: a quick close ripple and a slower swell, both growing with depth
          const dx =
            Math.sin(y * 0.16 + t * 2.2) * (0.5 + far * 2.6) + Math.sin(y * 0.05 - t * 1.1) * far * 2
          const from = Math.min(depth - STRIP, Math.max(0, y + Math.sin(y * 0.3 + t * 2.7) * far * 1.4))
          ctx.drawImage(mirror, 0, (top + from) * dpr, mirror.width, STRIP * dpr, dx, top + y, width, STRIP)
        }
        ctx.globalAlpha = 1
      }

      ctx.globalCompositeOperation = 'destination-in'
      ctx.fillStyle = fade!
      ctx.fillRect(0, 0, width, height)
      ctx.globalCompositeOperation = 'source-over'

      ctx.fillStyle = line!
      // a soft band of light where the bars stand, under the crisp line
      ctx.globalAlpha = 0.18
      ctx.fillRect(0, horizon - 2, width, 5)
      ctx.globalAlpha = 1
      ctx.fillRect(0, horizon, width, 1)
    }
    frame = requestAnimationFrame(draw)

    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener('vitra:palette', onPalette)
    }
  }, [analyser])

  return <canvas ref={canvasRef} aria-hidden className={`block w-full ${className}`} style={style} />
}
