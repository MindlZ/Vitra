import {
  app,
  BrowserWindow,
  desktopCapturer,
  dialog,
  ipcMain,
  nativeImage,
  protocol,
  session,
  shell
} from 'electron'
import { existsSync, promises as fs } from 'fs'
import { extname, join, normalize } from 'path'
import { artDir, getGame, getGames, getSettings, load, patchGame, publicSettings, removeGame, setSettings } from './store'
import { addManualGame, classifySoftware, scanLibrary } from './library'
import { adoptRunningGames, cancelAllTracking, launchGame, onRunningChange, runningStates, stopTracking } from './launch'
import { discordConfigured, stopPresence, updatePresence } from './discord'
import { autoTagGames } from './autoTags'
import { clearArt, ensureArt, refetchAutoArt, retryMissingArt, setLocalArt, type ArtKind } from './art'
import { getFriends, invalidateFriends, joinFriend } from './friends'
import { getSessions } from './sessions'
import { exportBackup, importBackup } from './backup'
import { clearAchievements, getAchievements } from './achievements'
import { getMedia, onMediaChange, sendMediaCommand, stopMedia } from './media'
import { backfillLightness, clearBackground, setBackground, syncDesktopWallpaper } from './background'
import { initialBounds, trackWindowState, wasMaximized } from './windowState'
import { capturePath, listCaptures, serveCapture } from './captures'
import { runPower } from './power'
import { exportPerfReport, latestMetrics, setPerfRecording } from './perf'
import { applyWidgets, closeWidgets, sendToWidgets, setWidgetMoving, updateWidgetLook } from './widget'
import { getLyrics } from './lyrics'
import { checkForUpdates, getUpdateState, installUpdate, scheduleUpdateChecks } from './updater'
import { applyLoginItem, createTray, destroyTray, showWindow, startedInBackground } from './tray'
import { clearSteamPathCache } from './paths'
import { clearGridDirCache } from './scanners/steamGrid'
import {
  GAME_SOURCES,
  type Game,
  type GameSource,
  type MediaCommand,
  type PowerAction,
  type ProcessMetric,
  type Settings,
  type WindowAction
} from '../shared/types'

const ART_SCHEME = 'applib'

