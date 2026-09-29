import { useCallback, useEffect, useRef, useState } from 'react'

/** Mouse jitter under this many pixels isn't someone using the app. */
const MOVE_THRESHOLD = 6

/**
 * The screen saver's clock: true after `minutes` without input in Vitra's
 * window. Input is the mouse (moved, pressed, wheeled), the keyboard, and the
 * controller (lib/gamepad.ts fires `vitra:activity`). A hidden window (a game
 * in front, minimised to the tray) doesn't count down; the timer restarts
 * when it's shown again. `blocked` pauses it (the splash, an open dialog).
 *
 * While idle it marks <html data-idle="true">, which the gamepad layer reads
 * to swallow the press that wakes it, and it eats the waking key here, so
 * waking never also presses a button or closes a page behind the saver.
 */
export function useIdle(
  minutes: number,
  blocked: boolean
): { idle: boolean; wake: () => void; sleep: () => void } {
  const [idle, setIdle] = useState(false)
  const idleNow = useRef(idle)
  idleNow.current = idle

  useEffect(() => {
    if (idle) document.documentElement.dataset.idle = 'true'
    else delete document.documentElement.dataset.idle
  }, [idle])

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    let lastX = -1
    let lastY = -1

    const arm = (): void => {
      clearTimeout(timer)
      if (minutes <= 0 || blocked || document.visibilityState !== 'visible') return
      timer = setTimeout(() => setIdle(true), minutes * 60_000)
    }

    const activity = (): void => {
      if (idleNow.current) setIdle(false)
      arm()
    }

    const onMove = (event: MouseEvent): void => {
      const moved = Math.abs(event.clientX - lastX) + Math.abs(event.clientY - lastY)
      lastX = event.clientX
      lastY = event.clientY
      if (moved >= MOVE_THRESHOLD) activity()
    }

    const onKey = (event: KeyboardEvent): void => {
      if (idleNow.current) {
        event.preventDefault()
        event.stopImmediatePropagation()
      }
      activity()
    }

    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') arm()
      else clearTimeout(timer)
    }

    window.addEventListener('mousemove', onMove, { passive: true })
    window.addEventListener('pointerdown', activity, true)
    window.addEventListener('wheel', activity, { passive: true })
    // Capture, so it runs before any other key handler can act on it.
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('vitra:activity', activity)
    document.addEventListener('visibilitychange', onVisibility)
    arm()

    return () => {
      clearTimeout(timer)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('pointerdown', activity, true)
      window.removeEventListener('wheel', activity)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('vitra:activity', activity)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [minutes, blocked])

  // A dialog opening ends an idle spell. (Not `minutes`: with the timer off, a
  // preview from Settings should still be able to show the saver.)
  useEffect(() => {
    if (blocked && idleNow.current) setIdle(false)
  }, [blocked])

  const wake = useCallback(() => setIdle(false), [])
  const sleep = useCallback(() => setIdle(true), [])
  return { idle, wake, sleep }
}
