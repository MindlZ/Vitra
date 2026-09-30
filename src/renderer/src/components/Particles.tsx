import { useEffect, useRef } from 'react'
import type { Appearance } from '@shared/types'
import { readPalette } from '../lib/theme'

// 30fps on purpose: every glass surface's backdrop-filter re-samples this canvas

interface Mote {
  x: number
  y: number
  r: number
  // px/s
  speed: number
  sway: number
  swayRate: number
  phase: number
  alpha: number
  twinkle: number
}

const FRAME_MS = 1000 / 30
// px² per mote
const AREA_PER_MOTE = 26000
const MAX_MOTES = 80

function makeMote(width: number, height: number, anywhere: boolean): Mote {
  const big = Math.random() < 0.12
  const r = big ? 6 + Math.random() * 8 : 1.2 + Math.random() * 2.6
  return {
    x: Math.random() * width,
    y: anywhere ? Math.random() * height : height + r * 2,
    r,
    // big = out-of-focus foreground: slower, fainter
    speed: big ? 4 + Math.random() * 6 : 8 + Math.random() * 16,
    sway: 6 + Math.random() * 22,
    swayRate: 0.05 + Math.random() * 0.15,
    phase: Math.random() * Math.PI * 2,
    alpha: big ? 0.08 + Math.random() * 0.1 : 0.25 + Math.random() * 0.45,
    twinkle: 0.3 + Math.random() * 0.9
  }
}

// pre-rendered once, drawn scaled: no gradient per mote per frame
function makeSprite(rgb: string): HTMLCanvasElement {
  const size = 64
  const sprite = document.createElement('canvas')
  sprite.width = sprite.height = size
  const ctx = sprite.getContext('2d')!
  const [r, g, b] = rgb.split(/\s+/).map(Number)
  const glow = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  glow.addColorStop(0, `rgba(255, 255, 255, 1)`)
  glow.addColorStop(0.18, `rgba(${r}, ${g}, ${b}, 0.9)`)
  glow.addColorStop(0.5, `rgba(${r}, ${g}, ${b}, 0.25)`)
  glow.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`)
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, size, size)
  return sprite
}

export default function Particles({ appearance }: { appearance: Appearance }) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    // the tint vanishes into the light theme's wash
    const spriteFor = (): HTMLCanvasElement => {
      const { accent, tint } = readPalette(canvas)
      return makeSprite(appearance === 'light' ? accent : tint)
    }
    let sprite = spriteFor()
    let motes: Mote[] = []
    let width = 0
    let height = 0

    const resize = (): void => {
      const dpr = window.devicePixelRatio || 1
      width = canvas.clientWidth
      height = canvas.clientHeight
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      const count = Math.min(MAX_MOTES, Math.round((width * height) / AREA_PER_MOTE))
      motes = motes.slice(0, count)
      while (motes.length < count) motes.push(makeMote(width, height, true))
    }

    const draw = (time: number): void => {
      ctx.clearRect(0, 0, width, height)
      const t = time / 1000
      for (const m of motes) {
        const x = m.x + Math.sin(t * m.swayRate * Math.PI * 2 + m.phase) * m.sway
        const breathe = 0.55 + 0.45 * Math.sin(t * m.twinkle + m.phase)
        ctx.globalAlpha = m.alpha * breathe
        const d = m.r * 2
        ctx.drawImage(sprite, x - m.r, m.y - m.r, d, d)
      }
      ctx.globalAlpha = 1
    }

    let frame = 0
    let last = 0
    const tick = (time: number): void => {
      frame = requestAnimationFrame(tick)
      if (time - last < FRAME_MS) return
      // capped: rAF pauses while hidden, don't jump on return
      const dt = Math.min(0.1, (time - last) / 1000)
      last = time
      for (let i = 0; i < motes.length; i++) {
        const m = motes[i]
        m.y -= m.speed * dt
        if (m.y < -m.r * 2) motes[i] = makeMote(width, height, false)
      }
      draw(time)
    }

    resize()
    if (still) draw(0)
    else frame = requestAnimationFrame(tick)

    const onResize = (): void => {
      resize()
      if (still) draw(0)
    }
    const onPalette = (): void => {
      sprite = spriteFor()
      if (still) draw(0)
    }
    window.addEventListener('resize', onResize)
    window.addEventListener('vitra:palette', onPalette)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('vitra:palette', onPalette)
    }
  }, [appearance])

  return <canvas ref={ref} className="vitra-backdrop__particles" />
}
