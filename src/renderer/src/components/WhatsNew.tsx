import { useEffect } from 'react'
import { X } from 'lucide-react'
import type { Release } from '../lib/changelog'

interface Props {
  release: Release
  onClose: () => void
}

export default function WhatsNew({ release, onClose }: Props) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/45 pt-[84px] backdrop-blur-[3px]"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="What's new"
        className="glass-strong animate-fade-up flex max-h-[calc(100vh-120px)] w-[440px] max-w-[calc(100vw-56px)] flex-col overflow-hidden rounded-[16px]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start gap-3 px-6 pt-6">
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-[24px] leading-tight font-bold text-ink [font-stretch:85%]">
              What's new
            </h2>
            <div className="text-[12px] tabular-nums text-muted">Version {release.version}</div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            data-nav-skip
            className="-mt-1 -mr-2 shrink-0 rounded-full p-2 text-muted transition-colors hover:bg-white/8 hover:text-ink"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <ul className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {release.items.map((item) => (
            <li key={item} className="flex items-baseline gap-3 py-1.5 text-[13px] text-dim">
              <span aria-hidden className="h-1.5 w-1.5 shrink-0 -translate-y-0.5 rounded-full bg-accent" />
              {item}
            </li>
          ))}
        </ul>

        <div className="hairline-t flex justify-end px-6 py-4">
          <button
            onClick={onClose}
            data-nav-default
            autoFocus
            className="flex h-9 items-center rounded-[10px] bg-accent px-5 text-[12px] font-semibold text-black shadow-[0_6px_20px_-6px_rgb(var(--accent-rgb)/0.9)] transition-colors hover:bg-accent-strong"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  )
}
