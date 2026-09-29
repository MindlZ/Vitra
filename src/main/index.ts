import {
  app,
  BrowserWindow,
  desktopCapturer,
  dialog,
  ipcMain,
  protocol,
  session,
  shell
} from 'electron'
import { existsSync, promises as fs } from 'fs'
import { extname, join, normalize } from 'path'
import { artDir, getGame, getGames, getSettings, load, patchGame, publicSettings, removeGame, setSettings } from './store'
import { addManualGame, classifySoftware, scanLibrary } from './library'
import { cancelAllTracking, launchGame, onRunningChange, runningStates, stopTracking } from './launch'
import { discordConfigured, stopPresence, updatePresence } from './discord'
import { clearArt, ensureArt, retryMissingArt, setLocalArt, type ArtKind } from './art'
import { getFriends, invalidateFriends } from './friends'
import { getMedia, onMediaChange, sendMediaCommand, stopMedia } from './media'
import { backfillLightness, clearBackground, setBackground } from './background'
import { capturePath, listCaptures, serveCapture } from './captures'
import { runPower } from './power'
import { checkForUpdates, getUpdateState, installUpdate, scheduleUpdateChecks } from './updater'
import { applyLoginItem, createTray, destroyTray, showWindow, startedInBackground } from './tray'
import { clearSteamPathCache } from './paths'
import { clearGridDirCache } from './scanners/steamGrid'
import type { Game, MediaCommand, PowerAction, Settings, WindowAction } from '../shared/types'

const ART_SCHEME = 'applib'

protocol.registerSchemesAsPrivileged([
  {
    scheme: ART_SCHEME,
    // stream: a capture's <video> fetches by Range, so it can seek.
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
  }
])

const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp'
}

/**
 * Serve cached art from userData over applib://art/<filename>, and game
 * captures over applib://capture/<id> (see captures.ts).
 */
function registerArtProtocol(): void {
  protocol.handle(ART_SCHEME, async (request) => {
    try {
      const url = new URL(request.url)
      if (url.hostname === 'capture') return await serveCapture(request)
      if (url.hostname !== 'art') return new Response('Not found', { status: 404 })

      const filename = decodeURIComponent(url.pathname.replace(/^\/+/, ''))
      const root = artDir()
      const resolved = normalize(join(root, filename))
      // Never let a crafted path escape the art directory.
      if (!resolved.startsWith(normalize(root))) return new Response('Forbidden', { status: 403 })

      const data = await fs.readFile(resolved)
      return new Response(new Uint8Array(data), {
        headers: {
          'content-type': MIME[extname(resolved).toLowerCase()] ?? 'application/octet-stream',
          'cache-control': 'no-cache'
        }
      })
    } catch {
      return new Response('Not found', { status: 404 })
    }
  })
}

let mainWindow: BrowserWindow | null = null
/** Set on a real quit (tray menu, or close with close-to-tray off). */
let quitting = false

/** Taskbar/window icon. Packaging will supply its own, so a miss isn't fatal. */
function appIcon(): string | undefined {
  const icon = join(app.getAppPath(), 'resources', 'icon.png')
  return existsSync(icon) ? icon : undefined
}

/**
 * Home's audio visualiser listens to whatever the PC is playing. Chromium only
 * exposes system audio through getDisplayMedia, which Electron routes here:
 * answer with Windows loopback audio and a screen source (the API insists on
 * video; the renderer stops that track at once). Nothing is recorded or sent
 * anywhere — the renderer only reads frequency levels from it.
 */
function registerAudioCapture(): void {
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    if (!request.audioRequested) {
      callback({})
      return
    }
    desktopCapturer
      .getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } })
      .then((sources) => callback(sources[0] ? { video: sources[0], audio: 'loopback' } : {}))
      .catch(() => callback({}))
  })
}

/**
 * Flags software (Wallpaper Engine, Lossless Scaling…) after a scan. Slow the
 * first time — it looks up genres on the store — so it never blocks the scan,
 * and it tells the renderer only if something actually changed.
 */
