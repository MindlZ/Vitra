import { useEffect, useId, useRef } from 'react'
import { readPalette } from '../lib/theme'

// one rAF loop drives stroke, tip and sparks so they can't drift apart

export const DRAW_MS = 1700
export const FILL_MS = 900
const SHEEN_MS = 850

// back to front. the middle one runs backwards: that's what makes it read as
// water rather than a scrolling pattern. units: the 512 box
const WAVES = [
  { amp: 15, length: 260, speed: 1.3, rise: -34, phase: 0.8 },
  { amp: 11, length: 180, speed: -1.9, rise: -17, phase: 2.1 },
  { amp: 16, length: 320, speed: 1.0, rise: 0, phase: 0 }
]
// ~2/3 full: filled to the brim, the crests shrank to a sliver
const WATER_TOP = 150
const WATER_BOTTOM = 540
const WAVE_FLOOR = 560

function wavePath(level: number, wave: (typeof WAVES)[number], seconds: number): string {
  const k = (Math.PI * 2) / wave.length
  const shift = wave.phase + seconds * wave.speed
  const top = level + wave.rise
  let d = `M -20 ${WAVE_FLOOR}`
  for (let x = -20; x <= 532; x += 12) {
    d += ` L ${x} ${(top + Math.sin(x * k + shift) * wave.amp).toFixed(1)}`
  }
  return `${d} L 532 ${WAVE_FLOOR} Z`
}

// [x, y, rounding], clockwise from the point. measured off vitra-logo.png's alpha (512 box)
const CORNERS: Array<[number, number, number]> = [
  [256, 501, 10],
  [10, 10, 24],
  [173, 10, 12],
  [256, 205, 6],
  [339, 10, 12],
  [502, 10, 24]
]

function roundedPath(corners: Array<[number, number, number]>): string {
  const n = corners.length
  const toward = (from: [number, number, number], to: [number, number, number], r: number): string => {
    const dx = to[0] - from[0]
    const dy = to[1] - from[1]
    const length = Math.hypot(dx, dy)
    return `${(from[0] + (dx / length) * r).toFixed(2)} ${(from[1] + (dy / length) * r).toFixed(2)}`
  }
  const parts: string[] = []
  for (let i = 0; i <= n; i++) {
    const corner = corners[i % n]
    const before = toward(corner, corners[(i - 1 + n) % n], corner[2])
    const after = toward(corner, corners[(i + 1) % n], corner[2])
    if (i === 0) parts.push(`M ${after}`)
    else parts.push(`L ${before} Q ${corner[0]} ${corner[1]} ${after}`)
  }
  return `${parts.join(' ')} Z`
}

const OUTLINE = roundedPath(CORNERS)
const VIEW = 512

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  max: number
  size: number
  white: boolean
}

function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2
}

