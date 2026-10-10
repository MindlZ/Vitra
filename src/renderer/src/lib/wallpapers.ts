import type { Appearance, DesktopScreen, Palette, Settings, WallpaperPreset } from '@shared/types'
import crimson from '../assets/wallpapers/crimson.jpg'
import smoke from '../assets/wallpapers/smoke.jpg'
import tree from '../assets/wallpapers/tree.jpg'
import moon from '../assets/wallpapers/moon.jpg'
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
  // extractPalette's: that caps L/C and gave a pale salmon (#ff857a) on this image
  {
    id: 'crimson',
    name: 'Crimson',
    src: crimson,
    lightness: 0.294,
    palette: { accent: '#ff3963', accentStrong: '#ec0050', ember: '#feb66e', tint: '#ffccce' }
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
  fallback: string
  palette?: Palette
  lightness?: number
  fallbackLightness: number
}

// between the old palm image (0.72, dark) and the light presets (0.89+)
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
