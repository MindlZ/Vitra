import { nativeImage, screen } from 'electron'
import type { NativeImage, Rectangle } from 'electron'
import { existsSync, promises as fs } from 'fs'
import { userInfo } from 'os'
import { dirname, extname, join } from 'path'
import { findSteamPath, readRegistryValue } from './paths'
import { readLibraryFolders } from './scanners/steam'
import { listRunningProcesses } from './watcher'
import { artDir, getSettings, publicSettings, setSettings } from './store'
import { toHex } from '../shared/oklch'
import type { DesktopScreen, Palette, Settings } from '../shared/types'

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

// thumb: shell thumbnail (a video frame, a gif's first frame), else decoded as is.
// span: may be one image across every monitor, sliced per screen if its shape fits
interface DesktopSource {
  path: string
  thumb: boolean
  span?: boolean
}

const WE_EXES = ['wallpaper64.exe', 'wallpaper32.exe']

async function wallpaperEngineProject(file: string): Promise<DesktopSource | undefined> {
  if (!existsSync(file)) return undefined
  const folder = dirname(file)
  let project: { type?: string; preview?: string } = {}
  try {
    project = JSON.parse(await fs.readFile(join(folder, 'project.json'), 'utf8'))
  } catch {
    // no project.json: no preview to find
  }
  // a video's own frame beats the small square preview
  if (project.type?.toLowerCase() === 'video') return { path: file, thumb: true }
  const preview = project.preview ? join(folder, project.preview) : undefined
  if (preview && existsSync(preview)) return { path: preview, thumb: !/\.(jpe?g|png)$/i.test(preview) }
  return undefined
}

// config.json: { <user>: { general: { wallpaperconfig: { selectedwallpapers:
// { Monitor0: { file }, Monitor1: ... } } } } }. file is the project's main file;
// project.json beside it names the preview. WE's numbering isn't Electron's, so
// screens are told apart by their thumbnails in Settings
async function wallpaperEngineSources(): Promise<DesktopSource[]> {
  const steam = await findSteamPath(getSettings().steamPath)
  if (!steam) return []
  let config: string | undefined
  for (const root of await readLibraryFolders(steam)) {
    const candidate = join(root, 'steamapps', 'common', 'wallpaper_engine', 'config.json')
    if (existsSync(candidate)) config = candidate
  }
  if (!config) return []
  const running = await listRunningProcesses()
  if (!WE_EXES.some((exe) => running.has(exe))) return []

  type Selected = Record<string, { file?: string }>
  const users = JSON.parse(await fs.readFile(config, 'utf8')) as Record<
    string,
    { general?: { wallpaperconfig?: { selectedwallpapers?: Selected } } }
  >
  const user = users[userInfo().username] ?? Object.values(users).find((u) => u?.general?.wallpaperconfig)
  const selected = user?.general?.wallpaperconfig?.selectedwallpapers ?? {}
  // monitors unplugged since keep their entry: only as many as there are screens
  const files = Object.entries(selected)
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
    .slice(0, screen.getAllDisplays().length)
    .map(([, pick]) => pick?.file)

  const sources: DesktopSource[] = []
  for (const file of files) {
    const source = file ? await wallpaperEngineProject(file) : undefined
    if (source) sources.push(source)
  }
  return sources
}

// wallpaper engine first: what it pushes to windows lags behind and spans every
// monitor. then windows' per-monitor copies (Transcoded_000...), then its single
// copy (slideshows included), then the registry path (can point at a moved file)
async function desktopSources(): Promise<DesktopSource[]> {
  try {
    const engine = await wallpaperEngineSources()
    if (engine.length) return engine
  } catch (err) {
    console.warn('[background] could not read wallpaper engine:', (err as Error).message)
  }
  const themes = join(process.env.APPDATA ?? '', 'Microsoft', 'Windows', 'Themes')
  const perMonitor = (await fs.readdir(themes).catch(() => [] as string[]))
    .filter((name) => /^Transcoded_\d{3}$/.test(name))
    .sort()
  if (perMonitor.length > 1) return perMonitor.map((name) => ({ path: join(themes, name), thumb: false }))
  const transcoded = join(themes, 'TranscodedWallpaper')
  if (existsSync(transcoded)) return [{ path: transcoded, thumb: false, span: true }]
  const registered = await readRegistryValue('HKCU\\Control Panel\\Desktop', 'WallPaper')
  return registered && existsSync(registered) ? [{ path: registered, thumb: false, span: true }] : []
}