// drawMs/fillMs: the splash plays it slower than big picture's curtain
export default function LogoDraw({
  size = 168,
  delay = 0,
  drawMs = DRAW_MS,
  fillMs = FILL_MS
}: {
  size?: number
  delay?: number
  drawMs?: number
  fillMs?: number
}) {
  const id = useId().replace(/:/g, '')
  const stroke = useRef<SVGPathElement>(null)
  const fill = useRef<SVGGElement>(null)
  const sheen = useRef<SVGRectElement>(null)
  const waves = useRef<Array<SVGPathElement | null>>([])
  const tip = useRef<SVGGElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const path = stroke.current
    const fillGroup = fill.current
    const sheenRect = sheen.current
    const tipGroup = tip.current
    const cv = canvas.current
    const ctx = cv?.getContext('2d')
    if (!path || !fillGroup || !sheenRect || !tipGroup || !cv || !ctx) return

    const total = path.getTotalLength()
    path.style.strokeDasharray = `${total} ${total}`
    path.style.strokeDashoffset = String(total)
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const setWater = (level: number, seconds: number): void => {
      waves.current.forEach((el, i) => el?.setAttribute('d', wavePath(level, WAVES[i], seconds)))
    }
    setWater(WATER_BOTTOM, 0)
    if (still) {
      path.style.strokeDashoffset = '0'
      fillGroup.style.opacity = '1'
      setWater(WATER_TOP, 0)
      tipGroup.style.opacity = '0'
      return
    }

    // bigger than the logo so sparks can fly clear of it
    const pad = size * 0.35
    const dpr = window.devicePixelRatio || 1
    const box = size + pad * 2
    cv.width = Math.round(box * dpr)
    cv.height = Math.round(box * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const scale = size / VIEW
    const { accent, tint } = readPalette(cv)

    const particles: Particle[] = []
    let frame = 0
    let last = performance.now()
    const start = last + delay

    // performance.now(), not rAF's timestamp: same clock as `start`
    // (headless renders froze on the rAF one)
    const loop = (): void => {
      const now = performance.now()
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      const elapsed = now - start
      if (elapsed < 0) {
        frame = requestAnimationFrame(loop)
        return
      }
      const t = Math.min(1, elapsed / drawMs)
      const drawn = easeInOut(t) * total

      path.style.strokeDashoffset = String(total - drawn)
      const point = path.getPointAtLength(drawn)
      tipGroup.setAttribute('transform', `translate(${point.x} ${point.y})`)
      tipGroup.style.opacity = t < 1 ? '1' : String(Math.max(0, 1 - (elapsed - drawMs) / 250))

      const f = Math.min(1, Math.max(0, (elapsed - drawMs) / fillMs))
      fillGroup.style.opacity = String(Math.min(1, f * 3))
      const level = WATER_BOTTOM - (1 - (1 - f) ** 3) * (WATER_BOTTOM - WATER_TOP)
      if (f > 0) setWater(level, elapsed / 1000)
      const s = (elapsed - drawMs - fillMs * 0.4) / SHEEN_MS
      sheenRect.setAttribute('x', String(-260 + Math.min(1, Math.max(0, s)) * 900))
      sheenRect.style.opacity = s > 0 && s < 1 ? '1' : '0'

      if (t < 1) {
        const x = pad + point.x * scale
        const y = pad + point.y * scale
        for (let i = 0; i < 3; i++) {
          const angle = Math.random() * Math.PI * 2
          const speed = 12 + Math.random() * 38
          particles.push({
            x,
            y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed - 8,
            life: 0,
            max: 0.45 + Math.random() * 0.5,
            size: 0.8 + Math.random() * 1.6,
            white: Math.random() < 0.35
          })
        }
      }

      ctx.clearRect(0, 0, box, box)
      ctx.globalCompositeOperation = 'lighter'
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i]
        p.life += dt
        if (p.life >= p.max) {
          particles.splice(i, 1)
          continue
        }
        p.vx *= 0.96
        p.vy = p.vy * 0.96 + 14 * dt
        p.x += p.vx * dt
        p.y += p.vy * dt
        const fade = 1 - p.life / p.max
        ctx.fillStyle = p.white ? `rgb(255 255 255 / ${fade})` : `rgb(${tint} / ${fade})`
        ctx.shadowColor = `rgb(${accent} / ${fade})`
        ctx.shadowBlur = 6
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.size * fade + 0.3, 0, Math.PI * 2)
        ctx.fill()
      }

      // until unmount: the water keeps moving while the curtain's up
      frame = requestAnimationFrame(loop)
    }
    frame = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(frame)
  }, [size, delay, drawMs, fillMs])

  const pad = size * 0.35
  return (
    <div className="relative" style={{ width: size, height: size }} aria-hidden>
      <svg viewBox={`-20 -20 ${VIEW + 40} ${VIEW + 40}`} className="absolute -inset-[4%] overflow-visible">
        <defs>
          <linearGradient id={`${id}-line`} x1="0" y1="1" x2="1" y2="0">
            <stop offset="0" style={{ stopColor: 'var(--color-accent)' }} />
            <stop offset="0.55" style={{ stopColor: 'rgb(var(--accent-tint-rgb))' }} />
            <stop offset="1" style={{ stopColor: 'var(--color-accent)' }} />
          </linearGradient>
          <linearGradient id={`${id}-wave0`} gradientUnits="userSpaceOnUse" x1="0" y1="40" x2="0" y2="501">
            <stop offset="0" style={{ stopColor: 'rgb(var(--accent-tint-rgb))', stopOpacity: 0.3 }} />
            <stop offset="1" style={{ stopColor: 'rgb(var(--accent-tint-rgb))', stopOpacity: 0.1 }} />
          </linearGradient>
          <linearGradient id={`${id}-wave1`} gradientUnits="userSpaceOnUse" x1="0" y1="50" x2="0" y2="501">
            <stop offset="0" style={{ stopColor: 'var(--color-accent)', stopOpacity: 0.32 }} />
            <stop offset="1" style={{ stopColor: 'rgb(var(--accent-tint-rgb))', stopOpacity: 0.08 }} />
          </linearGradient>
          <linearGradient id={`${id}-wave2`} gradientUnits="userSpaceOnUse" x1="0" y1="60" x2="0" y2="501">
            <stop offset="0" style={{ stopColor: 'var(--color-accent)', stopOpacity: 0.55 }} />
            <stop offset="0.6" style={{ stopColor: 'var(--color-accent)', stopOpacity: 0.28 }} />
            <stop offset="1" style={{ stopColor: 'var(--color-accent)', stopOpacity: 0.1 }} />
          </linearGradient>
          <linearGradient id={`${id}-sheen`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#fff" stopOpacity={0} />
            <stop offset="0.5" stopColor="#fff" stopOpacity={0.32} />
            <stop offset="1" stopColor="#fff" stopOpacity={0} />
          </linearGradient>
          <clipPath id={`${id}-shape`}>
            <path d={OUTLINE} />
          </clipPath>
          <filter id={`${id}-soft`} x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="14" />
          </filter>
          <radialGradient id={`${id}-tip`}>
            <stop offset="0" stopColor="#fff" />
            <stop offset="0.35" style={{ stopColor: 'rgb(var(--accent-tint-rgb))' }} />
            <stop offset="1" style={{ stopColor: 'var(--color-accent)', stopOpacity: 0 }} />
          </radialGradient>
        </defs>
        <g ref={fill} clipPath={`url(#${id}-shape)`} style={{ opacity: 0 }}>
          <g>
            {WAVES.map((_, i) => (
              <path
                key={i}
                ref={(el) => {
                  waves.current[i] = el
                }}
                fill={`url(#${id}-wave${i})`}
                // only the crest shows: the stroked sides/floor fall outside the clip
                strokeWidth={i === WAVES.length - 1 ? 2.5 : 0}
                style={{ stroke: 'rgb(var(--accent-tint-rgb) / 0.7)' }}
              />
            ))}
            <path
              d={OUTLINE}
              fill="none"
              strokeWidth={46}
              filter={`url(#${id}-soft)`}
              style={{ stroke: 'var(--color-accent)', opacity: 0.45 }}
            />
            <rect
              ref={sheen}
              y={-40}
              width={170}
              height={VIEW + 80}
              fill={`url(#${id}-sheen)`}
              transform="skewX(-18)"
              style={{ opacity: 0 }}
            />
          </g>
        </g>
        <path
          ref={stroke}
          d={OUTLINE}
          fill="none"
          stroke={`url(#${id}-line)`}
          strokeWidth={9}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="vitra-logo-line"
          // hidden until the effect measures the real length
          style={{ strokeDasharray: 4000, strokeDashoffset: 4000 }}
        />
        <g ref={tip} style={{ opacity: 0 }}>
          <circle r={34} fill={`url(#${id}-tip)`} />
          <circle r={7} fill="#fff" />
        </g>
      </svg>
      <canvas
        ref={canvas}
        className="pointer-events-none absolute"
        style={{ left: -pad, top: -pad, width: size + pad * 2, height: size + pad * 2 }}
      />
    </div>
  )
}
