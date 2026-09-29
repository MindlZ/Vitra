import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { Check, ChevronDown } from 'lucide-react'

interface Option<T extends string> {
  value: T
  label: string
}

interface Props<T extends string> {
  value: T
  options: Array<Option<T>>
  onChange: (value: T) => void
  /** Accessible name, e.g. "Sort by". */
  label: string
}

/**
 * A select that looks like the launcher. The native <select>'s popup is drawn
 * by Windows and can't be styled, so this is a button and a listbox of real
 * buttons (so the controller's spatial navigation and A work unchanged).
 *
 * Keyboard: Enter/Space/arrows open it on the current choice; arrows, Home and
 * End move; Enter picks; Escape or Tab closes. A click outside, or focus
 * leaving, closes it too. data-nav-dismiss lets the controller's B close it
 * instead of stepping back out of the view (lib/gamepad.ts).
 */
export default function Dropdown<T extends string>({ value, options, onChange, label }: Props<T>) {
  const [open, setOpen] = useState(false)
  // Opens upward when the space below (inside whatever scrolls around it, e.g.
  // a Settings pane) can't fit the list.
  const [upward, setUpward] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const listId = useId()
  const current = options.find((option) => option.value === value) ?? options[0]

  const optionButtons = (): HTMLButtonElement[] =>
    [...(root.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? [])]

  const close = (refocus: boolean): void => {
    setOpen(false)
    if (refocus) trigger.current?.focus()
  }

  const show = (): void => {
    const rect = trigger.current?.getBoundingClientRect()
    if (rect) {
      let bottom = window.innerHeight
      for (let el = root.current?.parentElement; el; el = el.parentElement) {
        if (/(auto|scroll|hidden)/.test(getComputedStyle(el).overflowY)) {
          bottom = Math.min(bottom, el.getBoundingClientRect().bottom)
          break
        }
      }
      // 34px per option plus the menu's padding and gap.
      const needed = options.length * 34 + 16
      setUpward(bottom - rect.bottom < needed && rect.top > needed)
    }
    setOpen(true)
  }

  // Land on the current choice when the menu opens.
  useEffect(() => {
    if (!open) return
    const buttons = optionButtons()
    const index = Math.max(0, options.findIndex((option) => option.value === value))
    buttons[index]?.focus()
    // Only on opening; moving focus afterwards is the arrow keys' job.
  }, [open])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent): void => {
      if (!root.current?.contains(event.target as Node)) close(false)
    }
    window.addEventListener('pointerdown', onPointerDown)
    return () => window.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  const onTriggerKey = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      show()
    }
  }

  const onMenuKey = (event: KeyboardEvent<HTMLDivElement>): void => {
    const buttons = optionButtons()
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement)
    const move = (index: number): void => buttons[(index + buttons.length) % buttons.length]?.focus()

    if (event.key === 'ArrowDown') move(at + 1)
    else if (event.key === 'ArrowUp') move(at - 1)
    else if (event.key === 'Home') move(0)
    else if (event.key === 'End') move(buttons.length - 1)
    else if (event.key === 'Escape') close(true)
    else if (event.key === 'Tab') {
      setOpen(false)
      return
    } else return

    event.preventDefault()
    // Escape here means "close the menu", not "close the page behind it".
    event.stopPropagation()
  }

  return (
    <div
      ref={root}
      className="relative"
      data-nav-dismiss={open || undefined}
      onBlur={(event) => {
        if (open && !root.current?.contains(event.relatedTarget as Node | null)) setOpen(false)
      }}
    >
      <button
        ref={trigger}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={`${label}: ${current?.label}`}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={onTriggerKey}
        className={`glass-btn flex h-8 items-center gap-1.5 rounded-[9px] pr-2 pl-2.5 text-[12px] transition-colors ${
          open ? 'text-ink' : 'text-dim hover:text-ink'
        }`}
      >
        {current?.label}
        <ChevronDown
          className={`h-3.5 w-3.5 text-muted transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div
          id={listId}
          role="listbox"
          aria-label={label}
          onKeyDown={onMenuKey}
          className={`glass-strong animate-fade-up absolute right-0 z-40 flex min-w-[172px] flex-col gap-0.5 rounded-[12px] p-1 ${
            upward ? 'bottom-[calc(100%+6px)]' : 'top-[calc(100%+6px)]'
          }`}
        >
          {options.map((option) => {
            const selected = option.value === value
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => {
                  onChange(option.value)
                  close(true)
                }}
                className={`flex h-8 items-center justify-between gap-4 rounded-[8px] px-2.5 text-left text-[12.5px] outline-none transition-colors hover:bg-white/7 focus-visible:bg-white/9 focus-visible:text-ink ${
                  selected ? 'text-ink' : 'text-dim hover:text-ink'
                }`}
              >
                {option.label}
                {selected && <Check className="h-3.5 w-3.5 shrink-0 text-accent" />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
