import type { Appearance, Palette, Settings, WallpaperPreset } from '@shared/types'
import sunset from '../assets/wallpapers/sunset.jpg'
import smoke from '../assets/wallpapers/smoke.jpg'
import tree from '../assets/wallpapers/tree.jpg'
import moon from '../assets/wallpapers/moon.jpg'
import { artUrl } from './art'

/*
 * The bundled wallpapers. Each file ships pre-softened (shrunk to 96px wide
 * and scaled back up, ~50 KB): the backdrop blurs it anyway. The full-size
 * sources aren't kept in the project; replacing one means preparing a new
 * file the same way and resampling its palette and lightness.
 * Two dark (sunset, moon) and two light (smoke, tree), so Auto shows off both.
 *
 * Palettes are what main's sampler (background.ts, extractPalette) returns
 * for each full-size source, precomputed because bundled images are never
 * picked, so never sampled. Resample if an image changes.
 */

export interface Preset {
  id: WallpaperPreset
  name: string
  src: string
  palette: Palette
  /** Mean lightness of the source, 0-1 (main's measureLightness). */
  lightness: number
}

export const PRESETS: Preset[] = [
  {
    // The default: the logo's sunset, and dark on Auto.
    id: 'sunset',
    name: 'Sunset',
    src: sunset,
    lightness: 0.577,
    palette: { accent: '#ff8482', accentStrong: '#f96265', ember: '#feb858', tint: '#fdcdcb' }
  },
  {
    id: 'smoke',
    name: 'Smoke',
    src: smoke,
    lightness: 0.949,
    palette: { accent: '#ff894f', accentStrong: '#f86a07', ember: '#e5c640', tint: '#ffcfb9' }
  },
  {
    id: 'moon',
    name: 'Moon',
    src: moon,
    // Dark on Auto, like sunset.
    lightness: 0.237,
    palette: { accent: '#4cbcea', accentStrong: '#1fa9db', ember: '#bbc2fd', tint: '#aee4fe' }
  },
  {
    id: 'tree',
    name: 'Tree',
    src: tree,
    lightness: 0.9,
    palette: { accent: '#fe867a', accentStrong: '#fe5d53', ember: '#fdb944', tint: '#fdcec8' }
  }
]

export function presetFor(id: string | undefined): Preset {
  return PRESETS.find((preset) => preset.id === id) ?? PRESETS[0]
}

export interface ActiveWallpaper {
  src: string
  /** A bundled wallpaper, if a custom src fails to load. */
  fallback: string
  palette?: Palette
  lightness?: number
  fallbackLightness: number
}

/**
 * Light wallpapers get the light appearance on Auto. 0.8 sits between the
 * old palm sunset (0.72, dark) and the bundled presets (0.89 and up); a
 * custom image not yet measured stays dark.
 */
const LIGHT_FROM = 0.8

export function appearanceFor(settings: Settings, wallpaper: ActiveWallpaper): Appearance {
  if (settings.theme === 'light' || settings.theme === 'dark') return settings.theme
  return (wallpaper.lightness ?? 0) >= LIGHT_FROM ? 'light' : 'dark'
}

/** What's on screen: the custom image when chosen (and still there), else a preset. */
export function activeWallpaper(settings: Settings): ActiveWallpaper {
  const preset = presetFor(settings.wallpaper)
  if (settings.wallpaper === 'custom' && settings.backgroundImage) {
    return {
      src: artUrl(settings.backgroundImage),
      fallback: preset.src,
      palette: settings.backgroundPalette,
      lightness: settings.backgroundLightness,
      fallbackLightness: preset.lightness
    }
  }
  return {
    src: preset.src,
    fallback: preset.src,
    palette: preset.palette,
    lightness: preset.lightness,
    fallbackLightness: preset.lightness
  }
}
