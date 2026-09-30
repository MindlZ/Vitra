import { useEffect, useRef } from 'react'

/*
 * data-nav-group     navigates as one box (a card)
 * data-nav-primary   the control in a group that takes focus
 * data-nav-skip      never a stop
 * data-nav-x / -y    what X / Y press in the focused group
 * data-nav-default   first landing spot
 * data-nav-view      stepped by LB / RB
 * data-nav-subview   stepped by LT / RT (big picture's store row)
 * data-nav-dismiss   B sends Escape instead of going back
 * data-nav-center    shelf: keep focus centred
 * data-game-id       remembered so Back returns to the card
 * aria-modal="true"  scopes navigation
 *
 * XInput via Chromium: 0 A, 1 B, 2 X, 3 Y, 4 LB, 5 RB, 6 LT, 7 RT, 8 View, 9 Menu, 12-15 d-pad.
 * guide never arrives (Game Bar has it)
 */

type Dir = 'up' | 'down' | 'left' | 'right'

const A = 0
const B = 1
const X = 2
const Y = 3
const LB = 4
const RB = 5
const LT = 6
const RT = 7
const VIEW = 8
const START = 9
const DPAD: Record<number, Dir> = { 12: 'up', 13: 'down', 14: 'left', 15: 'right' }

const DEADZONE = 0.5
const REPEAT_DELAY = 380
const REPEAT_EVERY = 115
// px per frame at full tilt
const SCROLL_SPEED = 22

const FOCUSABLE =
  'button, a[href], input:not([type="hidden"]), select, textarea, [tabindex]:not([tabindex="-1"])'

interface Handlers {
  onBack: () => void
  onStart: () => void
  onView?: () => void
}

function groupOf(el: Element | null): HTMLElement | null {
  return (el?.closest('[data-nav-group]') as HTMLElement | null) ?? null
}

// measure the group, not the button: off-screen cards are content-visibility
// skipped, and measuring inside them forces layout of every card per press
function navBox(el: HTMLElement): DOMRect {
  return (groupOf(el) ?? el).getBoundingClientRect()
}

function scope(): HTMLElement {
  const modals = document.querySelectorAll<HTMLElement>('[aria-modal="true"]')
  return modals[modals.length - 1] ?? document.body
}

function navigable(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => {
    if (el.matches(':disabled')) return false
    if (el.closest('[data-nav-skip], [inert], [aria-hidden="true"]')) return false
    const group = groupOf(el)
    if (group && group.querySelector('[data-nav-primary]') && !el.hasAttribute('data-nav-primary'))
      return false
    const box = navBox(el)
    return box.width > 0 && box.height > 0
  })
}

function gap(a0: number, a1: number, b0: number, b1: number): number {
  return Math.max(0, b0 - a1, a0 - b1)
}

// lower wins. side offset weighs 3x so straight down beats a nearer diagonal
function score(from: DOMRect, to: DOMRect, dir: Dir): number {
  const fx = from.left + from.width / 2
  const fy = from.top + from.height / 2
  const tx = to.left + to.width / 2
  const ty = to.top + to.height / 2

  const ahead =
    dir === 'right' ? tx - fx : dir === 'left' ? fx - tx : dir === 'down' ? ty - fy : fy - ty
  if (ahead <= 1) return Infinity

  const horizontal = dir === 'left' || dir === 'right'
  const along = horizontal
    ? gap(from.left, from.right, to.left, to.right)
    : gap(from.top, from.bottom, to.top, to.bottom)
  const side = horizontal
    ? gap(from.top, from.bottom, to.top, to.bottom)
    : gap(from.left, from.right, to.left, to.right)
  const drift = horizontal ? Math.abs(ty - fy) : Math.abs(tx - fx)

  return along + side * 3 + drift * 0.05
}