let classifying = false
function classifyInBackground(): void {
  if (classifying) return
  classifying = true
  void classifySoftware()
    .then((changed) => {
      if (changed) mainWindow?.webContents.send('library:changed', null)
    })
    .catch((err) => console.error('[classify]', err))
    .finally(() => {
      classifying = false
    })
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 980,
    minHeight: 640,
    show: false,
    // Starting in big picture: fullscreen from the first frame, rather than a
    // window that jumps to fullscreen once the renderer has read settings.
    fullscreen: getSettings().bigPictureOnStart,
    icon: appIcon(),
    backgroundColor: '#0b0711',
    autoHideMenuBar: true,
    // No native caption buttons: the title bar draws its own (TitleBar.tsx).
    // 'hidden' still keeps the resize borders, shadow and snap-on-drag.
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      // The startup sound plays before any click; the splash waits on it.
      autoplayPolicy: 'no-user-gesture-required'
    }
  })

  // The maximise button shows restore while maximised.
  const sendMaximized = (): void => {
    mainWindow?.webContents.send('window:maximized', mainWindow.isMaximized())
  }
  mainWindow.on('maximize', sendMaximized)
  mainWindow.on('unmaximize', sendMaximized)

  // Started with Windows: stay in the tray until opened. The splash and its
  // sound wait for the window to be visible, so they play then, not now.
  mainWindow.on('ready-to-show', () => {
    if (!startedInBackground()) mainWindow?.show()
  })

  // Closing hides to the tray, so playtime tracking and the media bridge keep
  // running. A real quit (tray menu) sets `quitting` first.
  mainWindow.on('close', (event) => {
    if (quitting || !getSettings().closeToTray) return
    event.preventDefault()
    if (mainWindow?.isFullScreen()) mainWindow.setFullScreen(false)
    mainWindow?.hide()
  })

  // Anything that isn't our app opens in the real browser, not in-app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  const devServer = process.env.ELECTRON_RENDERER_URL
  if (devServer) {
    void mainWindow.loadURL(devServer)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

/**
 * Settings changes that widen what other subsystems can reach — a new key, a
 * different Steam folder — have to drop their caches, or the user would have to
 * restart before the change did anything.
 */
function applySettings(patch: Partial<Settings>): Settings {
  setSettings(patch)

  if ('openAtLogin' in patch) applyLoginItem(Boolean(patch.openAtLogin))
  if ('steamWebApiKey' in patch) invalidateFriends()
  if ('discordPresence' in patch) updatePresence()
  if ('checkForUpdates' in patch) scheduleUpdateChecks()
  if ('steamGridDbKey' in patch) retryMissingArt()
  if ('steamPath' in patch) {
    clearSteamPathCache()
    clearGridDirCache()
    retryMissingArt()
    invalidateFriends()
  }
  // Goes back to the renderer, so keys are redacted.
  return publicSettings()
}

function registerIpc(): void {
  ipcMain.handle('library:get', () => ({
    games: getGames(),
    settings: publicSettings(),
    running: runningStates()
  }))

  ipcMain.handle('library:scan', () => {
    // Give art that previously came back empty another go — the ladder may have
    // gained a source (a new key) or the game may have gained local grid art.
    retryMissingArt()
    return scanLibrary().finally(classifyInBackground)
  })

  ipcMain.handle('friends:get', (_event, force?: boolean) => getFriends(Boolean(force)))

  ipcMain.handle('media:get', () => getMedia())
  ipcMain.handle('media:command', (_event, command: MediaCommand) => sendMediaCommand(command))
  onMediaChange((state) => mainWindow?.webContents.send('media:changed', state))
  onRunningChange(updatePresence)

  ipcMain.handle('game:launch', (_event, id: string) => launchGame(id))
  ipcMain.handle('game:stop-tracking', (_event, id: string) => stopTracking(id))

  ipcMain.handle('game:patch', (_event, id: string, patch: Partial<Game>) => {
    // Only user-editable fields may come from the renderer.
    const allowed: Partial<Game> = {}
    if (typeof patch.name === 'string' && patch.name.trim()) allowed.name = patch.name.trim()
    if (Array.isArray(patch.tags)) {
      allowed.tags = [...new Set(patch.tags.map((t) => String(t).trim()).filter(Boolean))]
    }
    if (typeof patch.favorite === 'boolean') allowed.favorite = patch.favorite
    if (typeof patch.hidden === 'boolean') allowed.hidden = patch.hidden
    if (typeof patch.softwareOverride === 'boolean') allowed.softwareOverride = patch.softwareOverride
    if (typeof patch.args === 'string') allowed.args = patch.args
    if (typeof patch.exePath === 'string') allowed.exePath = patch.exePath
    if (typeof patch.playtimeSeconds === 'number' && patch.playtimeSeconds >= 0) {
      allowed.playtimeSeconds = Math.round(patch.playtimeSeconds)
    }
    return patchGame(id, allowed)
  })

  ipcMain.handle('game:remove', (_event, id: string) => removeGame(id))

  ipcMain.handle('game:add-manual', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Choose a game executable',
      properties: ['openFile'],
      filters: [{ name: 'Programs', extensions: ['exe', 'lnk', 'bat', 'cmd'] }]
    })
    if (result.canceled || !result.filePaths.length) return null
    return addManualGame({ exePath: result.filePaths[0] })
  })

  ipcMain.handle('game:open-folder', (_event, id: string) => {
    const game = getGame(id)
    const target = game?.installDir ?? game?.exePath
    if (!target) return false
    void shell.openPath(game?.installDir ? target : join(target, '..'))
    return true
  })

  ipcMain.handle('captures:list', (_event, id: string) => listCaptures(id))
  ipcMain.handle('captures:reveal', (_event, captureId: string) => {
    // Only ids a listing handed out resolve, so this can't be pointed anywhere.
    const path = capturePath(captureId)
    if (path) shell.showItemInFolder(path)
  })

  ipcMain.handle('art:ensure',(_event, id: string, kind: ArtKind) => ensureArt(id, kind))
  ipcMain.handle('art:clear', (_event, id: string, kind: ArtKind) => clearArt(id, kind))

  ipcMain.handle('art:pick', async (_event, id: string, kind: ArtKind) => {
    const result = await dialog.showOpenDialog({
      title: kind === 'cover' ? 'Choose cover art' : 'Choose background art',
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'] }]
    })
    if (result.canceled || !result.filePaths.length) return null
    return setLocalArt(id, kind, result.filePaths[0])
  })

  ipcMain.handle('settings:set', (_event, patch: Partial<Settings>) => {
    // The wallpaper file and its palette are only set by the picker below, so
    // the renderer can't point the art protocol at a name of its choosing.
    const rest = { ...patch }
    delete rest.backgroundImage
    delete rest.backgroundPalette
    delete rest.backgroundLightness
    return applySettings(rest)
  })

  ipcMain.handle('settings:pick-background', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Choose a background image',
      properties: ['openFile'],
      // What nativeImage can decode, so the palette can always be sampled.
      filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png'] }]
    })
    if (result.canceled || !result.filePaths.length) return null
    return setBackground(result.filePaths[0])
  })

  ipcMain.handle('settings:clear-background', () => clearBackground())

  // Resolves once the switch has happened, so the renderer can swap views
  // behind its curtain at the new size rather than mid-resize.
  ipcMain.handle('window:set-fullscreen', (_event, on: boolean) => {
    const win = mainWindow
    const want = Boolean(on)
    if (!win || win.isDestroyed() || win.isFullScreen() === want) return
    return new Promise<void>((resolve) => {
      // In case the event never comes (the window was hidden, say).
      const timer = setTimeout(resolve, 1000)
      const done = (): void => {
        clearTimeout(timer)
        resolve()
      }
      if (want) win.once('enter-full-screen', done)
      else win.once('leave-full-screen', done)
      win.setFullScreen(want)
    })
  })

  ipcMain.handle('update:get', () => getUpdateState())
  ipcMain.handle('update:check', () => checkForUpdates())
  ipcMain.handle('update:install', () =>
    installUpdate(() => {
      quitting = true
    })
  )

  ipcMain.handle('system:power',(_event, action: PowerAction) => {
    // Only these; never pass anything from the renderer to a command line.
    if (['sleep', 'restart', 'shutdown', 'quit'].includes(action)) return runPower(action)
  })

  // The title bar's own minimise / maximise / close. Close goes through the
  // window's close handler, so close-to-tray still applies.
  ipcMain.handle('window:control', (_event, action: WindowAction) => {
    const win = mainWindow
    if (!win || win.isDestroyed()) return
    if (action === 'minimize') win.minimize()
    else if (action === 'toggle-maximize') {
      if (win.isMaximized()) win.unmaximize()
      else win.maximize()
    } else if (action === 'close') win.close()
  })
  ipcMain.handle('window:is-maximized', () => Boolean(mainWindow?.isMaximized()))

  ipcMain.handle('app:info', () => ({
    packaged: app.isPackaged,
    version: app.getVersion(),
    discordConfigured: discordConfigured()
  }))

  ipcMain.handle('settings:pick-steam-path', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Select your Steam folder',
      properties: ['openDirectory']
    })
    if (result.canceled || !result.filePaths.length) return null
    return applySettings({ steamPath: result.filePaths[0] })
  })
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  // Launching Vitra again (a shortcut, the Start menu) brings the one that's
  // already running out of the tray.
  app.on('second-instance', () => showWindow(mainWindow))

  app.on('before-quit', () => {
    quitting = true
  })

  void app.whenReady().then(async () => {
    // Matches the installer's shortcuts (electron-builder appId), so the
    // taskbar groups and pins Vitra as itself rather than as "Electron".
    if (app.isPackaged) app.setAppUserModelId('com.mindlz.vitra')
    registerArtProtocol()
    await load()
    backfillLightness()
    registerIpc()
    registerAudioCapture()
    createWindow()
    createTray(
      () => mainWindow,
      () => mainWindow?.webContents.send('app:open-big-picture', null)
    )
    // Keep Windows' startup entry in step with the setting (e.g. after a move).
    applyLoginItem(getSettings().openAtLogin)
    scheduleUpdateChecks()

    if (getSettings().scanOnStart) {
      // Don't block first paint on disk scanning.
      void scanLibrary()
        .then(() => mainWindow?.webContents.send('library:changed', null))
        .catch((err) => console.error('[startup scan]', err))
        .finally(classifyInBackground)
    } else {
      classifyInBackground()
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    cancelAllTracking()
    stopMedia()
    stopPresence()
    destroyTray()
    if (process.platform !== 'darwin') app.quit()
  })
}
