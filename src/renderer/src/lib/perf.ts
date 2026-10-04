import { useEffect, useState } from 'react'
import type { ProcessMetric } from '@shared/types'

// one recorder behind the overlay and the export. single poller on purpose:
// getAppMetrics' cpu is "since the last call", so two callers would split it

export interface PerfSample {
  at: number
  view: string
  focused: boolean
  fps: number
  worstFrame: number
  longTasks: number
  heapMb?: number
  // latest metrics poll; cpu = % of one core
  processes: ProcessMetric[]
}

const HISTORY = 120
const METRICS_MS = 2000

const history: PerfSample[] = []
const listeners = new Set<(sample: PerfSample) => void>()
let view = 'home'
let stop: (() => void) | null = null

export function setPerfView(next: string): void {
  view = next
}

function start(): () => void {
  let raf = 0
  let count = 0
  let worst = 0
  let previous = performance.now()
  let windowStart = previous
  let longTasks = 0
  let processes: ProcessMetric[] = []

  const tick = (time: number): void => {
    raf = requestAnimationFrame(tick)
    count++
    worst = Math.max(worst, time - previous)
    previous = time
    if (time - windowStart < 1000) return
    // non-standard, chromium only
    const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory
    const sample: PerfSample = {
      at: Date.now(),
      view,
      focused: document.hasFocus(),
      fps: Math.round((count * 1000) / (time - windowStart)),
      worstFrame: Math.round(worst),
      longTasks,
      heapMb: memory && Math.round(memory.usedJSHeapSize / 1048576),
      processes
    }
    history.push(sample)
    if (history.length > HISTORY) history.shift()
    listeners.forEach((listener) => listener(sample))
    count = 0
    worst = 0
    longTasks = 0
    windowStart = time
  }
  raf = requestAnimationFrame(tick)

  let observer: PerformanceObserver | undefined
  try {
    observer = new PerformanceObserver((list) => {
      longTasks += list.getEntries().length
    })
    observer.observe({ type: 'longtask', buffered: false })
  } catch {
    // longtask unsupported
  }

  const poll = (): void => {
    void window.launcher.getMetrics?.().then((next) => {
      processes = next
    })
  }
  poll()
  const timer = setInterval(poll, METRICS_MS)

  return () => {
    cancelAnimationFrame(raf)
    observer?.disconnect()
    clearInterval(timer)
  }
}

export function setPerfRecording(on: boolean): void {
  if (on) stop ??= start()
  else {
    stop?.()
    stop = null
    history.length = 0
  }
}

export function usePerfSample(): PerfSample | undefined {
  const [sample, setSample] = useState<PerfSample | undefined>(history[history.length - 1])
  useEffect(() => {
    listeners.add(setSample)
    return () => {
      listeners.delete(setSample)
    }
  }, [])
  return sample
}

export function roleOf(type: string): string {
  return type === 'Browser' ? 'main' : type === 'Tab' ? 'renderer' : type === 'GPU' ? 'gpu' : 'other'
}

export function totals(processes: ProcessMetric[]): { cpu: number; memoryMb: number } {
  let cpu = 0
  let memoryMb = 0
  for (const p of processes) {
    cpu += p.cpu
    memoryMb += p.memoryMb
  }
  return { cpu, memoryMb }
}

// same formula as scripts/perf.ps1, minus the gpu term (no counter in here)
export function score(cpu: number, memoryMb: number): number {
  const penalty = (value: number, free: number, perUnit: number, max: number): number =>
    Math.min(max, Math.max(0, (value - free) * perUnit))
  return Math.round(Math.max(0, 100 - penalty(cpu, 3, 2.5, 45) - penalty(memoryMb, 450, 0.05, 20)))
}

const average = (values: number[]): number =>
  values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : 0

const round = (value: number): number => Math.round(value * 10) / 10

function percentile(values: number[], p: number): number {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]
}

function summarise(samples: PerfSample[]) {
  // the first poll's cpu is always 0
  const measured = samples.filter((s) => s.processes.length && totals(s.processes).cpu > 0)
  const cpu = average(measured.map((s) => totals(s.processes).cpu))
  const memoryMb = Math.max(0, ...samples.map((s) => totals(s.processes).memoryMb))
  const byRole: Record<string, number> = {}
  for (const s of measured) {
    for (const p of s.processes) byRole[roleOf(p.type)] = (byRole[roleOf(p.type)] ?? 0) + p.cpu
  }
  for (const role of Object.keys(byRole)) byRole[role] = round(byRole[role] / (measured.length || 1))
  return {
    seconds: samples.length,
    fps: round(average(samples.map((s) => s.fps))),
    worstFrameP95: percentile(samples.map((s) => s.worstFrame), 0.95),
    worstFrameMax: Math.max(0, ...samples.map((s) => s.worstFrame)),
    longTasks: samples.reduce((sum, s) => sum + s.longTasks, 0),
    cpu: round(cpu),
    cpuByRole: byRole,
    memoryMb: Math.round(memoryMb),
    score: score(cpu, memoryMb)
  }
}

export function perfReport(): object | null {
  if (!history.length) return null
  const samples = [...history]
  const views = [...new Set(samples.map((s) => s.view))]
  return {
    summary: summarise(samples),
    byView: Object.fromEntries(views.map((v) => [v, summarise(samples.filter((s) => s.view === v))])),
    samples
  }
}
