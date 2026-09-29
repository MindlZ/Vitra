import { nativeImage } from 'electron'
import { promises as fs } from 'fs'
import { extname, join } from 'path'
import { artDir, getSettings, publicSettings, setSettings } from './store'
import type { Palette, Settings } from '../shared/types'

/*
 * Custom wallpapers, and the UI colours sampled from them.
 *
 * The picked file is copied into the art cache (so applib://art/ serves it and
 * the original can move or vanish), and its palette is worked out once, here,
 * and saved with it: the renderer applies stored colours at first paint rather
 * than re-deriving them on every launch.
 *
 * Colour work is in OKLCH so every hue comes out equally bright. In HSL a
 * yellow and a blue at the same lightness look nothing alike; here the accent
 * always sits where Vitra's magenta does (L ~0.75), so black text on a primary
 * button and the glow around a card read the same whatever the image is.
 */

/** Hue histogram resolution: 72 bins of 5 degrees. */
const BINS = 72
const BIN_DEG = 360 / BINS

/** sRGB byte -> linear light, once. */
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

/** OKLCH -> linear sRGB, unclamped, so the caller can see if it's in gamut. */
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

/** An OKLCH colour as #rrggbb, giving up chroma (never lightness or hue) to fit sRGB. */
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

/**
 * The image's most vivid hue becomes the accent; the strongest separate hue
 * (at least 45 degrees away) becomes ember. Pixels are weighted by chroma
 * squared, so a small patch of saturated colour beats a large grey-blue sky,
 * which is what "the colour of this picture" usually means to a person.
 *
 * Returns undefined for an image with too little colour to go on (greyscale,
 * near-black) or one nativeImage can't decode; the UI keeps Vitra's magenta.
 */
/**
 * How light the image is on average: mean OKLab lightness, 0 (black) to 1
 * (white). The backdrop darkens light wallpapers by it before the veil, so
 * text keeps its contrast on a mostly-white image (see Backdrop.tsx).
 */
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

export function extractPalette(file: string): Palette | undefined {
  const image = nativeImage.createFromPath(file)
  if (image.isEmpty()) return undefined

  // A thumbnail is plenty for a hue histogram and keeps this instant.
  const size = image.getSize()
  const scale = Math.min(1, 96 / Math.max(size.width, size.height))
  const small = image.resize({
    width: Math.max(1, Math.round(size.width * scale)),
    height: Math.max(1, Math.round(size.height * scale)),
    quality: 'good'
  })
  // BGRA on Windows.
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
    // Near-black and near-white pixels have unreliable hue.
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

  // Smooth around the circle (a ~20 degree triangle) so one hue split across
  // two bins isn't beaten by a narrower spike.
  const smooth = new Float64Array(BINS)
  for (let i = 0; i < BINS; i++) {
    for (let j = -3; j <= 3; j++) smooth[i] += weight[(i + j + BINS) % BINS] * (4 - Math.abs(j))
  }

  /** Weighted mean hue and chroma of the pixels within 20 degrees of a peak. */
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

  // A real second colour: its own local peak, well clear of the first, and
  // not a trace. Otherwise ember is derived, an analogous step round the wheel.
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

  // Lightness and chroma ranges are Vitra's own magenta and peach, so any
  // image lands in the same register: vivid, light enough for black text.
  const accentC = clamp(accent.chroma * 1.25, 0.12, 0.2)
  const emberC = clamp(ember.chroma * 1.1, 0.09, 0.15)

  return {
    accent: toHex(0.75, accentC, accent.hue),
    accentStrong: toHex(0.69, accentC + 0.01, accent.hue),
    ember: toHex(0.83, emberC, ember.hue),
    tint: toHex(0.89, 0.07, accent.hue)
  }
}

/** Copy the picked image into the art cache and make it the wallpaper. */
export async function setBackground(source: string): Promise<Settings> {
  const ext = extname(source).toLowerCase() || '.jpg'
  // Vary the name so the renderer's <img> cache doesn't keep the old picture.
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

/** Images picked before lightness was measured: measure them once, on start. */
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

/** Forget the custom image; if it was showing, back to the default preset. */
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
