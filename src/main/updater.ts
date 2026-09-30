import { app, BrowserWindow } from 'electron'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { autoUpdater } from 'electron-updater'
import { finishAllSessions } from './launch'
import { getSettings } from './store'
import type { UpdateState } from '../shared/types'

// repo comes from resources/app-update.yml, which electron-builder writes from
// package.json `repository`. no file = unconfigured build, not an error

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
    // surfaces via the 'error' event
  }
}

// beforeQuit must set `quitting`: quitAndInstall closes windows *before*
// before-quit fires, so close-to-tray would swallow it and nothing installs
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
    autoUpdater.quitAndInstall(true, true)
  } catch {
    // surfaces via the 'error' event
  }
}

export function scheduleUpdateChecks(): void {
  clearTimeout(firstCheck)
  clearInterval(timer)
  firstCheck = timer = undefined
  if (!available() || !getSettings().checkForUpdates) return
  firstCheck = setTimeout(() => void checkForUpdates(), FIRST_CHECK_MS)
  timer = setInterval(() => void checkForUpdates(), CHECK_EVERY_MS)
}
