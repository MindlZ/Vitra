import { useEffect, useRef } from 'react'

/*
 * Controller support, as a thin layer over ordinary DOM focus: the d-pad (or
 * left stick) moves focus spatially to the nearest real control in that
 * direction, and the face buttons click things. Nothing in the UI has to know
 * about controllers beyond a few data attributes:
 *
 *   data-nav-group    a unit that navigates as one box (a library card)
 *   data-nav-primary  the control inside a group that takes focus
 *   data-nav-skip     never a stop (a card's hover-only play/star buttons)
 *   data-nav-x / -y   what X / Y press inside the focused group
 *   data-nav-default  where focus lands when nothing is focused yet
 *   data-nav-view     sidebar rows (or a dialog's sections), stepped through by LB / RB
 *   data-nav-dismiss  an open menu: B sends it Escape instead of stepping back
 *   data-nav-center   a horizontal shelf: focus scrolls the item to its centre
 *
 * View toggles big picture mode.
 *   data-game-id      remembered, so focus returns to the card after Back
 *
 * A dialog marked aria-modal="true" keeps navigation inside it.
 *
 * Standard mapping (what Chromium reports for XInput pads):
 * 0 A, 1 B, 2 X, 3 Y, 4 LB, 5 RB, 8 View, 9 Menu, 12-15 d-pad. The Xbox
 * (guide) button is reserved by Windows for the Game Bar and never arrives.
 */

type Dir = 'up' | 'down' | 'left' | 'right'

const A = 0
const B = 1
const X = 2
const Y = 3
const LB = 4
const RB = 5
const VIEW = 8
const START = 9
const DPAD: Record<number, Dir> = { 12: 'up', 13: 'down', 14: 'left', 15: 'right' }

/** Stick travel before it counts as a direction. */
const DEADZONE = 0.5
/** Hold a direction: one step, a pause, then a steady repeat. */
const REPEAT_DELAY = 380
const REPEAT_EVERY = 115
/** Right stick scroll speed, px per frame at full tilt. */
const SCROLL_SPEED = 22

const FOCUSABLE =
  'button, a[href], input:not([type="hidden"]), select, textarea, [tabindex]:not([tabindex="-1"])'

interface Handlers {
  /** B: close whatever is on top, or step back towards Home. */
  onBack: () => void
  /** Menu / Start. */
  onStart: () => void
  /** View (the two-squares button): toggles big picture mode. */
  onView?: () => void
}

function groupOf(el: Element | null): HTMLElement | null {
  return (el?.closest('[data-nav-group]') as HTMLElement | null) ?? null
}

/**
 * The box navigation measures. A card's group is used rather than its button
 * because off-screen cards are content-visibility skipped: measuring inside
 * them would force layout of every card on each press.
 */
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
    // In a group, only its primary control is a stop.
    const group = groupOf(el)
    if (group && group.querySelector('[data-nav-primary]') && !el.hasAttribute('data-nav-primary'))
      return false
    const box = navBox(el)
    return box.width > 0 && box.height > 0
  })
}

/** Gap between two ranges on one axis; 0 if they overlap. */
function gap(a0: number, a1: number, b0: number, b1: number): number {
  return Math.max(0, b0 - a1, a0 - b1)
}

/**
 * Lower is better; Infinity means "not in that direction". Distance along the
 * direction of travel, plus a heavy penalty for being off to the side, so the
 * card directly below beats a nearer one diagonally across.
 */
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
  // focusVisible makes :focus-visible match even though no key was pressed.
  el.focus({ preventScroll: true, focusVisible: true } as FocusOptions)
  const box = groupOf(el) ?? el
  // A shelf keeps the focused cover centred rather than creeping to the edge.
  const inline = box.closest('[data-nav-center]') ? 'center' : 'nearest'
  box.scrollIntoView({ block: 'nearest', inline, behavior: 'smooth' })
}

function setNativeValue(el: HTMLInputElement | HTMLSelectElement, value: string, event: string): void {
  // React tracks the value itself; going through the prototype setter makes
  // it see the change when the event fires.
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

/** The scrollable ancestor the right stick should move. */
function scroller(from: Element | null): HTMLElement | null {
  const scrolls = (el: Element): el is HTMLElement =>
    el instanceof HTMLElement &&
    el.scrollHeight > el.clientHeight + 1 &&
    ['auto', 'scroll'].includes(getComputedStyle(el).overflowY)

  for (let el = from; el && el !== document.body; el = el.parentElement) {
    if (scrolls(el)) return el
  }
  // Nothing focused inside a scroller: the main pane's own scroller.
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

    /** Somewhere sensible to start: the last card, a marked default, or the first stop. */
    const land = (): void => {
      const root = scope()
      const remembered =
        lastGameId &&
        root.querySelector<HTMLElement>(
          `[data-game-id="${CSS.escape(lastGameId)}"] [data-nav-primary]`
        )
      const stops = navigable(root)
      // A dialog (big picture) can mark its own default too.
      const fallback =
        root.querySelector<HTMLElement>('[data-nav-default]') ??
        (root === document.body ? stops.find((el) => el.closest('main')) : undefined)
      focusEl(remembered || fallback || stops[0])
    }

    const move = (dir: Dir): void => {
      const from = current()
      if (!from) return land()

      // A slider or dropdown takes left/right as a value change.
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
        // The native popup can't be driven by a pad, so A steps through options.
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

    // The views in front of you: the sidebar, or a dialog's own sections
    // (Settings), since a modal scopes which rows count.
    const cycleView = (step: number): void => {
      const rows = [...scope().querySelectorAll<HTMLElement>('[data-nav-view]')]
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
      // An open menu (Dropdown) closes itself rather than the view behind it.
      if (el?.closest('[data-nav-dismiss]')) {
        el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
        return
      }
      latest.current.onBack()
      // Once React has closed whatever it was, put focus back on the card.
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
      else if (button === START) latest.current.onStart()
      else if (button === VIEW) latest.current.onView?.()
    }

    let activityAt = 0

    const poll = (time: number): void => {
      frame = requestAnimationFrame(poll)
      const pad = [...navigator.getGamepads()].find((p) => p?.connected)
      if (!pad) return

      // While the screen saver is up, input only wakes it: the press that
      // wakes it mustn't also click whatever was focused underneath.
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
        // Held through the wake-up, so the direction doesn't fire on release
        // of the screen saver either.
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
        // The screen saver's idle timer listens for this (lib/idle.ts).
        if (time - activityAt > 250) {
          activityAt = time
          window.dispatchEvent(new Event('vitra:activity'))
        }
      }
    }

    // Polling only runs while a pad is connected. Chromium only reports a pad
    // after its first button press, which is also when this fires.
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
    // Any mouse use hands the UI back to the pointer (and shows the cursor).
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
