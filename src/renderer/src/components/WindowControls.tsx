import { useEffect, useState, type ReactNode } from 'react'
import type { WindowAction } from '@shared/types'

// full-height hit areas, the last one reaching the corner (Fitts).
// data-nav-skip: a stray A on close would hide the window

function Glyph({ children }: { children: ReactNode }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      stroke="currentColor"
      strokeWidth="1"
      aria-hidden
    >
      {children}
    </svg>
  )
}

function Control({
  label,
  action,
  corner = false,
  children
}: {
  label: string
  action: WindowAction
  corner?: boolean
  children: ReactNode
}) {
  return (
    <button
      onClick={() => void window.launcher.windowControl?.(action)}
      aria-label={label}
      title={label}
      tabIndex={-1}
      data-nav-skip
      className={`group flex h-[52px] items-center justify-center ${corner ? 'w-[50px] pr-1.5' : 'w-11'}`}
    >
      <span className="flex h-8 w-9 items-center justify-center rounded-[9px] transition-colors duration-150 group-hover:bg-white/7 group-hover:text-ink group-active:bg-white/4">
        {children}
      </span>
    </button>
  )
}

export default function WindowControls() {
  const [maximized, setMaximized] = useState(false)
  const [focused, setFocused] = useState(() => document.hasFocus())

  useEffect(() => {
    // renderer can hot-reload ahead of preload
    void window.launcher.isMaximized?.().then(setMaximized)
    const off = window.launcher.onMaximizedChanged?.(setMaximized)
    const onFocus = (): void => setFocused(true)
    const onBlur = (): void => setFocused(false)
    window.addEventListener('focus', onFocus)
    window.addEventListener('blur', onBlur)
    return () => {
      off?.()
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('blur', onBlur)
    }
  }, [])

  return (
    <div
      className={`no-drag flex self-stretch transition-colors duration-200 ${
        focused ? 'text-dim' : 'text-muted/70'
      }`}
    >
      <Control label="Minimise" action="minimize">
        <Glyph>
          <path d="M0 5.5h10" />
        </Glyph>
      </Control>
      <Control label={maximized ? 'Restore' : 'Maximise'} action="toggle-maximize">
        <Glyph>
          {maximized ? (
            <>
              <rect x="0.5" y="2.5" width="7" height="7" rx="1" />
              <path d="M2.5 2.5V1.5a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-1" />
            </>
          ) : (
            <rect x="0.5" y="0.5" width="9" height="9" rx="1.5" />
          )}
        </Glyph>
      </Control>
      <Control label="Close" action="close" corner>
        <Glyph>
          <path d="M0.5 0.5l9 9M9.5 0.5l-9 9" />
        </Glyph>
      </Control>
    </div>
  )
}
