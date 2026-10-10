import type { Appearance, DesktopScreen, Palette, Settings, WallpaperPreset } from '@shared/types'
import vigil from '../assets/wallpapers/vigil.jpg'
import hex from '../assets/wallpapers/hex.jpg'
import gate from '../assets/wallpapers/gate.jpg'
import aurora from '../assets/wallpapers/aurora.jpg'
import { artUrl } from './art'

// files are pre-softened (96px wide, scaled back up); full-size sources aren't kept.
// palette + lightness were computed by main's extractPalette / measureLightness on
// the full-size sources: resample if an image ever changes

export interface Preset {
  id: WallpaperPreset
  name: string
  src: string
  palette: Palette
  lightness: number
}

export const PRESETS: Preset[] = [
  // the default. its palette is the brand crimson, paletteFromHue(15, 0.23), not
  // extractPalette's: that caps L/C and gave a pale salmon (#ff8385) on this image
  {
    id: 'vigil',
    name: 'Vigil',
    src: vigil,
    lightness: 0.241,
    palette: { accent: '#ff3963', accentStrong: '#ec0050', ember: '#feb66e', tint: '#ffccce' }
  },
  {
    id: 'hex',
    name: 'Hex',
    src: hex,
    lightness: 0.198,
    palette: { accent: '#d48fe8', accentStrong: '#c37ad7', ember: '#fdaebb', tint: '#efcdf9' }
  },
  {
    id: 'gate',
    name: 'Gate',
    src: gate,
    lightness: 0.221,
    palette: { accent: '#61c593', accentStrong: '#41b47f', ember: '#7cd8e7', tint: '#b3eacb' }
  },
  {
    id: 'aurora',
    name: 'Aurora',
    src: aurora,
    lightness: 0.204,
    palette: { accent: '#80aefd', accentStrong: '#699af1', ember: '#dfb2fe', tint: '#c9dcfd' }
  }
]

export function presetFor(id: string | undefined): Preset {
  return PRESETS.find((preset) => preset.id === id) ?? PRESETS[0]
}

export interface ActiveWallpaper {
  src: string
  fallback: string
  palette?: Palette
  lightness?: number
  fallbackLightness: number
}

// for your own image or the desktop; the presets are all dark (0.2-0.25)
const LIGHT_FROM = 0.8

export function appearanceFor(settings: Settings, wallpaper: ActiveWallpaper): Appearance {
  if (settings.theme === 'light' || settings.theme === 'dark') return settings.theme
  return (wallpaper.lightness ?? 0) >= LIGHT_FROM ? 'light' : 'dark'
}

// the chosen screen's copy; first screen if that one's gone (unplugged)
export function desktopShot(settings: Settings): DesktopScreen | undefined {
  const screens = settings.desktopScreens ?? []
  return screens[settings.desktopScreen] ?? screens[0]
}

// the one place that decides image + palette
export function activeWallpaper(settings: Settings): ActiveWallpaper {
  const preset = presetFor(settings.wallpaper)
  if (settings.wallpaper === 'custom' && settings.backgroundImage) {
    return {
      // the bake draws at 640 wide; no need to decode a 4k original
      src: artUrl(settings.backgroundImage, 1280),
      fallback: preset.src,
      palette: settings.backgroundPalette,
      lightness: settings.backgroundLightness,
      fallbackLightness: preset.lightness
    }
  }
  const shot = desktopShot(settings)
  if (settings.wallpaper === 'desktop' && shot) {
    return {
      src: artUrl(shot.image, 1280),
      fallback: preset.src,
      palette: shot.palette,
      lightness: shot.lightness,
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
