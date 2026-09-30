import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  AppWindow,
  ChartColumn,
  ChevronDown,
  ChevronUp,
  ChevronsLeft,
  ChevronsRight,
  Clock,
  EyeOff,
  Gamepad2,
  HardDriveDownload,
  House,
  LayoutGrid,
  Star,
  Tag as TagIcon
} from 'lucide-react'
import CoffeeIcon from './CoffeeIcon'
import { GAME_SOURCES, type Game, type ProgramsView } from '@shared/types'
import { formatPlaytimeShort, hasSource, inLibrary, isSoftware, sourceLabel } from '../lib/format'
import StoreLogo, { type StoreLogoKind } from './StoreLogo'
import { playSound } from '../lib/sound'

export type Filter = string

interface Props {
  games: Game[]
  value: Filter
  onChange: (value: Filter) => void
  collapsed: boolean
  onToggleCollapsed: () => void
  programsView: ProgramsView
  // slid away for the screen saver
  concealed?: boolean
  slow?: boolean
}

export const KOFI_URL ='https://ko-fi.com/mindlz'

interface Row {
  key: Filter
  label: string
  count?: number
  icon?: typeof LayoutGrid
}

const HOME_ROWS: Row[] = [
  { key: 'home', label: 'Home', icon: House },
  { key: 'stats', label: 'Stats', icon: ChartColumn }
]

const STORE_LOGOS: Partial<Record<Filter, StoreLogoKind>> = {
  'source:steam': 'steam',
  'source:epic': 'epic',
  'source:gog': 'gog',
  'source:xbox': 'xbox',
  'source:battlenet': 'battlenet',
  'source:ea': 'ea',
  'source:ubisoft': 'ubisoft',
  'source:riot': 'riot'
}

