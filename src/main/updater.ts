import { app, BrowserWindow } from 'electron'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { autoUpdater } from 'electron-updater'
import { finishAllSessions } from './launch'
import { getSettings } from './store'
import type { UpdateState } from '../shared/types'

/*
 * Updates from the project's GitHub Releases, through electron-updater.
 * Publishing a release (the installer, its .blockmap and latest.yml) is
 * all it takes; see the README.
 *
 * The repo isn't named in code. electron-builder reads it from package.json's
 * `repository` (or the git remote) at build time and writes it into the
 * installed app as resources/app-update.yml. No file, no updates: this copy
 * was built before the repo existed, and says so rather than failing.
 *
 * Nothing downloads on its own. A check only finds out whether there's
 * something newer; "Update now" downloads it, saves any play session in
 * progress, installs silently into the same place and relaunches.
 */

const FIRST_CHECK_MS = 15_000
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000

let state: UpdateState = { status: 'idle', currentVersion: app.getVersion() }
let firstCheck: NodeJS.Timeout | undefined
let timer: NodeJS.Timeout | undefined
let wired = false

function configFile(): string {
  return join(process.resourcesPath, 'app-update.yml')
}

function set(patch: Partial<UpdateState>): void {
  state = { ...state, ...patch }
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('update:changed', state)
  }
}

/** owner/repo from app-update.yml, for the release page link. */
function releasesBase(): string | undefined {
  try {
    const text = readFileSync(configFile(), 'utf8')
    const owner = text.match(/^owner:\s*['"]?([^'"\s]+)/m)?.[1]
    const repo = text.match(/^repo:\s*['"]?([^'"\s]+)/m)?.[1]
    return owner && repo ? `https://github.com/${owner}/${repo}/releases` : undefined
  } catch {
    return undefined
  }
}

function wire(): void {
  if (wired) return
  wired = true
  autoUpdater.autoDownload = false
  // Only ever on request: an update that installs itself on quit would be a
  // surprise, and a half-downloaded one is simply fetched again next time.
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.logger = null

  autoUpdater.on('checking-for-update', () => set({ status: 'checking', message: undefined }))
  autoUpdater.on('update-not-available', () =>
    set({ status: 'up-to-date', version: undefined, checkedAt: Date.now() })
  )
  autoUpdater.on('update-available', (info) => {
    const base = releasesBase()
    set({
      status: 'available',
      version: info.version,
      releaseUrl: base ? `${base}/tag/v${info.version}` : undefined,
      checkedAt: Date.now()
    })
  })
  autoUpdater.on('download-progress', (progress) =>
    set({ status: 'downloading', percent: Math.round(progress.percent) })
  )
  autoUpdater.on('error', (err) => {
    // Offline, GitHub down, rate-limited: say so quietly and try again later.
    console.warn('[updater]', err?.message)
    set({ status: 'error', message: friendly(err), percent: undefined })
  })
}

function friendly(err: Error | undefined): string {
  const text = err?.message ?? ''
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|net::ERR_/i.test(text)) return "Couldn't reach GitHub"
  if (/404/.test(text)) return 'No releases yet'
  return "Couldn't check for updates"
}

function available(): boolean {
  if (!app.isPackaged) {
    set({ status: 'unavailable', reason: 'dev' })
    return false
  }
  if (!existsSync(configFile())) {
    set({ status: 'unavailable', reason: 'unconfigured' })
    return false
  }
  return true
}

export function getUpdateState(): UpdateState {
  // Before any check has run, still say whether one ever can.
  if (state.status === 'idle') available()
  return state
}

export async function checkForUpdates(): Promise<void> {
  if (!available()) return
  if (state.status === 'checking' || state.status === 'downloading' || state.status === 'installing') return
  wire()
  try {
    await autoUpdater.checkForUpdates()
  } catch {
    // Reported through the 'error' event.
  }
}

/**
 * Download, then install and relaunch. `beforeQuit` runs first: installing
 * closes every window before `before-quit` fires, and close-to-tray would
 * otherwise just hide the window and the install would never start.
 */
export async function installUpdate(beforeQuit: () => void): Promise<void> {
  if (state.status !== 'available' && state.status !== 'error') return
  if (!state.version) return
  wire()
  try {
    set({ status: 'downloading', percent: 0 })
    await autoUpdater.downloadUpdate()
    set({ status: 'installing', percent: 100 })
    await finishAllSessions()
    beforeQuit()
    // Silent: the same folder and per-user/everyone choice as before; the
    // installer relaunches Vitra when it's done.
    autoUpdater.quitAndInstall(true, true)
  } catch {
    // Reported through the 'error' event.
  }
}

/** Automatic checks: once shortly after start, then every few hours. */
export function scheduleUpdateChecks(): void {
  clearTimeout(firstCheck)
  clearInterval(timer)
  firstCheck = timer = undefined
  if (!available() || !getSettings().checkForUpdates) return
  firstCheck = setTimeout(() => void checkForUpdates(), FIRST_CHECK_MS)
  timer = setInterval(() => void checkForUpdates(), CHECK_EVERY_MS)
}
