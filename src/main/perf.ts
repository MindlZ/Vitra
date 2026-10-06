import { app, BrowserWindow, dialog, screen } from 'electron'
import { promises as fs } from 'fs'
import os from 'os'
import { getSettings } from './store'
import type { ProcessMetric } from '../shared/types'

// process metrics are sampled here, not in the renderer: a hidden (trayed,
// minimised) renderer stops its rAF and throttles timers, so it can't see
// those states. also the only getAppMetrics caller: its cpu is "since the last call"

type WindowState = 'focused' | 'unfocused' | 'hidden'

interface MetricSample {
  at: number
  state: WindowState
  processes: ProcessMetric[]
}

interface FrameSample {
  at: number
  view: string
  fps: number
  worstFrame: number
  longTasks: number
  heapMb?: number
}

const SAMPLE_MS = 2000
// 10 minutes, enough to cover a stretch in the tray
const HISTORY = 300

// the effect settings, for comparing runs. no keys, paths or library
const SETTINGS = [
  'glassBlur',
  'backgroundParticles',
  'visualiserPeaks',
  'visualiserGlow',
  'slowWhenUnfocused',
  'backgroundDim',
  'wallpaper',
  'theme',
  'screenSaverMinutes'
] as const

// frames the renderer sends; anything far past ten minutes of them isn't a report
const MAX_FRAMES = 1200

const samples: MetricSample[] = []
let timer: ReturnType<typeof setInterval> | undefined
let latest: ProcessMetric[] = []

function read(): ProcessMetric[] {
  return app.getAppMetrics().map((metric) => ({
    type: metric.type,
    cpu: Math.round(metric.cpu.percentCPUUsage * 10) / 10,
    // privateBytes is windows-only, hence the fallback
    memoryMb: Math.round((metric.memory.privateBytes ?? metric.memory.workingSetSize) / 102.4) / 10
  }))
}

function stateOf(win: BrowserWindow | null): WindowState {
  if (!win || win.isDestroyed() || !win.isVisible() || win.isMinimized()) return 'hidden'
  return win.isFocused() ? 'focused' : 'unfocused'
}

export function setPerfRecording(on: boolean, window: () => BrowserWindow | null): void {
  if (on && !timer) {
    // primes the cpu baseline; the first reading is always 0
    read()
    timer = setInterval(() => {
      latest = read()
      samples.push({ at: Date.now(), state: stateOf(window()), processes: latest })
      if (samples.length > HISTORY) samples.shift()
    }, SAMPLE_MS)
  } else if (!on && timer) {
    clearInterval(timer)
    timer = undefined
    samples.length = 0
    latest = []
  }
}

export function latestMetrics(): ProcessMetric[] {
  return latest
}

const round = (value: number): number => Math.round(value * 10) / 10
const average = (values: number[]): number =>
  values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : 0

function percentile(values: number[], p: number): number {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]
}

function roleOf(type: string): string {
  return type === 'Browser' ? 'main' : type === 'Tab' ? 'renderer' : type === 'GPU' ? 'gpu' : 'other'
}

// same formula as scripts/perf.ps1 and the overlay, minus the gpu term
function score(cpu: number, memoryMb: number): number {
  const penalty = (value: number, free: number, perUnit: number, max: number): number =>
    Math.min(max, Math.max(0, (value - free) * perUnit))
  return Math.round(Math.max(0, 100 - penalty(cpu, 3, 2.5, 45) - penalty(memoryMb, 450, 0.05, 20)))
}

function summariseMetrics(list: MetricSample[]) {
  const cpuOf = (s: MetricSample): number => s.processes.reduce((sum, p) => sum + p.cpu, 0)
  const memoryOf = (s: MetricSample): number => s.processes.reduce((sum, p) => sum + p.memoryMb, 0)
  const byRole = (pick: (p: ProcessMetric) => number): Record<string, number> => {
    const totals: Record<string, number> = {}
    for (const s of list) {
      for (const p of s.processes) totals[roleOf(p.type)] = (totals[roleOf(p.type)] ?? 0) + pick(p)
    }
    for (const role of Object.keys(totals)) totals[role] = round(totals[role] / list.length)
    return totals
  }
  const cpu = average(list.map(cpuOf))
  const memoryMb = average(list.map(memoryOf))
  return {
    seconds: (list.length * SAMPLE_MS) / 1000,
    cpu: round(cpu),
    cpuByRole: byRole((p) => p.cpu),
    memoryMb: Math.round(memoryMb),
    memoryPeakMb: Math.round(Math.max(0, ...list.map(memoryOf))),
    memoryByRole: byRole((p) => p.memoryMb),
    score: score(cpu, memoryMb)
  }
}

