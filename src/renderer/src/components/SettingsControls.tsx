import { useState, type CSSProperties, type ReactNode } from 'react'
import { Eye, EyeOff, Loader2, Trash2 } from 'lucide-react'
import { paletteFromHue } from '@shared/oklch'

export function Card({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="mb-6 last:mb-0">
      {title && <h4 className="mb-2 px-1 text-[12px] font-medium text-dim">{title}</h4>}
      <div className="glass-soft rounded-[12px] px-4">{children}</div>
    </section>
  )
}

export function Row({ label, hint, children }: { label: string; hint?: ReactNode; children?: ReactNode }) {
  return (
    <div className="hairline-b flex items-center gap-5 py-3.5 last:border-0">
      <div className="min-w-0 flex-1">
        <div className="text-[13px] text-ink">{label}</div>
        {hint && <div className="mt-1 text-[11.5px] leading-relaxed text-muted">{hint}</div>}
      </div>
      {children && <div className="flex shrink-0 items-center gap-2">{children}</div>}
    </div>
  )
}

export function Switch({
  label,
  checked,
  onChange
}: {
  label: string
  checked: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`flex h-[20px] w-[34px] shrink-0 items-center rounded-full border transition-colors ${
        checked
          ? 'border-accent/60 bg-accent/25 shadow-[0_0_14px_-2px_rgb(var(--accent-rgb)/0.6)]'
          : 'border-white/10 bg-white/5'
      }`}
    >
      <span
        className={`h-[13px] w-[13px] rounded-full transition-transform duration-200 ${
          checked ? 'translate-x-[18px] bg-accent' : 'translate-x-[3px] bg-muted'
        }`}
      />
    </button>
  )
}

