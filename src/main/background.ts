import { nativeImage } from 'electron'
import { promises as fs } from 'fs'
import { extname, join } from 'path'
import { artDir, getSettings, publicSettings, setSettings } from './store'
import type { Palette, Settings } from '../shared/types'

// OKLCH, not HSL: equal L looks equally bright across hues, so the accent always
// lands where the magenta does (L 0.75) and black text on it stays readable

const BINS = 72
const BIN_DEG = 360 / BINS

const LINEAR = Array.from({ length: 256 }, (_, i) => {
  const c = i / 255
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
})

function toOklch(r: number, g: number, b: number): [number, number, number] {
  const lr = LINEAR[r]
  const lg = LINEAR[g]
  const lb = LINEAR[b]
  const l = Math.cbrt(0.4122214708 * lr + 0.5363137932 * lg + 0.0514459929 * lb)
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb)
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb)
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  const hue = (Math.atan2(B, A) * 180) / Math.PI
  return [L, Math.hypot(A, B), hue < 0 ? hue + 360 : hue]
}

// unclamped, so the caller can tell if it's out of gamut
function oklchToLinear(L: number, C: number, hue: number): [number, number, number] {
  const h = (hue * Math.PI) / 180
  const a = C * Math.cos(h)
  const b = C * Math.sin(h)
  const l = Math.pow(L + 0.3963377774 * a + 0.2158037573 * b, 3)
  const m = Math.pow(L - 0.1055613458 * a - 0.0638541728 * b, 3)
  const s = Math.pow(L - 0.0894841775 * a - 1.291485548 * b, 3)
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
  ]
}

// out of gamut: give up chroma, never lightness or hue
function toHex(L: number, C: number, hue: number): string {
  let rgb = oklchToLinear(L, C, hue)
  while (C > 0 && rgb.some((v) => v < -0.0005 || v > 1.0005)) {
    C = Math.max(0, C - 0.004)
    rgb = oklchToLinear(L, C, hue)
  }
  return (
    '#' +
    rgb
      .map((v) => {
        const c = Math.min(1, Math.max(0, v))
        const e = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055
        return Math.round(e * 255)
          .toString(16)
          .padStart(2, '0')
      })
      .join('')
  )
}

function binDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % BINS
  return Math.min(d, BINS - d)
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

// mean OKLab L, 0-1. Backdrop.tsx darkens light wallpapers by it
export function measureLightness(file: string): number | undefined {
  const image = nativeImage.createFromPath(file)
  if (image.isEmpty()) return undefined
  const size = image.getSize()
  const scale = Math.min(1, 96 / Math.max(size.width, size.height))
  const pixels = image
    .resize({
      width: Math.max(1, Math.round(size.width * scale)),
      height: Math.max(1, Math.round(size.height * scale)),
      quality: 'good'
    })
    .toBitmap()

  let total = 0
  let counted = 0
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    if (pixels[i + 3] < 128) continue
    total += toOklch(pixels[i + 2], pixels[i + 1], pixels[i])[0]
    counted++
  }
  return counted ? Math.round((total / counted) * 1000) / 1000 : undefined
}