protocol.registerSchemesAsPrivileged([
  {
    scheme: ART_SCHEME,
    // stream: capture <video>s seek with Range requests
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

// ?w= : a downscaled jpeg, so a tile or the backdrop bake doesn't decode a 4k
// original. memo'd per file+width+mtime; the wallpaper is the only real user
const resized = new Map<string, Uint8Array<ArrayBuffer>>()
async function serveResized(path: string, wanted: number): Promise<Response> {
  const width = Math.min(2048, Math.max(64, Math.round(wanted)))
  const { mtimeMs } = await fs.stat(path)
  const key = `${path}|${width}|${mtimeMs}`
  let data = resized.get(key)
  if (!data) {
    const image = nativeImage.createFromBuffer(await fs.readFile(path))
    if (image.isEmpty()) return new Response('Not found', { status: 404 })
    const small = image.getSize().width > width ? image.resize({ width, quality: 'good' }) : image
    data = new Uint8Array(small.toJPEG(88))
    if (resized.size > 16) resized.clear()
    resized.set(key, data)
  }
  return new Response(data, { headers: { 'content-type': 'image/jpeg', 'cache-control': 'no-cache' } })
}

function registerArtProtocol(): void {
  protocol.handle(ART_SCHEME, async (request) => {
    try {
      const url = new URL(request.url)
      if (url.hostname === 'capture') return await serveCapture(request)
      if (url.hostname !== 'art') return new Response('Not found', { status: 404 })

      const filename = decodeURIComponent(url.pathname.replace(/^\/+/, ''))
      const root = artDir()
      const resolved = normalize(join(root, filename))
      if (!resolved.startsWith(normalize(root))) return new Response('Forbidden', { status: 403 })

      const width = Number(url.searchParams.get('w'))
      if (width) return await serveResized(resolved, width)

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
let quitting = false

function appIcon(): string | undefined {
  const icon = join(app.getAppPath(), 'resources', 'icon.png')
  return existsSync(icon) ? icon : undefined
}

// getDisplayMedia is the only way to get system audio. The API insists on a
// video track too; the renderer stops it straight away.
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

let classifying = false
function classifyInBackground(): void {
  if (classifying) return
  classifying = true
  void classifySoftware()
    .then(async (classified) => {
      // after: tagging skips software
      const tagged = await autoTagGames()
      if (classified || tagged) mainWindow?.webContents.send('library:changed', null)
    })
    .catch((err) => console.error('[classify]', err))
    .finally(() => {
      classifying = false
    })
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    ...initialBounds(),
    minWidth: 980,
    minHeight: 640,
    show: false,
    fullscreen: getSettings().bigPictureOnStart,
    icon: appIcon(),
    backgroundColor: '#0c0709',
    autoHideMenuBar: true,
    // hidden (no overlay) keeps resize borders + snap; controls are our own
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      autoplayPolicy: 'no-user-gesture-required'
    }
  })

  const sendMaximized = (): void => {
    mainWindow?.webContents.send('window:maximized', mainWindow.isMaximized())
  }
  // the desktop wallpaper may have changed while Vitra was in the background
  const followDesktop = (): void => {
    if (getSettings().wallpaper !== 'desktop') return
    void syncDesktopWallpaper().then((changed) => {
      if (changed) mainWindow?.webContents.send('library:changed', null)
    })
  }
  mainWindow.on('focus', followDesktop)
  mainWindow.on('show', followDesktop)
  mainWindow.on('maximize', sendMaximized)
  mainWindow.on('unmaximize', sendMaximized)
  trackWindowState(mainWindow)
  // maximize() also shows, so not before the window's meant to be seen (tray start)
  const restoreMaximized = (): void => {
    if (wasMaximized() && !mainWindow?.isFullScreen()) mainWindow?.maximize()
  }
  mainWindow.once('show', restoreMaximized)

  // login entry always passes --background; whether to stay hidden is decided here
  mainWindow.on('ready-to-show', () => {
    const { startInTray, bigPictureOnStart } = getSettings()
    if (!startedInBackground() || !startInTray || bigPictureOnStart) {
      // maximised straight away rather than shown, then maximised (no flash)
      if (wasMaximized() && !mainWindow?.isFullScreen()) mainWindow?.maximize()
      else mainWindow?.show()
    }
  })

  mainWindow.on('closed', closeWidgets)

  mainWindow.on('close', (event) => {
    if (quitting || !getSettings().closeToTray) return
    event.preventDefault()
    if (mainWindow?.isFullScreen()) mainWindow.setFullScreen(false)
    mainWindow?.hide()
  })

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

function applySettings(patch: Partial<Settings>): Settings {
  setSettings(patch)

  if ('openAtLogin' in patch) applyLoginItem(Boolean(patch.openAtLogin))
  if (patch.autoTags) classifyInBackground()
  if ('steamWebApiKey' in patch || 'xboxApiKey' in patch) invalidateFriends()
  if ('steamWebApiKey' in patch) clearAchievements()
  if ('discordPresence' in patch) updatePresence()
  if ('checkForUpdates' in patch) scheduleUpdateChecks()
  if ('perfOverlay' in patch) setPerfRecording(Boolean(patch.perfOverlay), () => mainWindow)
  const widgetKeys = ['visualiserWidget', 'visualiserWidgetSize', 'lyrics', 'lyricsWidget', 'lyricsWidgetSize']
  if (widgetKeys.some((key) => key in patch)) applyWidgets()
  if ('visualiserPeaks' in patch || 'visualiserGlow' in patch) updateWidgetLook()
  if ('steamGridDbKey' in patch) retryMissingArt()
  if ('steamPath' in patch) {
    clearSteamPathCache()
    clearGridDirCache()
    retryMissingArt()
    invalidateFriends()
  }
  return publicSettings()
}

function registerIpc(): void {
  ipcMain.handle('library:get', () => ({
    games: getGames(),
    settings: publicSettings(),
    running: runningStates()
  }))

  ipcMain.handle('library:scan', () => {
    retryMissingArt()
    return scanLibrary().finally(classifyInBackground)
  })

  ipcMain.handle('friends:get', (_event, force?: boolean) => getFriends(Boolean(force)))
  ipcMain.handle('friends:join', (_event, id: string) => joinFriend(String(id)))
  ipcMain.handle('stats:sessions', () => getSessions())
  ipcMain.handle('achievements:get', (_event, gameId: string) => getAchievements(String(gameId)))

  ipcMain.handle('backup:export', () => exportBackup(mainWindow))
  ipcMain.handle('backup:import', async () => {
    const result = await importBackup(mainWindow)
    if (result.ok) {
      applyLoginItem(getSettings().openAtLogin)
      scheduleUpdateChecks()
      updatePresence()
      invalidateFriends()
      retryMissingArt()
      mainWindow?.webContents.send('library:changed', null)
    }
    return result
  })

  ipcMain.handle('media:get', () => getMedia())
  ipcMain.handle('media:command', (_event, command: MediaCommand) => sendMediaCommand(command))
  onMediaChange((state) => {
    mainWindow?.webContents.send('media:changed', state)
    sendToWidgets('media:changed', state)
  })
  onRunningChange(updatePresence)

  ipcMain.handle('game:launch', (_event, id: string) => launchGame(id))
  ipcMain.handle('game:stop-tracking', (_event, id: string) => stopTracking(id))

  ipcMain.handle('game:patch', async (_event, id: string, patch: Partial<Game>) => {
    // whitelist. never exePath / launcher / companions: the renderer mustn't choose what runs
    const allowed: Partial<Game> = {}
    if (typeof patch.name === 'string' && patch.name.trim()) allowed.name = patch.name.trim()
    if (Array.isArray(patch.tags)) {
      allowed.tags = [...new Set(patch.tags.map((t) => String(t).trim()).filter(Boolean))]
    }
    if (typeof patch.favorite === 'boolean') allowed.favorite = patch.favorite
    if (typeof patch.hidden === 'boolean') allowed.hidden = patch.hidden
    if (typeof patch.softwareOverride === 'boolean') allowed.softwareOverride = patch.softwareOverride
    if (GAME_SOURCES.includes(patch.preferredStore as GameSource)) allowed.preferredStore = patch.preferredStore
    if (typeof patch.closeCompanions === 'boolean') allowed.closeCompanions = patch.closeCompanions
    if (typeof patch.args === 'string') allowed.args = patch.args
    if (typeof patch.playtimeSeconds === 'number' && patch.playtimeSeconds >= 0) {
      allowed.playtimeSeconds = Math.round(patch.playtimeSeconds)
    }
    const renamed = allowed.name !== undefined && allowed.name !== getGame(id)?.name
    if (renamed) allowed.autoName = false
    // an untagged game Steam couldn't match may match under its new name
    if (renamed && !getGame(id)?.tags.length && !allowed.tags?.length) allowed.autoTagged = undefined
    const game = patchGame(id, allowed)
    if (renamed) await refetchAutoArt(id)
    return game
  })

  ipcMain.handle('game:remove', (_event, id: string) => {
    const exe = getGame(id)?.exePath
    // a folder scan would bring it straight back
    if (id.startsWith('local:') && exe) {
      const dismissed = getSettings().dismissedGames ?? []
      setSettings({ dismissedGames: [...new Set([...dismissed, exe.toLowerCase()])] })
    }
    return removeGame(id)
  })

  const pickProgram = async (title: string): Promise<string | undefined> => {
    const result = await dialog.showOpenDialog({
      title,
      properties: ['openFile'],
      filters: [{ name: 'Programs and scripts', extensions: ['exe', 'lnk', 'bat', 'cmd', 'ps1'] }]
    })
    return result.canceled ? undefined : result.filePaths[0]
  }
  ipcMain.handle('game:add-companion', async (_event, id: string) => {
    const game = getGame(id)
    if (!game) return undefined
    const path = await pickProgram('Start with this game')
    if (!path) return game
    return patchGame(id, { companions: [...new Set([...(game.companions ?? []), path])] })
  })
  ipcMain.handle('game:remove-companion', (_event, id: string, index: number) => {
    const game = getGame(id)
    if (!game?.companions || !Number.isInteger(index)) return game
    return patchGame(id, { companions: game.companions.filter((_, i) => i !== index) })
  })
  ipcMain.handle('game:set-after-exit', async (_event, id: string, clear?: boolean) => {
    if (!getGame(id)) return undefined
    if (clear) return patchGame(id, { afterExit: undefined })
    const path = await pickProgram('Run when this game closes')
    return path ? patchGame(id, { afterExit: path }) : getGame(id)
  })

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

  ipcMain.handle('settings:set', async (_event, patch: Partial<Settings>) => {
    // only the picker sets these, or the renderer could aim applib:// at any file name
    const rest = { ...patch }
    delete rest.backgroundImage
    delete rest.backgroundPalette
    delete rest.backgroundLightness
    delete rest.desktopScreens
    delete rest.desktopStamp
    delete rest.visualiserWidgetPos
    delete rest.lyricsWidgetPos
    delete rest.windowState
    delete rest.gameFolders
    delete rest.dismissedGames
    // copied first, so the reply already carries the image
    if (rest.wallpaper === 'desktop') await syncDesktopWallpaper()
    return applySettings(rest)
  })

  ipcMain.handle('settings:pick-background', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Choose a background image',
      properties: ['openFile'],
      // nativeImage can't decode webp etc, and the palette needs sampling
      filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png'] }]
    })
    if (result.canceled || !result.filePaths.length) return null
    return setBackground(result.filePaths[0])
  })

  ipcMain.handle('settings:clear-background', () => clearBackground())

  ipcMain.handle('window:set-fullscreen', (_event, on: boolean) => {
    const win = mainWindow
    const want = Boolean(on)
    if (!win || win.isDestroyed() || win.isFullScreen() === want) return
    return new Promise<void>((resolve) => {
      // the event never comes if the window's hidden
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
    if (['sleep', 'restart', 'shutdown', 'quit'].includes(action)) return runPower(action)
  })

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

  ipcMain.handle('app:metrics', (): ProcessMetric[] => latestMetrics())
  ipcMain.handle('perf:export', (_event, frames: unknown) => exportPerfReport(mainWindow, frames))
  ipcMain.handle('widget:move', (_event, kind: unknown, on: unknown) => setWidgetMoving(kind, Boolean(on)))
  ipcMain.handle('lyrics:get', (_event, track: unknown) => getLyrics(track))

  ipcMain.handle('settings:pick-steam-path', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Select your Steam folder',
      properties: ['openDirectory']
    })
    if (result.canceled || !result.filePaths.length) return null
    return applySettings({ steamPath: result.filePaths[0] })
  })

  ipcMain.handle('settings:add-game-folder', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Choose a folder of games',
      properties: ['openDirectory']
    })
    if (result.canceled || !result.filePaths.length) return null
    const folders = getSettings().gameFolders ?? []
    const path = result.filePaths[0]
    if (folders.some((folder) => folder.toLowerCase() === path.toLowerCase())) return publicSettings()
    setSettings({ gameFolders: [...folders, path] })
    return publicSettings()
  })

  // by index: the renderer only picks from main's own list
  ipcMain.handle('settings:remove-game-folder', (_event, index: number) => {
    const folders = getSettings().gameFolders ?? []
    if (!Number.isInteger(index) || !folders[index]) return publicSettings()
    setSettings({ gameFolders: folders.filter((_, i) => i !== index) })
    return publicSettings()
  })
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => showWindow(mainWindow))

  app.on('before-quit', () => {
    quitting = true
  })

  void app.whenReady().then(async () => {
    // must match electron-builder's appId or the taskbar groups it as "Electron"
    if (app.isPackaged) app.setAppUserModelId('com.mindlz.vitra')
    registerArtProtocol()
    await load()
    backfillLightness()
    if (getSettings().wallpaper === 'desktop') await syncDesktopWallpaper()
    registerIpc()
    registerAudioCapture()
    createWindow()
    createTray(
      () => mainWindow,
      () => mainWindow?.webContents.send('app:open-big-picture', null)
    )
    applyLoginItem(getSettings().openAtLogin)
    scheduleUpdateChecks()
    setPerfRecording(getSettings().perfOverlay, () => mainWindow)
    void adoptRunningGames().catch((err) => console.error('[adopt]', err))
    applyWidgets()

    if (getSettings().scanOnStart) {
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
