import { roleOf, score, totals, useOverlaySample } from '../lib/perf'

const ROLES = ['main', 'renderer', 'gpu', 'other']
const LABELS: Record<string, string> = { main: 'Main', renderer: 'Renderer', gpu: 'GPU', other: 'Other' }

export default function PerfOverlay() {
  const sample = useOverlaySample()
  if (!sample) return null

  const byRole = new Map<string, { cpu: number; memoryMb: number }>()
  for (const p of sample.processes) {
    const row = byRole.get(roleOf(p.type)) ?? { cpu: 0, memoryMb: 0 }
    row.cpu += p.cpu
    row.memoryMb += p.memoryMb
    byRole.set(roleOf(p.type), row)
  }
  const total = totals(sample.processes)

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed top-[60px] right-3 z-[70] w-[200px] rounded-[10px] border border-line bg-base/85 px-3 py-2.5 font-mono text-[11px] leading-[1.6] text-dim tabular-nums shadow-[0_8px_24px_-12px_var(--dialog-shadow)]"
    >
      <Line label="FPS" value={String(sample.fps)} />
      <Line label="Worst frame" value={`${sample.worstFrame} ms`} warn={sample.worstFrame > 50} />
      <Line label="Long tasks" value={String(sample.longTasks)} warn={sample.longTasks > 0} />
      {sample.heapMb !== undefined && <Line label="JS heap" value={`${sample.heapMb} MB`} />}
      {sample.processes.length > 0 && (
        <>
          <div className="my-1.5 border-t border-line-soft" />
          <div className="text-muted">CPU · MB</div>
          {ROLES.flatMap((role) => {
            const row = byRole.get(role)
            return row
              ? [<Line key={role} label={LABELS[role]} value={`${row.cpu.toFixed(1)}% · ${row.memoryMb.toFixed(0)}`} />]
              : []
          })}
          <Line label="Total" value={`${total.cpu.toFixed(1)}% · ${total.memoryMb.toFixed(0)}`} />
          <Line label="Score" value={String(score(total.cpu, total.memoryMb))} />
        </>
      )}
    </div>
  )
}

function Line({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <span>{label}</span>
      <span className={warn ? 'text-danger' : 'text-ink'}>{value}</span>
    </div>
  )
}
