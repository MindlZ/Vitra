import { useState, type CSSProperties } from 'react'
import type { Appearance } from '@shared/types'

interface Props {
  /** 0–100 from settings. Higher hides more of the wallpaper. */
  dim: number
  /** The wallpaper to show (see activeWallpaper). */
  src: string
  /** A bundled wallpaper, if src (a custom image) fails to load. */
  fallback: string
  /** The wallpaper's mean lightness, 0-1, when known. */
  lightness?: number
  fallbackLightness?: number
  /** Light keeps the wallpaper light (the veil is a pale wash then). */
  appearance: Appearance
}

/*
 * Light wallpapers are darkened before the veil, so text keeps its contrast
 * whatever the image. The veil and its dim were tuned on a mid-dark
 * wallpaper (lightness ~0.72); a mostly-white one came through light grey
 * and the tab text vanished. Anything lighter than TARGET is brought down to
 * it. Lightness is ~ the cube root of luminance, hence the cube: measured,
 * it puts a near-white image (0.95, brightness 0.4) at the old wallpaper's
 * level behind the tabs.
 */
const TARGET_LIGHTNESS = 0.7

/**
 * The veil never drops below this: at 0 nothing stands between the wallpaper
 * and the text, and a dark patch behind dark text (or a light one behind
 * light) can't be read. Settings' Dim slider starts here too.
 */
export const MIN_DIM = 30

function brightnessFor(lightness: number | undefined): number {
  if (!lightness || lightness <= TARGET_LIGHTNESS) return 1
  return Math.round((TARGET_LIGHTNESS / lightness) ** 3 * 100) / 100
}

/**
 * The frosted-glass substrate: wallpaper, a veil that pulls it down to a usable
 * dark, and grain. Sits at z-0 with the app at z-10, so every `glass` surface
 * above it has something real to sample through backdrop-filter.
 *
 * The image is an <img> rather than a CSS background for two reasons: the URL
 * comes from a JS import, so the bundler always resolves it, and a failure is
 * observable instead of silently looking identical to a veil that's too strong.
 * A custom image that fails falls back to the bundled one.
 */
export default function Backdrop({
  dim,
  src: wanted,
  fallback,
  lightness,
  fallbackLightness,
  appearance
}: Props) {
  const [failed, setFailed] = useState<string | null>(null)
  const src = failed === wanted ? fallback : wanted
  // Dark UI: darken light wallpapers (light text). Light UI: the reverse, lift
  // the dark areas so dark text never lands on them; contrast 0.45 then
  // brightness 1.22 maps black to ~0.34 and white to ~0.88, before the wash.
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
      <div className="vitra-backdrop__grain" />
    </div>
  )
}
