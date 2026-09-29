import type { Appearance, Palette } from '@shared/types'

/*
 * Applies a wallpaper's palette (sampled in main/background.ts) over the
 * stylesheet's own colours. Every accent in the UI goes through these
 * variables: the Tailwind theme colours for utilities, and the *-rgb triples
 * for the glows and gradients that need an alpha (`rgb(var(--accent-rgb) / .6)`).
 * With no palette the properties are removed and index.css's magenta returns.
 *
 * The last palette is kept in localStorage so the splash and first paint are
 * already the right colour, rather than flicking once settings arrive.
 */

const STORAGE_KEY = 'vitra.palette'
function triple(hex: string): string {
  const n = parseInt(hex.slice(1), 16)
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`
}

export function applyPalette(palette: Palette | undefined): void {
  const style = document.documentElement.style
  const vars: Record<string, string | undefined> = {
    '--color-accent': palette?.accent,
    '--color-accent-strong': palette?.accentStrong,
    '--color-ember': palette?.ember,
    '--accent-rgb': palette && triple(palette.accent),
    '--accent-tint-rgb': palette && triple(palette.tint)
  }
  for (const [name, value] of Object.entries(vars)) {
    if (value) style.setProperty(name, value)
    else style.removeProperty(name)
  }
  try {
    if (palette) localStorage.setItem(STORAGE_KEY, JSON.stringify(palette))
    else localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Storage off: the colours still apply, just not before settings load.
  }
  window.dispatchEvent(new Event('vitra:palette'))
}

const APPEARANCE_KEY = 'vitra.appearance'

/**
 * Light or dark UI, as data-appearance on <html>; index.css swaps every
 * colour token on it. Cached like the palette, so a light app doesn't open
 * dark and then flip once settings arrive.
 */
export function applyAppearance(appearance: Appearance): void {
  document.documentElement.dataset.appearance = appearance
  try {
    localStorage.setItem(APPEARANCE_KEY, appearance)
  } catch {
    // Storage off: still applied, just not before settings load.
  }
  window.dispatchEvent(new Event('vitra:palette'))
}

/** Called once before the first render. */
export function restorePalette(): void {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) applyPalette(JSON.parse(saved) as Palette)
    const appearance = localStorage.getItem(APPEARANCE_KEY)
    if (appearance === 'light' || appearance === 'dark') {
      document.documentElement.dataset.appearance = appearance
    }
  } catch {
    // Missing or corrupt: the stylesheet's colours stand.
  }
}

/**
 * The current colours as the CSS resolves them, for canvas drawing. Read
 * from the canvas's own element, so a dark subtree (the screen saver) gets
 * dark colours in a light app.
 */
export function readPalette(el: Element = document.documentElement): {
  accent: string
  tint: string
  peak: string
  mid: string
  line: string
} {
  const css = getComputedStyle(el)
  const accent = css.getPropertyValue('--accent-rgb').trim() || '255 110 203'
  const tint = css.getPropertyValue('--accent-tint-rgb').trim() || '255 190 232'
  return {
    accent,
    tint,
    peak: css.getPropertyValue('--vis-peak').trim() || '#fff1fa',
    mid: css.getPropertyValue('--vis-mid').trim() || `rgb(${tint})`,
    line: css.getPropertyValue('--vis-line').trim() || 'rgba(255,255,255,0.75)'
  }
}
