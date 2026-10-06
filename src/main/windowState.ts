import { screen } from 'electron'
import type { BrowserWindow, Rectangle } from 'electron'
import { getSettings, setSettings } from './store'

// saved while it changes, not on close, so a crash still reopens on the same
// screen. fullscreen (big picture) isn't saved: its bounds are the whole screen,
// and the last windowed bounds already name it

const MIN = { width: 980, height: 640 }
const DEFAULT = { width: 1360, height: 860 }

// the saved spot if its centre is still on a screen (monitors change), fitted
// to that screen's work area. no x/y = Electron centres it on the primary
export function initialBounds(): Partial<Rectangle> & { width: number; height: number } {
  const saved = getSettings().windowState
  if (!saved) return DEFAULT
  const centre = { x: saved.x + saved.width / 2, y: saved.y + saved.height / 2 }
  const display = screen.getAllDisplays().find(({ workArea: a }) =>
    centre.x >= a.x && centre.x <= a.x + a.width && centre.y >= a.y && centre.y <= a.y + a.height
  )
  if (!display) return DEFAULT
  const area = display.workArea
  const width = Math.max(MIN.width, Math.min(saved.width, area.width))
  const height = Math.max(MIN.height, Math.min(saved.height, area.height))
  return {
    x: Math.min(Math.max(saved.x, area.x), area.x + area.width - width),
    y: Math.min(Math.max(saved.y, area.y), area.y + area.height - height),
    width,
    height
  }
}

export function wasMaximized(): boolean {
  return Boolean(getSettings().windowState?.maximized)
}

export function trackWindowState(win: BrowserWindow): void {
  let timer: ReturnType<typeof setTimeout> | undefined
  const save = (): void => {
    if (win.isDestroyed() || win.isFullScreen() || win.isMinimized()) return
    // normal bounds: a maximised window keeps the size it restores to
    const { x, y, width, height } = win.getNormalBounds()
    setSettings({ windowState: { x, y, width, height, maximized: win.isMaximized() } })
  }
  // move/resize fire per step while dragging; keyboard moves (win+shift+arrow)
  // never fire 'moved', so these are debounced instead
  const later = (): void => {
    clearTimeout(timer)
    timer = setTimeout(save, 500)
  }
  win.on('move', later)
  win.on('resize', later)
  win.on('maximize', later)
  win.on('unmaximize', later)
  win.on('close', () => {
    clearTimeout(timer)
    save()
  })
}
