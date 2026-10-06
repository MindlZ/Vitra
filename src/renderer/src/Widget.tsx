import { useEffect, useState } from 'react'
import type { WidgetState } from '@shared/api'
import type { WidgetKind } from '@shared/types'
import Lyrics from './components/Lyrics'
import Visualiser, { setVisualiserLook } from './components/Visualiser'
import { setLyricsPlaces } from './lib/lyrics'
import { setBackgroundPacing } from './lib/pace'
import { restorePalette } from './lib/theme'

// the floating widget windows (main/widget.ts). never focused and over a game on
// purpose, so background pacing is off; always the dark look, over game art
function applyColours(): void {
  restorePalette()
  document.documentElement.dataset.appearance = 'dark'
  window.dispatchEvent(new Event('vitra:palette'))
}

function useWidgetState(onState?: (state: WidgetState) => void): boolean {
  const [moving, setMoving] = useState(false)
  useEffect(() => {
    setBackgroundPacing(false)
    applyColours()
    // the main window caches palette changes in localStorage; storage events reach here
    window.addEventListener('storage', applyColours)
    const off = window.launcher.onWidgetState?.((state) => {
      onState?.(state)
      setMoving(state.moving)
    })
    return () => {
      window.removeEventListener('storage', applyColours)
      off?.()
    }
    // the handler is fixed per widget
  }, [])
  return moving
}

// move mode: the window takes the mouse; drag anywhere, then Done
function MoveFrame({ kind }: { kind: WidgetKind }) {
  return (
    <div className="drag-region absolute inset-0 flex items-start justify-end rounded-xl border border-dashed border-snow/40 bg-black/25 p-1.5">
      <button
        onClick={() => void window.launcher.moveWidget(kind, false)}
        className="no-drag rounded-md bg-black/60 px-2.5 py-1 text-[11.5px] text-snow hover:bg-black/80"
      >
        Done
      </button>
    </div>
  )
}

export function VisualiserWidget() {
  const moving = useWidgetState(setVisualiserLook)
  return (
    <div className="relative h-full w-full">
      <Visualiser className="h-full [mask-image:linear-gradient(to_right,transparent,black_15%,black_85%,transparent)]" />
      {moving && <MoveFrame kind="visualiser" />}
    </div>
  )
}

export function LyricsWidget() {
  const moving = useWidgetState()
  // the window only exists while lyrics and this widget are on, so it always shows them
  useEffect(() => setLyricsPlaces({ widget: true }), [])
  return (
    <div className="relative flex h-full w-full items-center justify-center px-4">
      <Lyrics place="widget" className="w-full" />
      {moving && <MoveFrame kind="lyrics" />}
    </div>
  )
}
