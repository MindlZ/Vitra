import { useEffect, useRef, useState } from 'react'
import type { Appearance } from '@shared/types'
import Particles from './Particles'

interface Props {
  dim: number
  src: string
  fallback: string
  lightness?: number
  fallbackLightness?: number
  appearance: Appearance
  particles: boolean
}

// the veil was tuned on a ~0.72 lightness image; near-white ones came through
// light grey and tab text vanished. cubed because L ~ cbrt(luminance); measured:
// 0.95 -> brightness 0.4 lands at the old image's level behind the tabs
const TARGET_LIGHTNESS = 0.7

// below this, text over a busy patch is unreadable in either theme
export const MIN_DIM = 30

// the old css filter was blur(22px) under scale(1.12), in screen px
const BLUR = 22 * 1.12
// it's blurred to mush anyway; small keeps the bake a few ms
const BAKE_WIDTH = 640
// peak speck alpha. estimated from the old overlay at 5% (which barely moved darks); adjust by eye
const GRAIN_ALPHA = 0.025

function brightnessFor(lightness: number | undefined): number {
  if (!lightness || lightness <= TARGET_LIGHTNESS) return 1
  return Math.round((TARGET_LIGHTNESS / lightness) ** 3 * 100) / 100
}

// filtered once into a canvas. as a css filter on a full-window layer the blur
// re-ran on every frame anything above it changed (particles: 30 a second)
function bake(canvas: HTMLCanvasElement, image: HTMLImageElement, tone: string): void {
  const iw = image.naturalWidth
  const ih = image.naturalHeight
  const ctx = canvas.getContext('2d')
  if (!iw || !ih || !ctx) return
  // object-fit: cover's width on screen
  const shown = iw * Math.max(window.innerWidth / iw, window.innerHeight / ih)
  const width = Math.max(1, Math.min(BAKE_WIDTH, Math.round(shown)))
  const height = Math.max(1, Math.round((width * ih) / iw))
  const sigma = (BLUR * width) / shown
  // drawn past the edges so the blur doesn't pull transparency in (what the scale hid)
  const pad = Math.ceil(sigma * 3)
  const k = Math.max((width + pad * 2) / width, (height + pad * 2) / height)
  canvas.width = width
  canvas.height = height
  ctx.filter = `blur(${sigma}px) saturate(118%) ${tone}`
  ctx.drawImage(image, (width - width * k) / 2, (height - height * k) / 2, width * k, height * k)
}

// light and dark specks at low alpha, blended normally. it was svg noise under
// mix-blend-mode: overlay, a full-window blend pass on every particle frame
let grainUrl: string | undefined
function grain(): string {
  if (grainUrl) return grainUrl
  const size = 200
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''
  const image = ctx.createImageData(size, size)
  const px = image.data
  for (let i = 0; i < px.length; i += 4) {
    const v = Math.random() * 2 - 1
    const shade = v > 0 ? 255 : 0
    px[i] = px[i + 1] = px[i + 2] = shade
    px[i + 3] = Math.round(Math.abs(v) * GRAIN_ALPHA * 255)
  }
  ctx.putImageData(image, 0, 0)
  grainUrl = `url(${canvas.toDataURL()})`
  return grainUrl
}

export default function Backdrop({
  dim,
  src: wanted,
  fallback,
  lightness,
  fallbackLightness,
  appearance,
  particles
}: Props) {
  const [failed, setFailed] = useState<string | null>(null)
  const src = failed === wanted ? fallback : wanted
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // light UI lifts the darks instead: black -> ~0.34, white -> ~0.88
  const tone =
    appearance === 'light'
      ? 'contrast(0.45) brightness(1.22)'
      : `brightness(${brightnessFor(failed === wanted ? fallbackLightness : lightness)})`

  // a load failure stays observable (onerror) instead of looking like a too-strong veil
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const image = new Image()
    let timer: ReturnType<typeof setTimeout> | undefined
    const rebake = (): void => {
      clearTimeout(timer)
      timer = setTimeout(() => bake(canvas, image, tone), 200)
    }
    image.onload = () => {
      bake(canvas, image, tone)
      window.addEventListener('resize', rebake)
    }
    image.onerror = () => {
      console.error('[backdrop] wallpaper failed to load from', src)
      setFailed(src)
    }
    image.src = src
    return () => {
      image.onload = image.onerror = null
      clearTimeout(timer)
      window.removeEventListener('resize', rebake)
    }
  }, [src, tone])

  return (
    <div aria-hidden className="vitra-backdrop">
      {failed !== src && <canvas key={src} ref={canvasRef} className="vitra-backdrop__image" />}
      <div
        className="vitra-backdrop__veil"
        style={{ opacity: Math.min(100, Math.max(MIN_DIM, dim)) / 100 }}
      />
      {particles && <Particles appearance={appearance} />}
      <div className="vitra-backdrop__grain" style={{ backgroundImage: grain() }} />
    </div>
  )
}
