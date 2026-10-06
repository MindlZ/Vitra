import type { Appearance, Palette } from '@shared/types'

// cached in localStorage so first paint is already the right colour

const STORAGE_KEY = 'vitra.palette'
export function triple(hex: string): string {
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
    // storage off
  }
  window.dispatchEvent(new Event('vitra:palette'))
}

const APPEARANCE_KEY = 'vitra.appearance'

export function applyAppearance(appearance: Appearance): void {
  document.documentElement.dataset.appearance = appearance
  try {
    localStorage.setItem(APPEARANCE_KEY, appearance)
  } catch {
    // storage off
  }
  window.dispatchEvent(new Event('vitra:palette'))
}

export function restorePalette(): void {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) applyPalette(JSON.parse(saved) as Palette)
    const appearance = localStorage.getItem(APPEARANCE_KEY)
    if (appearance === 'light' || appearance === 'dark') {
      document.documentElement.dataset.appearance = appearance
    }
  } catch {
    // corrupt, stylesheet colours stand
  }
}

// pass the canvas's own element: a dark subtree in a light app resolves differently
export function readPalette(el: Element = document.documentElement): {
  accent: string
  tint: string
  peak: string
  mid: string
  line: string
  // the bars' foot; the screen saver gives it alpha so they fade downwards
  bottom: string
} {
  const css = getComputedStyle(el)
  const accent = css.getPropertyValue('--accent-rgb').trim() || '255 110 203'
  const tint = css.getPropertyValue('--accent-tint-rgb').trim() || '255 190 232'
  return {
    accent,
    tint,
    peak: css.getPropertyValue('--vis-peak').trim() || '#fff1fa',
    mid: css.getPropertyValue('--vis-mid').trim() || `rgb(${tint})`,
    line: css.getPropertyValue('--vis-line').trim() || 'rgba(255,255,255,0.75)',
    bottom: css.getPropertyValue('--vis-bottom').trim() || `rgb(${accent})`
  }
}
