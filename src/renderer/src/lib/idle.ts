import { useCallback, useEffect, useRef, useState } from 'react'

// px; less is mouse jitter
const MOVE_THRESHOLD = 6

// data-idle on <html> lets gamepad.ts swallow the waking press; the waking key is eaten here
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
    // capture: before any other key handler sees it
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

  // not on `minutes`: the Settings preview must work with the timer off
  useEffect(() => {
    if (blocked && idleNow.current) setIdle(false)
  }, [blocked])

  const wake = useCallback(() => setIdle(false), [])
  const sleep = useCallback(() => setIdle(true), [])
  return { idle, wake, sleep }
}
