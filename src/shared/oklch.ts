import type { Palette } from './types'

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
function fit(L: number, C: number, hue: number): { C: number; rgb: [number, number, number] } {
  let rgb = oklchToLinear(L, C, hue)
  while (C > 0 && rgb.some((v) => v < -0.0005 || v > 1.0005)) {
    C = Math.max(0, C - 0.004)
    rgb = oklchToLinear(L, C, hue)
  }
  return { C, rgb }
}

export function toHex(L: number, C: number, hue: number): string {
  const { rgb } = fit(L, C, hue)
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

// black text on the accent needs luminance >= 0.2 for 5:1
const MIN_LUMINANCE = 0.2

// L 0.75 like a sampled palette, but lowered where a hue only gets vivid darker
// (red's cusp is L 0.63, blue's 0.45), never past MIN_LUMINANCE. at a flat 0.75
// the reds topped out at salmon
function accentLightness(chroma: number, hue: number): number {
  let best = { L: 0.75, C: fit(0.75, chroma, hue).C }
  for (let L = 0.74; L >= 0.5; L -= 0.01) {
    const { C, rgb } = fit(L, chroma, hue)
    const [r, g, b] = rgb.map((v) => Math.min(1, Math.max(0, v)))
    if (0.2126 * r + 0.7152 * g + 0.0722 * b < MIN_LUMINANCE) break
    // only for a real gain, so near-greys keep the usual lightness
    if (C > best.C + 0.004) best = { L, C }
  }
  return best.L
}

// a picked accent. ember sits 50deg on, as when an image has no second hue
export function paletteFromHue(hue: number, chroma: number): Palette {
  const L = accentLightness(chroma, hue)
  return {
    accent: toHex(L, chroma, hue),
    accentStrong: toHex(L - 0.06, chroma && chroma + 0.01, hue),
    ember: toHex(0.83, Math.min(0.15, chroma * 0.75), (hue + 50) % 360),
    tint: toHex(0.89, Math.min(0.07, chroma * 0.5), hue)
  }
}
