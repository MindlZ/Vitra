import { useEffect, useState } from 'react'
import type { ProcessMetric } from '@shared/types'

// frames are measured here; process cost is sampled by main (main/perf.ts), which
// keeps going while this window is hidden. the overlay reads main's latest sample

export interface FrameSample {
  at: number
  view: string
  fps: number
  worstFrame: number
  longTasks: number
  heapMb?: number
}

export interface OverlaySample extends FrameSample {
  processes: ProcessMetric[]
}

// 1s each; frames only exist while the window is shown
const HISTORY = 600
const METRICS_MS = 2000

const frames: FrameSample[] = []
const listeners = new Set<(sample: OverlaySample) => void>()
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
  // rAF stops while hidden: the gap on return is a pause, not a slow frame
  let resumed = true

  const onVisibility = (): void => {
    if (document.visibilityState === 'visible') resumed = true
  }
  document.addEventListener('visibilitychange', onVisibility)

  const tick = (time: number): void => {
    raf = requestAnimationFrame(tick)
    if (resumed) {
      resumed = false
      previous = windowStart = time
      count = worst = longTasks = 0
      return
    }
    count++
    worst = Math.max(worst, time - previous)
    previous = time
    if (time - windowStart < 1000) return
    // non-standard, chromium only
    const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory
    const sample: FrameSample = {
      at: Date.now(),
      view,
      fps: Math.round((count * 1000) / (time - windowStart)),
      worstFrame: Math.round(worst),
      longTasks,
      heapMb: memory && Math.round(memory.usedJSHeapSize / 1048576)
    }
    frames.push(sample)
    if (frames.length > HISTORY) frames.shift()
    listeners.forEach((listener) => listener({ ...sample, processes }))
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
    document.removeEventListener('visibilitychange', onVisibility)
  }
}

export function setPerfRecording(on: boolean): void {
  if (on) stop ??= start()
  else {
    stop?.()
    stop = null
    frames.length = 0
  }
}

export function useOverlaySample(): OverlaySample | undefined {
  const [sample, setSample] = useState<OverlaySample>()
  useEffect(() => {
    listeners.add(setSample)
    return () => {
      listeners.delete(setSample)
    }
  }, [])
  return sample
}

// main merges these with its process samples; both are cleared once it's saved
export async function exportPerfReport(): Promise<{ ok: boolean; error?: string }> {
  const result = await window.launcher.exportPerfReport([...frames])
  if (result.ok) frames.length = 0
  return result
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

// same formula as main/perf.ts and scripts/perf.ps1 (minus its gpu term)
export function score(cpu: number, memoryMb: number): number {
  const penalty = (value: number, free: number, perUnit: number, max: number): number =>
    Math.min(max, Math.max(0, (value - free) * perUnit))
  return Math.round(Math.max(0, 100 - penalty(cpu, 3, 2.5, 45) - penalty(memoryMb, 450, 0.05, 20)))
}