function summariseFrames(list: FrameSample[]) {
  return {
    seconds: list.length,
    fps: round(average(list.map((f) => f.fps))),
    worstFrameP95: percentile(list.map((f) => f.worstFrame), 0.95),
    worstFrameMax: Math.max(0, ...list.map((f) => f.worstFrame)),
    longTasks: list.reduce((sum, f) => sum + f.longTasks, 0),
    heapMb: Math.max(0, ...list.map((f) => f.heapMb ?? 0))
  }
}

function isFrame(value: unknown): value is FrameSample {
  const f = value as FrameSample
  return (
    typeof f === 'object' && f !== null &&
    typeof f.at === 'number' && typeof f.view === 'string' &&
    typeof f.fps === 'number' && typeof f.worstFrame === 'number' && typeof f.longTasks === 'number'
  )
}

function stamp(): string {
  const now = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}${pad(now.getMinutes())}`
}

// clears both recordings after a save, so each export covers only what came after the last
export async function exportPerfReport(
  win: BrowserWindow | null,
  rendererFrames: unknown
): Promise<{ ok: boolean; error?: string }> {
  const frames = Array.isArray(rendererFrames) ? rendererFrames.filter(isFrame).slice(-MAX_FRAMES) : []
  if (!samples.length && !frames.length) return { ok: false, error: 'Nothing recorded yet' }
  const metrics = [...samples]

  const states: WindowState[] = ['focused', 'unfocused', 'hidden']
  const views = [...new Set(frames.map((f) => f.view))]
  const settings = getSettings()
  const report = {
    app: 'vitra',
    kind: 'performance',
    format: 2,
    createdAt: new Date().toISOString(),
    version: app.getVersion(),
    packaged: app.isPackaged,
    versions: { electron: process.versions.electron, chrome: process.versions.chrome },
    system: {
      os: `${os.type()} ${os.release()}`,
      cpu: os.cpus()[0]?.model.trim(),
      cores: os.cpus().length,
      memoryGb: Math.round(os.totalmem() / 1024 ** 3),
      // getGPUInfo('basic') doesn't wait for the gpu process, so its flags read as defaults
      gpuFeatures: app.getGPUFeatureStatus(),
      gpuDevices: await app
        .getGPUInfo('basic')
        .then((info) => (info as { gpuDevice?: unknown[] }).gpuDevice)
        .catch(() => undefined),
      displays: screen.getAllDisplays().map((d) => ({
        width: d.size.width,
        height: d.size.height,
        scale: d.scaleFactor,
        hz: d.displayFrequency
      }))
    },
    settings: Object.fromEntries(SETTINGS.map((key) => [key, settings[key]])),
    // process cost, every 2s whatever the window is doing
    processes: {
      summary: metrics.length ? summariseMetrics(metrics) : null,
      byState: Object.fromEntries(
        states.flatMap((state) => {
          const list = metrics.filter((s) => s.state === state)
          return list.length ? [[state, summariseMetrics(list)]] : []
        })
      ),
      samples: metrics
    },
    // smoothness, 1s windows, only while the window is shown
    frames: {
      summary: frames.length ? summariseFrames(frames) : null,
      byView: Object.fromEntries(views.map((v) => [v, summariseFrames(frames.filter((f) => f.view === v))])),
      samples: frames
    }
  }

  const options = {
    title: 'Export performance report',
    defaultPath: `Vitra performance ${stamp()}.json`,
    filters: [{ name: 'JSON', extensions: ['json'] }]
  }
  const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
  if (result.canceled || !result.filePath) return { ok: false }
  await fs.writeFile(result.filePath, JSON.stringify(report, null, 2), 'utf8')
  samples.length = 0
  return { ok: true }
}