function focusEl(el: HTMLElement | null | undefined): void {
  if (!el) return
  // focusVisible: otherwise :focus-visible won't match without a key press
  el.focus({ preventScroll: true, focusVisible: true } as FocusOptions)
  const box = groupOf(el) ?? el
  const inline = box.closest('[data-nav-center]') ? 'center' : 'nearest'
  box.scrollIntoView({ block: 'nearest', inline, behavior: 'smooth' })
}

function setNativeValue(el: HTMLInputElement | HTMLSelectElement, value: string, event: string): void {
  // prototype setter, or React's value tracking ignores the event
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, value)
  el.dispatchEvent(new Event(event, { bubbles: true }))
}

function isTextEntry(el: Element): boolean {
  return (
    el instanceof HTMLTextAreaElement ||
    (el instanceof HTMLInputElement && !['range', 'checkbox', 'radio', 'button'].includes(el.type))
  )
}

function scroller(from: Element | null): HTMLElement | null {
  const scrolls = (el: Element): el is HTMLElement =>
    el instanceof HTMLElement &&
    el.scrollHeight > el.clientHeight + 1 &&
    ['auto', 'scroll'].includes(getComputedStyle(el).overflowY)

  for (let el = from; el && el !== document.body; el = el.parentElement) {
    if (scrolls(el)) return el
  }
  return [...document.querySelectorAll('main .overflow-y-auto')].find(scrolls) ?? null
}

