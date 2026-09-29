import { useMemo } from 'react'
import {
  AppWindow,
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
import type { Game, ProgramsView } from '@shared/types'
import { formatPlaytimeShort, inLibrary, isSoftware, sourceLabel } from '../lib/format'
import StoreLogo, { type StoreLogoKind } from './StoreLogo'

export type Filter = string

interface Props {
  games: Game[]
  value: Filter
  onChange: (value: Filter) => void
  /** Icon rail: no labels, counts or headings. */
  collapsed: boolean
  onToggleCollapsed: () => void
  /** 'tab' adds a Programs row; 'tab' and 'hidden' leave programs out of every count. */
  programsView: ProgramsView
  /** Slid fully away (the screen saver). */
  concealed?: boolean
  /** Use the screen saver's slower slide, in both directions. */
  slow?: boolean
}

export const KOFI_URL ='https://ko-fi.com/mindlz'

interface Row {
  key: Filter
  label: string
  /** Omitted for rows that aren't a slice of the library (Home). */
  count?: number
  icon?: typeof LayoutGrid
}

const HOME_ROWS: Row[] = [{ key: 'home', label: 'Home', icon: House }]

const STORE_LOGOS: Partial<Record<Filter, StoreLogoKind>> = {
  'source:steam': 'steam',
  'source:epic': 'epic',
  'source:gog': 'gog',
  'source:xbox': 'xbox'
}

/** Two letters standing in for a store or tag, which have no distinct icon. */
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
  collapsed
}: {
  title?: string
  rows: Row[]
  value: Filter
  onChange: (value: Filter) => void
  collapsed: boolean
}) {
  if (!rows.length) return null

  return (
    <div className={collapsed ? 'mb-3' : 'mb-7'}>
      {title &&
        (collapsed ? (
          // The heading can't fit; a rule keeps the groups apart.
          <div className="hairline-t mx-4 mb-3" />
        ) : (
          <div className="mb-1.5 px-3.5 text-[12px] font-medium text-muted">{title}</div>
        ))}
      <nav className="flex flex-col gap-0.5 px-2">
        {rows.map((row) => {
          const active = row.key === value
          const Icon = row.icon
          // Collapsed, a store is recognised by its mark rather than its name.
          const logo = collapsed ? STORE_LOGOS[row.key] : undefined
          // Collapsed, every tag would show the same tag icon; letters tell them apart.
          const useMonogram = collapsed && !logo && (!Icon || row.key.startsWith('tag:'))
          return (
            <button
              key={row.key}
              onClick={() => onChange(row.key)}
              // LB/RB on a controller step through these in order (lib/gamepad.ts).
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
              {logo ? (
                <StoreLogo
                  kind={logo}
                  className={`h-[18px] w-[18px] shrink-0 transition-colors ${
                    active ? 'text-accent' : 'text-muted group-hover:text-dim'
                  }`}
                />
              ) : useMonogram ? (
                <Monogram label={row.label} active={active} />
              ) : (
                Icon && (
                  <Icon
                    className={`h-4 w-4 shrink-0 transition-colors ${
                      active ? 'text-accent' : 'text-muted group-hover:text-dim'
                    }`}
                  />
                )
              )}
              {!collapsed && (
                <>
                  <span className="truncate">{row.label}</span>
                  <span
                    className={`ml-auto shrink-0 text-[11px] tabular-nums ${
                      active ? 'text-dim' : 'text-muted'
                    }`}
                  >
                    {row.count}
                  </span>
                </>
              )}
            </button>
          )
        })}
      </nav>
    </div>
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
    // "Not installed" is a view, not an exclusion — every other count includes
    // owned games that aren't on disk. Programs are left out when they have
    // their own tab or are hidden (the same rule App's filter uses).
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
        // Shown even when empty in tab mode, so the tab you turned on is there.
        ...(programsView === 'tab'
          ? [{ key: 'programs', label: 'Programs', count: programs, icon: AppWindow }]
          : [])
      ] as Row[],
      sources: (['steam', 'epic', 'gog', 'xbox', 'manual'] as const)
        .map((source) => ({
          key: `source:${source}`,
          label: source === 'manual' ? 'Local files' : sourceLabel(source),
          count: visible.filter((game) => game.source === source).length
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

      {/* The collapse control sits with the thing it collapses, at the edge
          it moves, so it stays under the pointer in both states. */}
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