// most vivid hue -> accent, strongest hue >= 45deg away -> ember. weighted by chroma^2
// so a small saturated patch beats a big grey sky. undefined = too grey, keep magenta
export function extractPalette(file: string): Palette | undefined {
  const image = nativeImage.createFromPath(file)
  if (image.isEmpty()) return undefined

  const size = image.getSize()
  const scale = Math.min(1, 96 / Math.max(size.width, size.height))
  const small = image.resize({
    width: Math.max(1, Math.round(size.width * scale)),
    height: Math.max(1, Math.round(size.height * scale)),
    quality: 'good'
  })
  // BGRA
  const pixels = small.toBitmap()

  const weight = new Float64Array(BINS)
  const chroma = new Float64Array(BINS)
  const cos = new Float64Array(BINS)
  const sin = new Float64Array(BINS)
  let counted = 0
  let vivid = 0

  for (let i = 0; i + 3 < pixels.length; i += 4) {
    if (pixels[i + 3] < 128) continue
    counted++
    const [L, C, hue] = toOklch(pixels[i + 2], pixels[i + 1], pixels[i])
    // hue is noise near black/white/grey
    if (C < 0.04 || L < 0.2 || L > 0.95) continue
    if (C >= 0.06) vivid++
    const w = C * C
    const bin = Math.floor(hue / BIN_DEG) % BINS
    const rad = (hue * Math.PI) / 180
    weight[bin] += w
    chroma[bin] += w * C
    cos[bin] += w * Math.cos(rad)
    sin[bin] += w * Math.sin(rad)
  }

  if (!counted || vivid / counted < 0.02) return undefined

  // ~20deg triangle, so a hue split over two bins isn't beaten by a narrow spike
  const smooth = new Float64Array(BINS)
  for (let i = 0; i < BINS; i++) {
    for (let j = -3; j <= 3; j++) smooth[i] += weight[(i + j + BINS) % BINS] * (4 - Math.abs(j))
  }

  const around = (peak: number): { hue: number; chroma: number } => {
    let x = 0
    let y = 0
    let w = 0
    let c = 0
    for (let j = -4; j <= 4; j++) {
      const k = (peak + j + BINS) % BINS
      x += cos[k]
      y += sin[k]
      w += weight[k]
      c += chroma[k]
    }
    const hue = (Math.atan2(y, x) * 180) / Math.PI
    return { hue: hue < 0 ? hue + 360 : hue, chroma: w ? c / w : 0.12 }
  }

  let first = 0
  for (let i = 1; i < BINS; i++) if (smooth[i] > smooth[first]) first = i

  // a local peak, >= 45deg off, not a trace. else ember = accent + 50deg
  let second = -1
  for (let i = 0; i < BINS; i++) {
    if (binDistance(i, first) < 9) continue
    if (smooth[i] < smooth[first] * 0.15) continue
    if (smooth[i] < smooth[(i + BINS - 1) % BINS] || smooth[i] < smooth[(i + 1) % BINS]) continue
    if (second === -1 || smooth[i] > smooth[second]) second = i
  }

  const accent = around(first)
  const ember =
    second === -1 ? { hue: (accent.hue + 50) % 360, chroma: accent.chroma } : around(second)

  // L/C ranges taken from the brand magenta + peach
  const accentC = clamp(accent.chroma * 1.25, 0.12, 0.2)
  const emberC = clamp(ember.chroma * 1.1, 0.09, 0.15)

  return {
    accent: toHex(0.75, accentC, accent.hue),
    accentStrong: toHex(0.69, accentC + 0.01, accent.hue),
    ember: toHex(0.83, emberC, ember.hue),
    tint: toHex(0.89, 0.07, accent.hue)
  }
}

export async function setBackground(source: string): Promise<Settings> {
  const ext = extname(source).toLowerCase() || '.jpg'
  // timestamped to bust the <img> cache
  const filename = `background-${Date.now()}${ext}`
  const target = join(artDir(), filename)
  await fs.mkdir(artDir(), { recursive: true })
  await fs.copyFile(source, target)

  let palette: Palette | undefined
  let lightness: number | undefined
  try {
    palette = extractPalette(target)
    lightness = measureLightness(target)
  } catch (err) {
    console.warn('[background] could not sample colours:', (err as Error).message)
  }

  const previous = getSettings().backgroundImage
  setSettings({
    backgroundImage: filename,
    backgroundPalette: palette,
    backgroundLightness: lightness,
    wallpaper: 'custom'
  })
  if (previous && previous !== filename) await fs.rm(join(artDir(), previous), { force: true })
  return publicSettings()
}

// images picked before lightness existed
export function backfillLightness(): void {
  const { backgroundImage, backgroundLightness } = getSettings()
  if (!backgroundImage || backgroundLightness !== undefined) return
  try {
    const lightness = measureLightness(join(artDir(), backgroundImage))
    if (lightness !== undefined) setSettings({ backgroundLightness: lightness })
  } catch (err) {
    console.warn('[background] could not measure lightness:', (err as Error).message)
  }
}

export async function clearBackground(): Promise<Settings> {
  const { backgroundImage: previous, wallpaper } = getSettings()
  setSettings({
    backgroundImage: undefined,
    backgroundPalette: undefined,
    backgroundLightness: undefined,
    wallpaper: wallpaper === 'custom' ? 'sunset' : wallpaper
  })
  if (previous) await fs.rm(join(artDir(), previous), { force: true })
  return publicSettings()
}