// a spanned wallpaper is laid over the screens' physical rects; slices in
// left-to-right order. undefined = one screen, or the image isn't that shape
function spanSlices(width: number, height: number): Rectangle[] | undefined {
  const rects = screen
    .getAllDisplays()
    .map((display) => screen.dipToScreenRect(null, display.bounds))
    .sort((a, b) => a.x - b.x || a.y - b.y)
  if (rects.length < 2) return undefined
  const left = Math.min(...rects.map((r) => r.x))
  const top = Math.min(...rects.map((r) => r.y))
  const spanW = Math.max(...rects.map((r) => r.x + r.width)) - left
  const spanH = Math.max(...rects.map((r) => r.y + r.height)) - top
  if (Math.abs(width / height - spanW / spanH) > 0.03 * (spanW / spanH)) return undefined
  const sx = width / spanW
  const sy = height / spanH
  return rects.map((r) => ({
    x: Math.round((r.x - left) * sx),
    y: Math.round((r.y - top) * sy),
    width: Math.round(r.width * sx),
    height: Math.round(r.height * sy)
  }))
}

let syncing: Promise<boolean> | undefined

// copies the desktop wallpaper into art\, one image per screen, when it changed.
// true = settings changed
export function syncDesktopWallpaper(): Promise<boolean> {
  syncing ??= syncDesktop().finally(() => (syncing = undefined))
  return syncing
}

async function syncDesktop(): Promise<boolean> {
  try {
    const sources = await desktopSources()
    if (!sources.length) return false
    const stats = await Promise.all(sources.map((source) => fs.stat(source.path)))
    // screens are in it too: plugging one in changes how a span slices
    const layout = screen
      .getAllDisplays()
      .map(({ bounds: b }) => `${b.x},${b.y},${b.width},${b.height}`)
      .join(';')
    const stamp =
      sources.map((source, i) => `${source.path}|${stats[i].mtimeMs}:${stats[i].size}`).join('>') + `#${layout}`
    const { desktopScreens: previous = [], desktopStamp } = getSettings()
    if (
      previous.length &&
      desktopStamp === stamp &&
      previous.every((shot) => existsSync(join(artDir(), shot.image)))
    ) {
      return false
    }

    const images: NativeImage[] = []
    for (const source of sources) {
      // from a buffer: nativeImage decodes by content, and TranscodedWallpaper has no extension
      const image = source.thumb
        ? await nativeImage.createThumbnailFromPath(source.path, { width: 1920, height: 1080 })
        : nativeImage.createFromBuffer(await fs.readFile(source.path))
      if (image.isEmpty()) continue
      const { width, height } = image.getSize()
      const slices = source.span ? spanSlices(width, height) : undefined
      if (slices) images.push(...slices.map((rect) => image.crop(rect)))
      else images.push(image)
    }
    if (!images.length) return false

    await fs.mkdir(artDir(), { recursive: true })
    const now = Date.now()
    const screens: DesktopScreen[] = []
    for (const [i, image] of images.entries()) {
      const filename = `desktop-${now}-${i}.jpg`
      const target = join(artDir(), filename)
      const sized = image.getSize().width > 2560 ? image.resize({ width: 2560, quality: 'good' }) : image
      await fs.writeFile(target, sized.toJPEG(90))
      const shot: DesktopScreen = { image: filename }
      try {
        shot.palette = extractPalette(target)
        shot.lightness = measureLightness(target)
      } catch (err) {
        console.warn('[background] could not sample desktop colours:', (err as Error).message)
      }
      screens.push(shot)
    }
    setSettings({ desktopScreens: screens, desktopStamp: stamp })

    const keep = new Set(screens.map((shot) => shot.image))
    for (const name of await fs.readdir(artDir())) {
      if (/^desktop-.+\.jpg$/.test(name) && !keep.has(name)) await fs.rm(join(artDir(), name), { force: true })
    }
    return true
  } catch (err) {
    console.warn('[background] could not read the desktop wallpaper:', (err as Error).message)
    return false
  }
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
