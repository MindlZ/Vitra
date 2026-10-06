import { BrowserWindow, screen } from 'electron'
import { join } from 'path'
import { getSettings, setSettings } from './store'
import type { Settings, WidgetKind, WidgetSize } from '../shared/types'

// floating widgets (visualiser, lyrics): each its own transparent window, always on
// top, click-through and never focusable, so it can't take input from the game under
// it. they can't show over exclusive-fullscreen games, only borderless/windowed ones

interface Kind {
  sizes: Record<WidgetSize, { width: number; height: number }>
  shown: (s: Settings) => boolean
  size: (s: Settings) => WidgetSize
  pos: 'visualiserWidgetPos' | 'lyricsWidgetPos'
  // default spot: bottom centre, this far up (lyrics sit above the visualiser)
  bottomGap: number
}

const KINDS: Record<WidgetKind, Kind> = {
  visualiser: {
    sizes: {
      small: { width: 320, height: 90 },
      medium: { width: 460, height: 120 },
      large: { width: 640, height: 170 }
    },
    shown: (s) => s.visualiserWidget,
    size: (s) => s.visualiserWidgetSize,
    pos: 'visualiserWidgetPos',
    bottomGap: 48
  },
  // wide and short, like subtitles; two lines of text at each size
  lyrics: {
    sizes: {
      small: { width: 520, height: 64 },
      medium: { width: 720, height: 84 },
      large: { width: 960, height: 112 }
    },
    shown: (s) => s.lyrics && s.lyricsWidget,
    size: (s) => s.lyricsWidgetSize,
    pos: 'lyricsWidgetPos',
    bottomGap: 190
  }
}

const KIND_NAMES = Object.keys(KINDS) as WidgetKind[]
const windows: Partial<Record<WidgetKind, BrowserWindow>> = {}
const moving: Record<WidgetKind, boolean> = { visualiser: false, lyrics: false }

export function isWidgetWindow(other: BrowserWindow): boolean {
  return KIND_NAMES.some((kind) => windows[kind] === other)
}

function live(kind: WidgetKind): BrowserWindow | undefined {
  const win = windows[kind]
  return win && !win.isDestroyed() ? win : undefined
}

function sendState(kind: WidgetKind): void {
  const { visualiserPeaks, visualiserGlow } = getSettings()
  live(kind)?.webContents.send('widget:state', {
    peaks: visualiserPeaks,
    glow: visualiserGlow,
    moving: moving[kind]
  })
}

// media updates, which otherwise only go to the main window
export function sendToWidgets(channel: string, payload: unknown): void {
  for (const kind of KIND_NAMES) live(kind)?.webContents.send(channel, payload)
}

// the saved spot if it's still on a screen (monitors change), else bottom centre
function placement(kind: WidgetKind, width: number, height: number): { x: number; y: number } {
  const saved = getSettings()[KINDS[kind].pos]
  if (saved) {
    const centre = { x: saved.x + width / 2, y: saved.y + height / 2 }
    const onScreen = screen.getAllDisplays().some(({ workArea: a }) =>
      centre.x >= a.x && centre.x <= a.x + a.width && centre.y >= a.y && centre.y <= a.y + a.height
    )
    if (onScreen) return saved
  }
  const area = screen.getPrimaryDisplay().workArea
  return {
    x: Math.round(area.x + (area.width - width) / 2),
    y: Math.round(area.y + area.height - height - KINDS[kind].bottomGap)
  }
}

const SNAP = 24

// on release, centres within SNAP px pull together: the screen's centre lines and the
// other widget's centre line
function snapped(kind: WidgetKind, win: BrowserWindow): { x: number; y: number } {
  const b = win.getBounds()
  const cx = b.x + b.width / 2
  const cy = b.y + b.height / 2
  const area = screen.getDisplayNearestPoint({ x: Math.round(cx), y: Math.round(cy) }).workArea
  const xs = [area.x + area.width / 2]
  const ys = [area.y + area.height / 2]
  for (const other of KIND_NAMES) {
    const o = other !== kind ? live(other) : undefined
    if (!o) continue
    const ob = o.getBounds()
    xs.push(ob.x + ob.width / 2)
    ys.push(ob.y + ob.height / 2)
  }
  const near = (c: number, lines: number[]): number | undefined =>
    lines.filter((l) => Math.abs(l - c) <= SNAP).sort((a, b) => Math.abs(a - c) - Math.abs(b - c))[0]
  const sx = near(cx, xs)
  const sy = near(cy, ys)
  return {
    x: sx === undefined ? b.x : Math.round(sx - b.width / 2),
    y: sy === undefined ? b.y : Math.round(sy - b.height / 2)
  }
}

function create(kind: WidgetKind, width: number, height: number): BrowserWindow {
  const win = new BrowserWindow({
    width,
    height,
    ...placement(kind, width, height),
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: false,
    hasShadow: false,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  // 'screen-saver' sits above borderless fullscreen games
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setIgnoreMouseEvents(true)
  win.once('ready-to-show', () => win.showInactive())
  win.webContents.on('did-finish-load', () => sendState(kind))
  // 'moved' fires once, when the drag ends (windows)
  win.on('moved', () => {
    const [px, py] = win.getPosition()
    const { x, y } = snapped(kind, win)
    if (x !== px || y !== py) win.setPosition(x, y)
    setSettings({ [KINDS[kind].pos]: { x, y } })
  })
  win.on('closed', () => {
    if (windows[kind] === win) delete windows[kind]
  })

  // the renderer branches on the hash (main.tsx)
  const hash = kind === 'visualiser' ? 'widget' : kind
  const devServer = process.env.ELECTRON_RENDERER_URL
  if (devServer) void win.loadURL(`${devServer}#${hash}`)
  else void win.loadFile(join(__dirname, '../renderer/index.html'), { hash })
  return win
}

function close(kind: WidgetKind): void {
  moving[kind] = false
  live(kind)?.destroy()
  delete windows[kind]
}

// on start and whenever a widget setting changes
export function applyWidgets(): void {
  const settings = getSettings()
  for (const kind of KIND_NAMES) {
    const spec = KINDS[kind]
    if (!spec.shown(settings)) {
      close(kind)
      continue
    }
    const { width, height } = spec.sizes[spec.size(settings)] ?? spec.sizes.medium
    const win = live(kind)
    if (win) {
      const [x, y] = win.getPosition()
      win.setBounds({ x, y, width, height })
      sendState(kind)
    } else {
      windows[kind] = create(kind, width, height)
    }
  }
}

// with the main window: otherwise window-all-closed never fires and Vitra lingers as widgets
export function closeWidgets(): void {
  for (const kind of KIND_NAMES) close(kind)
}

export function updateWidgetLook(): void {
  for (const kind of KIND_NAMES) sendState(kind)
}

// move mode: takes the mouse so it can be dragged; otherwise clicks go through
export function setWidgetMoving(kind: unknown, on: boolean): void {
  if (kind !== 'visualiser' && kind !== 'lyrics') return
  const win = live(kind)
  if (!win) return
  moving[kind] = on
  win.setIgnoreMouseEvents(!on)
  sendState(kind)
}
