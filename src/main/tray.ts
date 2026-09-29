import { app, Menu, nativeImage, Tray, type BrowserWindow, type NativeImage } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'

/*
 * Life outside the window: the tray icon, and starting with Windows.
 *
 * Closing the window hides it to the tray (Settings → General can turn that
 * off), so playtime tracking and the media bridge keep running and Vitra
 * reopens instantly. Quit from the tray menu really quits.
 */

/** Passed at login so Vitra starts in the tray instead of opening a window. */
export const BACKGROUND_ARG = '--background'

export function startedInBackground(): boolean {
  return process.argv.includes(BACKGROUND_ARG)
}

let tray: Tray | null = null

function trayImage(): NativeImage {
  const file = join(app.getAppPath(), 'resources', 'icon.png')
  if (!existsSync(file)) return nativeImage.createEmpty()
  const source = nativeImage.createFromPath(file)
  // 16px for standard DPI, with a 32px representation for scaled displays.
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
  // A single click opens it, as with most Windows tray apps.
  tray.on('click', () => showWindow(getWindow()))
}

export function destroyTray(): void {
  tray?.destroy()
  tray = null
}

/**
 * Registers (or removes) Vitra as a Windows startup app. Only the installed
 * app is registered: running from source, the executable is the bare
 * electron.exe, and a startup entry for it would open an empty Electron
 * window at every login.
 */
export function applyLoginItem(openAtLogin: boolean): void {
  if (!app.isPackaged) {
    console.log(`[tray] start with Windows (${openAtLogin ? 'on' : 'off'}) applies to the installed app only`)
    return
  }
  app.setLoginItemSettings({ openAtLogin, args: [BACKGROUND_ARG] })
}
