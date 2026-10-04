import { app, BrowserWindow, dialog, screen } from 'electron'
import { promises as fs } from 'fs'
import os from 'os'
import { getSettings } from './store'

// the renderer's recording plus what only main can see. no keys, paths or library
const SETTINGS = [
  'glassBlur',
  'backgroundParticles',
  'visualiserPeaks',
  'visualiserGlow',
  'backgroundDim',
  'wallpaper',
  'theme',
  'screenSaverMinutes'
] as const

// a report is ~2 minutes of 1s samples; anything far past that isn't one
const MAX_BYTES = 2 * 1024 * 1024

function stamp(): string {
  const now = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}${pad(now.getMinutes())}`
}

export async function exportPerfReport(
  win: BrowserWindow | null,
  recording: unknown
): Promise<{ ok: boolean; error?: string }> {
  if (!recording || typeof recording !== 'object') return { ok: false, error: 'Nothing recorded' }

  const settings = getSettings()
  const report = {
    app: 'vitra',
    kind: 'performance',
    createdAt: new Date().toISOString(),
    version: app.getVersion(),
    packaged: app.isPackaged,
    versions: { electron: process.versions.electron, chrome: process.versions.chrome },
    system: {
      os: `${os.type()} ${os.release()}`,
      cpu: os.cpus()[0]?.model.trim(),
      cores: os.cpus().length,
      memoryGb: Math.round(os.totalmem() / 1024 ** 3),
      gpu: await app.getGPUInfo('basic').catch(() => undefined),
      displays: screen.getAllDisplays().map((d) => ({
        width: d.size.width,
        height: d.size.height,
        scale: d.scaleFactor,
        hz: d.displayFrequency
      }))
    },
    settings: Object.fromEntries(SETTINGS.map((key) => [key, settings[key]])),
    ...recording
  }
  const text = JSON.stringify(report, null, 2)
  if (text.length > MAX_BYTES) return { ok: false, error: 'Report too large' }

  const options = {
    title: 'Export performance report',
    defaultPath: `Vitra performance ${stamp()}.json`,
    filters: [{ name: 'JSON', extensions: ['json'] }]
  }
  const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
  if (result.canceled || !result.filePath) return { ok: false }
  await fs.writeFile(result.filePath, text, 'utf8')
  return { ok: true }
}