function Monogram({ label, active }: { label: string; active: boolean }) {
  return (
    <span
      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-[6px] text-[10px] font-semibold ${
        active ? 'bg-accent/20 text-accent' : 'bg-white/8 text-dim'
      }`}
    >
      {label.replace(/[^\p{L}\p{N}]/gu, '').slice(0, 2) || '?'}
    </span>
  )
}

function Section({
  title,
  rows,
  value,
  onChange,
  collapsed,
  carousel = false
}: {
  title?: string
  rows: Row[]
  value: Filter
  onChange: (value: Filter) => void
  collapsed: boolean
  carousel?: boolean
}) {
  if (!rows.length) return null
  if (carousel && rows.length > CAROUSEL_MIN) {
    return (
      <div className={collapsed ? 'mb-3' : 'mb-7'}>
        {title &&
          (collapsed ? (
            <div className="hairline-t mx-4 mb-3" />
          ) : (
            <div className="mb-1.5 px-3.5 text-[12px] font-medium text-muted">{title}</div>
          ))}
        <StoreCarousel rows={rows} value={value} onChange={onChange} collapsed={collapsed} />
      </div>
    )
  }

  return (
    <div className={collapsed ? 'mb-3' : 'mb-7'}>
      {title &&
        (collapsed ? (
          <div className="hairline-t mx-4 mb-3" />
        ) : (
          <div className="mb-1.5 px-3.5 text-[12px] font-medium text-muted">{title}</div>
        ))}
      <nav className="flex flex-col gap-0.5 px-2">
        {rows.map((row) => {
          const active = row.key === value
          return (
            <button
              key={row.key}
              onClick={() => onChange(row.key)}
              data-nav-view={row.key}
              aria-current={active ? 'page' : undefined}
              title={collapsed ? `${row.label}${row.count != null ? ` (${row.count})` : ''}` : undefined}
              aria-label={collapsed ? row.label : undefined}
              className={`group relative flex h-[34px] items-center gap-2.5 rounded-[9px] text-left text-[13px] transition-all duration-150 ${
                collapsed ? 'justify-center px-0' : 'px-2.5'
              } ${
                active
                  ? 'bg-white/8 text-ink shadow-[inset_0_1px_0_rgba(255,255,255,0.07)]'
                  : 'text-dim hover:bg-white/5 hover:text-ink'
              }`}
            >
              {active && <span className="vitra-sun absolute top-1/2 -left-[5px] h-[7px] w-[7px] -translate-y-1/2" />}
              <RowContent row={row} active={active} collapsed={collapsed} />
            </button>
          )
        })}
      </nav>
    </div>
  )
}

const CAROUSEL_MIN = 4

// per step from the front. past two steps a row is hidden but stays in the DOM for LB/RB
const DEPTH = [
  { y: 0, scale: 1, fade: 1 },
  { y: 31, scale: 0.92, fade: 0.55 },
  { y: 58, scale: 0.84, fade: 0.25 }
]
const ROW_HEIGHT = 34
// room for a "more" chevron at each end
const INDICATOR = 14
const CAROUSEL_HEIGHT =
  ROW_HEIGHT + 2 * (DEPTH[2].y + (ROW_HEIGHT * DEPTH[2].scale) / 2 - ROW_HEIGHT / 2) + 2 * INDICATOR
// a mouse notch is ~100; trackpads send lots of small deltas
const WHEEL_STEP = 60

// rows are frosted (backdrop-blur) so the ones tucked behind blur out instead of
// needing a solid bg, which looked like holes on bright wallpapers
function StoreCarousel({
  rows,
  value,
  onChange,
  collapsed
}: {
  rows: Row[]
  value: Filter
  onChange: (value: Filter) => void
  collapsed: boolean
}) {
  const count = rows.length
  const activeIndex = rows.findIndex((row) => row.key === value)
  const [front, setFront] = useState(Math.max(0, activeIndex))
  const reach = DEPTH.length - 1
  const moreAbove = front - reach > 0
  const moreBelow = front + reach < count - 1
  const box = useRef<HTMLDivElement>(null)
  const frontButton = useRef<HTMLButtonElement>(null)
  const wheel = useRef(0)

  useEffect(() => {
    if (activeIndex >= 0) setFront(activeIndex)
  }, [activeIndex])

  // the wheel listener is attached once
  const latest = useRef({ front, rows, onChange })
  useLayoutEffect(() => {
    latest.current = { front, rows, onChange }
  })

  const turn = useCallback((step: number): void => {
    const { front: at, rows: list, onChange: open } = latest.current
    // stops at the ends, no wrapping
    const next = Math.min(list.length - 1, Math.max(0, at + step))
    if (next === at) return
    // several wheel steps can land before the next render
    latest.current.front = next
    setFront(next)
    open(list[next].key)
    playSound('store-scroll')
  }, [])

  // native + non-passive: React's onWheel can't preventDefault the sidebar scroll
  useEffect(() => {
    const el = box.current
    if (!el) return
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault()
      wheel.current += event.deltaY
      while (Math.abs(wheel.current) >= WHEEL_STEP) {
        const step = Math.sign(wheel.current)
        wheel.current -= step * WHEEL_STEP
        turn(step)
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [turn])

  return (
    <div
      ref={box}
      role="group"
      aria-roledescription="carousel"
      className="relative px-2"
      style={{ height: CAROUSEL_HEIGHT }}
      onKeyDown={(event) => {
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
        event.preventDefault()
        turn(event.key === 'ArrowDown' ? 1 : -1)
        frontButton.current?.focus()
      }}
    >
      {moreAbove && <MoreIndicator direction="up" onClick={() => turn(-1)} />}
      {moreBelow && <MoreIndicator direction="down" onClick={() => turn(1)} />}
      {rows.map((row, index) => {
        const offset = index - front
        const distance = Math.abs(offset)
        const depth = DEPTH[Math.min(distance, DEPTH.length - 1)]
        const hidden = distance >= DEPTH.length
        const isFront = distance === 0
        const active = row.key === value
        return (
          <button
            key={row.key}
            ref={isFront ? frontButton : undefined}
            onClick={() => {
              setFront(index)
              onChange(row.key)
            }}
            data-nav-view={row.key}
            data-nav-skip={isFront ? undefined : ''}
            tabIndex={isFront ? 0 : -1}
            aria-current={active ? 'page' : undefined}
            aria-hidden={hidden || undefined}
            title={collapsed || !isFront ? `${row.label}${row.count != null ? ` (${row.count})` : ''}` : undefined}
            aria-label={collapsed ? row.label : undefined}
            className={`group absolute inset-x-2 flex items-center gap-2.5 rounded-[9px] text-left text-[13px] transition-[transform,opacity,background-color,box-shadow] duration-300 ease-out motion-reduce:transition-none ${
              collapsed ? 'justify-center px-0' : 'px-2.5'
            } ${
              isFront
                ? 'bg-white/10 text-ink shadow-[0_4px_14px_-8px_var(--dialog-shadow),inset_0_1px_0_rgba(255,255,255,0.07)] backdrop-blur-md'
                : 'bg-white/5 text-dim backdrop-blur-md hover:text-ink'
            } ${hidden ? 'pointer-events-none opacity-0' : 'opacity-100'}`}
            style={{
              height: ROW_HEIGHT,
              top: `calc(50% - ${ROW_HEIGHT / 2}px)`,
              transform: `translateY(${Math.sign(offset) * depth.y}px) scale(${depth.scale})`,
              zIndex: 10 - distance
            }}
          >
            {active && <span className="vitra-sun absolute top-1/2 -left-[5px] h-[7px] w-[7px] -translate-y-1/2" />}
            <span
              className="flex min-w-0 flex-1 items-center gap-2.5 transition-opacity duration-300"
              style={{ opacity: depth.fade, justifyContent: collapsed ? 'center' : undefined }}
            >
              <RowContent row={row} active={active} collapsed={collapsed} />
            </span>
          </button>
        )
      })}
    </div>
  )
}

function MoreIndicator({ direction, onClick }: { direction: 'up' | 'down'; onClick: () => void }) {
  const Chevron = direction === 'up' ? ChevronUp : ChevronDown
  return (
    <button
      onClick={onClick}
      tabIndex={-1}
      data-nav-skip
      aria-label={direction === 'up' ? 'More stores above' : 'More stores below'}
      className={`absolute inset-x-2 z-20 flex justify-center text-muted transition-colors hover:text-ink ${
        direction === 'up' ? 'top-0' : 'bottom-0'
      }`}
      style={{ height: INDICATOR }}
    >
      <Chevron className="h-3.5 w-3.5" />
    </button>
  )
}

function RowContent({ row, active, collapsed }: { row: Row; active: boolean; collapsed: boolean }) {
  const Icon = row.icon
  const logo = collapsed ? STORE_LOGOS[row.key] : undefined
  // collapsed, every tag would get the same icon
  const useMonogram = collapsed && !logo && (!Icon || row.key.startsWith('tag:'))
  const tone = active ? 'text-accent' : 'text-muted group-hover:text-dim'
  return (
    <>
      {logo ? (
        <StoreLogo kind={logo} className={`h-[18px] w-[18px] shrink-0 transition-colors ${tone}`} />
      ) : useMonogram ? (
        <Monogram label={row.label} active={active} />
      ) : (
        Icon && <Icon className={`h-4 w-4 shrink-0 transition-colors ${tone}`} />
      )}
      {!collapsed && (
        <>
          <span className="truncate">{row.label}</span>
          <span className={`ml-auto shrink-0 text-[11px] tabular-nums ${active ? 'text-dim' : 'text-muted'}`}>
            {row.count}
          </span>
        </>
      )}
    </>
  )
}

export default function Sidebar({
  games,
  value,
  onChange,
  collapsed,
  onToggleCollapsed,
  programsView,
  concealed = false,
  slow = false
}: Props) {
  const { library, sources, tags, extras, totalSeconds } = useMemo(() => {
    // counts include uninstalled games: "Not installed" is a lens, not a partition
    const visible = games.filter((game) => inLibrary(game, programsView))
    const programs = games.filter((game) => !game.hidden && isSoftware(game)).length

    const tagCounts = new Map<string, number>()
    for (const game of visible) {
      for (const tag of game.tags) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1)
    }

    const rows: Row[] = []
    const uninstalled = visible.filter((game) => !game.installed).length
    const hidden = games.filter((game) => game.hidden).length
    if (uninstalled) {
      rows.push({
        key: 'uninstalled',
        label: 'Not installed',
        count: uninstalled,
        icon: HardDriveDownload
      })
    }
    if (hidden) rows.push({ key: 'hidden', label: 'Hidden', count: hidden, icon: EyeOff })

    return {
      totalSeconds: games.reduce((sum, game) => sum + game.playtimeSeconds, 0),
      library: [
        { key: 'all', label: 'All games', count: visible.length, icon: LayoutGrid },
        {
          key: 'recent',
          label: 'Recently played',
          count: visible.filter((game) => game.lastPlayed).length,
          icon: Clock
        },
        {
          key: 'favorites',
          label: 'Favourites',
          count: visible.filter((game) => game.favorite).length,
          icon: Star
        },
        {
          key: 'unplayed',
          label: 'Never played',
          count: visible.filter((game) => !game.playtimeSeconds).length,
          icon: Gamepad2
        },
        ...(programsView === 'tab'
          ? [{ key: 'programs', label: 'Programs', count: programs, icon: AppWindow }]
          : [])
      ] as Row[],
      sources: GAME_SOURCES.map((source) => ({
          key: `source:${source}`,
          label: source === 'manual' ? 'Local files' : sourceLabel(source),
          count: visible.filter((game) => hasSource(game, source)).length
        }))
        .filter((row) => (row.count ?? 0) > 0) as Row[],
      tags: [...tagCounts.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([tag, count]) => ({ key: `tag:${tag}`, label: tag, count, icon: TagIcon })) as Row[],
      extras: rows
    }
  }, [games, programsView])

  return (
    <aside
      aria-hidden={concealed || undefined}
      inert={concealed || undefined}
      className={`glass-chrome flex shrink-0 flex-col overflow-hidden transition-[width] ${
        slow ? 'duration-500 ease-in-out' : 'duration-200 ease-out'
      } ${concealed ? 'w-0' : `hairline-r ${collapsed ? 'w-[64px]' : 'w-[246px]'}`}`}
    >
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto py-6">
        {(
          [
            [undefined, HOME_ROWS],
            ['Library', library],
            ['Stores', sources],
            ['Tags', tags],
            ['Other', extras]
          ] as [string | undefined, Row[]][]
        ).map(([title, rows]) => (
          <Section
            key={title ?? 'home'}
            title={title}
            rows={rows}
            value={value}
            onChange={onChange}
            collapsed={collapsed}
            carousel={title === 'Stores'}
          />
        ))}
      </div>

      <div className="px-2 pb-2">
        <button
          onClick={() => window.open(KOFI_URL, '_blank')}
          title="Support Vitra on Ko-fi"
          aria-label={collapsed ? 'Buy me a coffee' : undefined}
          className={`group flex h-[34px] w-full items-center gap-2.5 rounded-[9px] text-[13px] text-dim transition-colors hover:bg-white/5 hover:text-ink ${
            collapsed ? 'justify-center' : 'px-2.5'
          }`}
        >
          <CoffeeIcon className="h-4 w-4 shrink-0 text-muted transition-colors group-hover:text-ink" />
          {!collapsed && <span className="truncate">Buy me a coffee</span>}
        </button>
      </div>

      <div
        className={`hairline-t flex py-3 ${
          collapsed ? 'flex-col items-center gap-2 px-1' : 'items-center gap-3 pr-2 pl-5'
        }`}
      >
        {collapsed ? (
          <div
            title="Total played"
            className="font-display text-[13px] font-bold tabular-nums text-dim [font-stretch:85%]"
          >
            {formatPlaytimeShort(totalSeconds)}
          </div>
        ) : (
          <div className="min-w-0 flex-1">
            <div className="text-[12px] font-medium text-muted">Total played</div>
            <div className="mt-0.5 font-display text-[26px] leading-tight font-bold tabular-nums text-ink [font-stretch:85%]">
              {formatPlaytimeShort(totalSeconds)}
            </div>
          </div>
        )}
        <button
          onClick={onToggleCollapsed}
          title={collapsed ? 'Expand sidebar (Ctrl+B)' : 'Collapse sidebar (Ctrl+B)'}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-expanded={!collapsed}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] text-muted transition-colors hover:bg-white/7 hover:text-ink"
        >
          {collapsed ? (
            <ChevronsRight className="h-4 w-4" />
          ) : (
            <ChevronsLeft className="h-4 w-4" />
          )}
        </button>
      </div>
    </aside>
  )
}