export function WallpaperTile({
  label,
  selected,
  onClick,
  children
}: {
  label: string
  selected: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      role="radio"
      aria-checked={selected}
      onClick={onClick}
      className="group flex w-full min-w-0 flex-col gap-1.5 text-left"
    >
      <span
        className={`block aspect-[16/10] w-full overflow-hidden rounded-[9px] transition-shadow duration-200 ${
          selected
            ? 'ring-2 ring-accent ring-offset-2 ring-offset-panel'
            : 'ring-1 ring-white/10 group-hover:ring-white/25'
        }`}
      >
        {children}
      </span>
      <span className={`truncate text-[11.5px] ${selected ? 'text-ink' : 'text-muted group-hover:text-dim'}`}>
        {label}
      </span>
    </button>
  )
}

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange
}: {
  label: string
  value: T
  options: Array<{ value: T; label: string }>
  onChange: (value: T) => void
}) {
  return (
    <div role="radiogroup" aria-label={label} className="glass-soft inline-flex rounded-[10px] p-1">
      {options.map((option) => {
        const selected = value === option.value
        return (
          <button
            key={option.value}
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.value)}
            className={`h-7 rounded-[7px] px-3.5 text-[12px] transition-colors ${
              selected ? 'bg-white/12 text-ink' : 'text-dim hover:text-ink'
            }`}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

export function Slider({
  label,
  readout,
  min,
  max,
  step,
  value,
  track,
  onChange
}: {
  label: string
  readout: string
  min: number
  max: number
  step: number
  value: number
  // a css background for the track, else the default one
  track?: string
  onChange: (value: number) => void
}) {
  return (
    <div className="hairline-b py-4 last:border-0">
      <div className="mb-3 flex items-baseline justify-between">
        <span className="text-[13px] text-ink">{label}</span>
        <span className="text-[11.5px] tabular-nums text-dim">{readout}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        onChange={(event) => onChange(Number(event.target.value))}
        className="vitra-range w-full"
        style={track ? ({ '--range-track': track } as CSSProperties) : undefined}
      />
    </div>
  )
}

// pure red needs ~0.26
export const MAX_CHROMA = 0.26

// drawn with the same gamut fallback as the palette, so the track shows what you get
export function hueTrack(chroma: number): string {
  const stops = Array.from({ length: 19 }, (_, i) => paletteFromHue(i * 20, chroma).accent)
  return `linear-gradient(to right, ${stops.join(', ')})`
}

export function chromaTrack(hue: number): string {
  const stops = Array.from({ length: 6 }, (_, i) => paletteFromHue(hue, (i / 5) * MAX_CHROMA).accent)
  return `linear-gradient(to right, ${stops.join(', ')})`
}

export function TileImage({ src }: { src: string }) {
  return (
    <img
      src={src}
      alt=""
      decoding="async"
      draggable={false}
      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.04]"
    />
  )
}

export function TilePlaceholder({ icon }: { icon: ReactNode }) {
  return (
    <span className="flex h-full w-full items-center justify-center rounded-[9px] border border-dashed border-white/15 text-muted transition-colors group-hover:text-dim">
      {icon}
    </span>
  )
}

export function ToggleRow({
  label,
  hint,
  checked,
  onChange
}: {
  label: string
  hint?: string
  checked: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <Row label={label} hint={hint}>
      <Switch label={label} checked={checked} onChange={onChange} />
    </Row>
  )
}

export const quietButton =
  'glass-btn flex h-9 shrink-0 items-center gap-2 rounded-[10px] px-3 text-[12px] text-dim transition-colors hover:text-ink'

export function BackupRow({
  label,
  action,
  icon,
  done,
  run
}: {
  label: string
  action: string
  icon: ReactNode
  done: string
  run: () => Promise<{ ok: boolean; error?: string }> | undefined
}) {
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<string>()

  return (
    <Row label={label} hint={status}>
      <button
        disabled={busy}
        onClick={() => {
          setBusy(true)
          setStatus(undefined)
          void Promise.resolve(run())
            .then((result) => {
              // no error = cancelled
              if (result?.ok) setStatus(done)
              else if (result?.error) setStatus(result.error)
            })
            .catch((err: Error) => setStatus(err.message))
            .finally(() => setBusy(false))
        }}
        className={quietButton}
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : icon}
        {action}
      </button>
    </Row>
  )
}

// write-only: main never sends a key back. commits on blur so a half-typed key
// is never saved and used
export function KeyField({
  label,
  hint,
  saved,
  onCommit
}: {
  label: string
  hint: string
  saved: boolean
  onCommit: (value: string | undefined) => void
}) {
  const [draft, setDraft] = useState('')
  const [revealed, setRevealed] = useState(false)

  const commit = (): void => {
    const next = draft.trim()
    // empty = leave it; Remove deletes
    if (!next) return
    onCommit(next)
    setDraft('')
    setRevealed(false)
  }

  return (
    <div className="hairline-b py-4 last:border-0">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="text-[13px] text-ink">{label}</div>
        <span
          className={`flex items-center gap-1.5 text-[11px] ${saved ? 'text-dim' : 'text-muted'}`}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${saved ? 'bg-accent' : 'bg-white/20'}`}
            aria-hidden
          />
          {saved ? 'Saved' : 'Not set'}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <input
          type={revealed ? 'text' : 'password'}
          value={draft}
          spellCheck={false}
          autoComplete="off"
          placeholder={saved ? 'Saved (encrypted). Type to replace' : 'Paste a key'}
          aria-label={label}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur()
          }}
          className="glass-btn h-9 min-w-0 flex-1 rounded-[10px] px-3 font-mono text-[12px] text-ink placeholder:font-sans placeholder:text-muted"
        />
        <button
          type="button"
          onClick={() => setRevealed((shown) => !shown)}
          disabled={!draft}
          aria-label={revealed ? `Hide ${label}` : `Show ${label}`}
          className="glass-btn flex h-9 w-9 items-center justify-center rounded-[10px] text-muted hover:text-ink"
        >
          {revealed ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
        </button>
        {saved && (
          <button
            type="button"
            onClick={() => onCommit(undefined)}
            aria-label={`Remove ${label}`}
            title={`Remove ${label}`}
            className="glass-btn flex h-9 items-center gap-1.5 rounded-[10px] px-2.5 text-[12px] text-muted hover:text-ink"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Remove
          </button>
        )}
      </div>
      <p className="mt-2 text-[11.5px] leading-relaxed text-muted">{hint}</p>
    </div>
  )
}
