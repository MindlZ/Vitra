import { useState, type CSSProperties } from 'react'
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

function brightnessFor(lightness: number | undefined): number {
  if (!lightness || lightness <= TARGET_LIGHTNESS) return 1
  return Math.round((TARGET_LIGHTNESS / lightness) ** 3 * 100) / 100
}

// <img>, not a CSS background: a load failure is observable (onError) instead of
// looking exactly like a too-strong veil
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
  // light UI lifts the darks instead: black -> ~0.34, white -> ~0.88
  const tone =
    appearance === 'light'
      ? { '--wallpaper-contrast': 0.45, '--wallpaper-brightness': 1.22 }
      : { '--wallpaper-brightness': brightnessFor(failed === wanted ? fallbackLightness : lightness) }

  return (
    <div aria-hidden className="vitra-backdrop">
      {failed !== src && (
        <img
          key={src}
          src={src}
          alt=""
          draggable={false}
          className="vitra-backdrop__image"
          style={tone as CSSProperties}
          onError={() => {
            console.error('[backdrop] wallpaper failed to load from', src)
            setFailed(src)
          }}
        />
      )}
      <div
        className="vitra-backdrop__veil"
        style={{ opacity: Math.min(100, Math.max(MIN_DIM, dim)) / 100 }}
      />
      {particles && <Particles appearance={appearance} />}
      <div className="vitra-backdrop__grain" />
    </div>
  )
}