export function useGamepad(handlers: Handlers): void {
  const latest = useRef(handlers)
  latest.current = handlers

  useEffect(() => {
    let frame = 0
    let pressed: boolean[] = []
    let held: Dir | null = null
    let nextRepeat = 0
    let lastGameId: string | null = null

    const current = (): HTMLElement | null => {
      const el = document.activeElement
      return el instanceof HTMLElement && el !== document.body && scope().contains(el) ? el : null
    }

    const land = (): void => {
      const root = scope()
      const remembered =
        lastGameId &&
        root.querySelector<HTMLElement>(
          `[data-game-id="${CSS.escape(lastGameId)}"] [data-nav-primary]`
        )
      const stops = navigable(root)
      const fallback =
        root.querySelector<HTMLElement>('[data-nav-default]') ??
        (root === document.body ? stops.find((el) => el.closest('main')) : undefined)
      focusEl(remembered || fallback || stops[0])
    }

    const move = (dir: Dir): void => {
      const from = current()
      if (!from) return land()

      if ((dir === 'left' || dir === 'right') && from instanceof HTMLInputElement && from.type === 'range') {
        const step = Number(from.step) || 1
        const next = Math.min(
          Number(from.max || 100),
          Math.max(Number(from.min || 0), Number(from.value) + (dir === 'right' ? step : -step))
        )
        setNativeValue(from, String(next), 'input')
        return
      }

      const fromBox = navBox(from)
      const fromGroup = groupOf(from)
      let best: HTMLElement | null = null
      let bestScore = Infinity
      for (const el of navigable(scope())) {
        if (el === from || (fromGroup && fromGroup.contains(el))) continue
        const s = score(fromBox, navBox(el), dir)
        if (s < bestScore) {
          bestScore = s
          best = el
        }
      }
      focusEl(best)
    }

    const activate = (): void => {
      const el = current()
      if (!el) return land()
      const id = el.closest<HTMLElement>('[data-game-id]')?.dataset.gameId
      if (id) lastGameId = id

      if (el instanceof HTMLSelectElement) {
        // native popup can't be driven by a pad
        const next = (el.selectedIndex + 1) % el.options.length
        setNativeValue(el, el.options[next].value, 'change')
      } else if (isTextEntry(el)) {
        ;(el as HTMLInputElement).select?.()
      } else {
        el.click()
      }
    }

    const pressInGroup = (attr: string): void => {
      const el = current()
      const id = el?.closest<HTMLElement>('[data-game-id]')?.dataset.gameId
      if (id) lastGameId = id
      groupOf(el)?.querySelector<HTMLElement>(`[${attr}]`)?.click()
    }

    const cycleView = (step: number, attr = 'data-nav-view'): void => {
      const rows = [...scope().querySelectorAll<HTMLElement>(`[${attr}]`)]
      if (!rows.length) return
      const at = rows.findIndex((row) => row.getAttribute('aria-current') === 'page')
      rows[(at + step + rows.length) % rows.length].click()
    }

    const back = (): void => {
      const el = current()
      if (el && isTextEntry(el)) {
        el.blur()
        return
      }
      if (el?.closest('[data-nav-dismiss]')) {
        el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
        return
      }
      latest.current.onBack()
      // two frames: after React has closed whatever it was
      requestAnimationFrame(() => requestAnimationFrame(() => current() || land()))
    }

    const onPress = (button: number): void => {
      if (button in DPAD) return
      if (button === A) activate()
      else if (button === B) back()
      else if (button === X) pressInGroup('data-nav-x')
      else if (button === Y) pressInGroup('data-nav-y')
      else if (button === LB) cycleView(-1)
      else if (button === RB) cycleView(1)
      else if (button === LT) cycleView(-1, 'data-nav-subview')
      else if (button === RT) cycleView(1, 'data-nav-subview')
      else if (button === START) latest.current.onStart()
      else if (button === VIEW) latest.current.onView?.()
    }

    let activityAt = 0

    const poll = (time: number): void => {
      frame = requestAnimationFrame(poll)
      const pad = [...navigator.getGamepads()].find((p) => p?.connected)
      if (!pad) return

      // the press that wakes the screen saver mustn't also click something
      const idle = document.documentElement.dataset.idle === 'true'

      let dir: Dir | null = null
      let any = false
      for (let i = 0; i < pad.buttons.length; i++) {
        const down = pad.buttons[i].pressed
        if (!down) continue
        any = true
        if (DPAD[i]) dir = DPAD[i]
        if (!pressed[i] && !idle) onPress(i)
      }
      pressed = pad.buttons.map((button) => button.pressed)

      const [lx = 0, ly = 0, , ry = 0] = pad.axes
      if (!dir && Math.max(Math.abs(lx), Math.abs(ly)) > DEADZONE) {
        dir = Math.abs(lx) > Math.abs(ly) ? (lx > 0 ? 'right' : 'left') : ly > 0 ? 'down' : 'up'
      }
      if (dir) any = true

      if (idle) {
        held = dir
      } else if (dir !== held) {
        held = dir
        if (dir) {
          move(dir)
          nextRepeat = time + REPEAT_DELAY
        }
      } else if (dir && time >= nextRepeat) {
        move(dir)
        nextRepeat = time + REPEAT_EVERY
      }

      if (Math.abs(ry) > 0.2) {
        any = true
        if (!idle) scroller(current())?.scrollBy({ top: ry * SCROLL_SPEED })
      }

      if (any) {
        document.documentElement.dataset.input = 'gamepad'
        // idle.ts listens for this
        if (time - activityAt > 250) {
          activityAt = time
          window.dispatchEvent(new Event('vitra:activity'))
        }
      }
    }

    // Chromium only reports a pad after its first button press
    const start = (): void => {
      if (!frame) frame = requestAnimationFrame(poll)
    }
    const stop = (): void => {
      if ([...navigator.getGamepads()].some((p) => p?.connected)) return
      cancelAnimationFrame(frame)
      frame = 0
      pressed = []
      held = null
    }
    const toPointer = (): void => {
      if (document.documentElement.dataset.input === 'gamepad')
        document.documentElement.dataset.input = 'pointer'
    }

    window.addEventListener('gamepadconnected', start)
    window.addEventListener('gamepaddisconnected', stop)
    window.addEventListener('mousemove', toPointer)
    window.addEventListener('mousedown', toPointer)
    if ([...navigator.getGamepads()].some((p) => p?.connected)) start()

    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('gamepadconnected', start)
      window.removeEventListener('gamepaddisconnected', stop)
      window.removeEventListener('mousemove', toPointer)
      window.removeEventListener('mousedown', toPointer)
    }
  }, [])
}
