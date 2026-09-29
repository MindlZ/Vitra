import { useEffect } from 'react'
import { AlertTriangle, X } from 'lucide-react'

interface Props {
  message: string
  onDismiss: () => void
}

export default function Toast({ message, onDismiss }: Props) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, 6000)
    return () => clearTimeout(timer)
  }, [message, onDismiss])

  return (
    <div className="glass-strong animate-fade-up fixed right-6 bottom-6 z-50 flex max-w-[400px] items-start gap-3 rounded-[12px] px-4 py-3.5">
      <AlertTriangle className="mt-px h-4 w-4 shrink-0 text-danger" />
      <p className="min-w-0 flex-1 text-[12px] leading-relaxed text-dim">{message}</p>
      <button
        onClick={onDismiss}
        aria-label="Dismiss"
        className="-mt-1 -mr-1.5 shrink-0 rounded-full p-1.5 text-muted transition-colors hover:bg-white/8 hover:text-ink"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}
