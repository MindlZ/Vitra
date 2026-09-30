import { app, Menu, nativeImage, Tray, type BrowserWindow, type NativeImage } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'

export const BACKGROUND_ARG = '--background'

export function startedInBackground(): boolean {
  return process.argv.includes(BACKGROUND_ARG)
}

let tray: Tray | null = null

function trayImage(): NativeImage {
  const file = join(app.getAppPath(), 'resources', 'icon.png')
  if (!existsSync(file)) return nativeImage.createEmpty()
  const source = nativeImage.createFromPath(file)
  const image = source.resize({ width: 16, height: 16, quality: 'best' })
  image.addRepresentation({
    scaleFactor: 2,
    buffer: source.resize({ width: 32, height: 32, quality: 'best' }).toPNG()
  })
  return image
}

export function showWindow(win: BrowserWindow | null): void {
  if (!win || win.isDestroyed()) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

export function createTray(getWindow: () => BrowserWindow | null, onBigPicture: () => void): void {
  if (tray) return
  tray = new Tray(trayImage())
  tray.setToolTip('Vitra')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open Vitra', click: () => showWindow(getWindow()) },
      {
        label: 'Big picture',
        click: () => {
          showWindow(getWindow())
          onBigPicture()
        }
      },
      { type: 'separator' },
      { label: 'Quit Vitra', click: () => app.quit() }
    ])
  )
  tray.on('click', () => showWindow(getWindow()))
}

export function destroyTray(): void {
  tray?.destroy()
  tray = null
}

// packaged only: from source the exe is bare electron.exe, which would open an
// empty window at every login
export function applyLoginItem(openAtLogin: boolean): void {
  if (!app.isPackaged) {
    console.log(`[tray] start with Windows (${openAtLogin ? 'on' : 'off'}) applies to the installed app only`)
    return
  }
  app.setLoginItemSettings({ openAtLogin, args: [BACKGROUND_ARG] })
}
