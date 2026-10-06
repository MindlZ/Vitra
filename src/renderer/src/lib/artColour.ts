// the screen saver visualiser's colours: the album art's *average* colour (what the
// blurred backdrop shows, so grey art gives grey bars), kept quiet on purpose: a step
// lighter than the backdrop, there but not drawing the eye (user's call, twice)

export interface ArtColours {
  // "r g b", like --accent-rgb
  accent: string
  tint: string
  peak: string
  line: string
}

// OKLCH lightness; the backdrop sits around 0.2-0.3 under the veil
const BARS_L = 0.42
const TINT_L = 0.5
const PEAK_L = 0.6
// no floor: grey stays grey
const CHROMA_MAX = 0.1

const SAMPLE = 32

const toLinear = (c: number): number => {
  const v = c / 255
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
}
const fromLinear = (v: number): number => {
  const c = v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055
  return Math.round(Math.min(1, Math.max(0, c)) * 255)
}

function toOklab(r: number, g: number, b: number): [number, number, number] {
  const lr = toLinear(r)
  const lg = toLinear(g)
  const lb = toLinear(b)
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb)
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb)
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  ]
}

function linearFromOklch(L: number, C: number, h: number): [number, number, number] {
  const a = C * Math.cos(h)
  const b = C * Math.sin(h)
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
  ]
}

// chroma comes down until it fits sRGB, so the hue holds instead of clipping
function oklchToRgb(L: number, C: number, h: number): string {
  for (let c = C; c >= 0; c -= 0.005) {
    const rgb = linearFromOklch(L, c, h)
    if (rgb.every((v) => v >= -0.0005 && v <= 1.0005)) return rgb.map(fromLinear).join(' ')
  }
  return linearFromOklch(L, 0, h).map(fromLinear).join(' ')
}

function load(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = reject
    image.src = src
  })
}

export async function artColours(src: string): Promise<ArtColours | null> {
  const image = await load(src)
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = SAMPLE
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.drawImage(image, 0, 0, SAMPLE, SAMPLE)
  const px = ctx.getImageData(0, 0, SAMPLE, SAMPLE).data

  // mean in OKLab, so opposite hues cancel the way they do when blurred together
  let a = 0
  let b = 0
  let count = 0
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] < 128) continue
    const [, pa, pb] = toOklab(px[i], px[i + 1], px[i + 2])
    a += pa
    b += pb
    count++
  }
  if (!count) return null
  return quiet(Math.atan2(b, a), Math.hypot(a / count, b / count))
}

function quiet(hue: number, chroma: number): ArtColours {
  const c = Math.min(CHROMA_MAX, chroma)
  const tint = oklchToRgb(TINT_L, c * 0.8, hue)
  return {
    accent: oklchToRgb(BARS_L, c, hue),
    tint,
    peak: oklchToRgb(PEAK_L, c * 0.6, hue),
    line: `rgb(${tint} / 0.35)`
  }
}

// no art: the saver's own backdrop colour, at the same quiet levels ("r g b")
export function quietFrom(rgb: string): ArtColours {
  const [r, g, b] = rgb.split(/\s+/).map(Number)
  const [, a, bb] = toOklab(r, g, b)
  return quiet(Math.atan2(bb, a), Math.hypot(a, bb))
}
