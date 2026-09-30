import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Game, PlaySession, RunningState } from '@shared/types'
import { formatPlaytimeShort } from '../lib/format'
import { copyIds } from '../lib/duplicates'

// totals from the library (includes seeded Steam hours), dates from sessions.json.
// one hue: it's all magnitude. text never wears the accent

const DAY = 86_400_000
const WEEKS_BARS = 12
const WEEKS_CALENDAR = 26

function startOfDay(time: number): number {
  const date = new Date(time)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

// Monday. the +DAY/2 keeps DST days from landing on the wrong date
function startOfWeek(time: number): number {
  const day = startOfDay(time)
  const weekday = (new Date(day).getDay() + 6) % 7
  return startOfDay(day - weekday * DAY + DAY / 2)
}

// splits sessions that cross midnight
function secondsByDay(sessions: PlaySession[]): Map<number, number> {
  const days = new Map<number, number>()
  for (const { start, end } of sessions) {
    let from = start
    while (from < end) {
      const day = startOfDay(from)
      const next = Math.min(end, startOfDay(day + DAY + DAY / 2))
      days.set(day, (days.get(day) ?? 0) + (next - from) / 1000)
      from = next
    }
  }
  return days
}

function hours(seconds: number): string {
  if (!seconds) return '0 h'
  if (seconds < 3600) return `${Math.max(1, Math.round(seconds / 60))} min`
  const h = seconds / 3600
  return `${h < 10 ? h.toFixed(1) : Math.round(h)} h`
}

function dayLabel(time: number): string {
  return new Date(time).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
}

function shortDate(time: number): string {
  return new Date(time).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

function Heading({ children }: { children: ReactNode }) {
  return (
    <h2 className="mb-4 font-display text-[17px] font-semibold text-ink [font-stretch:88%]">{children}</h2>
  )
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="font-display text-[24px] leading-tight font-bold tabular-nums text-ink [font-stretch:85%]">
        {value}
      </div>
      <div className="mt-0.5 text-[12px] text-muted">{label}</div>
    </div>
  )
}

interface Tip {
  x: number
  y: number
  text: string
}

function useTip() {
  const box = useRef<HTMLDivElement>(null)
  const [tip, setTip] = useState<Tip | null>(null)
  const show = (el: Element, text: string): void => {
    const outer = box.current?.getBoundingClientRect()
    const rect = el.getBoundingClientRect()
    if (outer) setTip({ x: rect.left + rect.width / 2 - outer.left, y: rect.top - outer.top, text })
  }
  const node = tip ? (
    <div
      role="tooltip"
      className="glass-soft pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-[calc(100%+8px)] rounded-[8px] px-2.5 py-1.5 text-[11.5px] whitespace-nowrap text-ink"
      style={{ left: tip.x, top: tip.y }}
    >
      {tip.text}
    </div>
  ) : null
  return { box, show, hide: () => setTip(null), node }
}

function WeeklyBars({ weeks }: { weeks: Array<{ start: number; seconds: number }> }) {
  const { box, show, hide, node } = useTip()
  const max = Math.max(...weeks.map((week) => week.seconds), 3600)
  // whole-hour ticks, max three
  const top = Math.ceil(max / 3600)
  const step = Math.max(1, Math.ceil(top / 3))
  const ticks = [step, step * 2, step * 3].filter((tick) => tick <= top)
  const scaleTop = Math.max(top, ticks[ticks.length - 1] ?? 1) * 3600
  const current = weeks[weeks.length - 1]

  return (
    <div ref={box} className="relative" onMouseLeave={hide}>
      <div className="relative h-[168px]">
        {ticks.map((tick) => (
          <div
            key={tick}
            className="absolute inset-x-0 border-t border-white/6"
            style={{ bottom: `${((tick * 3600) / scaleTop) * 100}%` }}
          >
            <span className="absolute -top-2 left-0 text-[10.5px] tabular-nums text-muted">{tick} h</span>
          </div>
        ))}
        <div className="absolute inset-x-0 bottom-0 border-t border-white/10" />
        <div className="absolute inset-y-0 right-0 left-9 flex items-end gap-[2px]">
          {weeks.map((week) => {
            const label = `Week of ${shortDate(week.start)}: ${hours(week.seconds)}`
            const isCurrent = week === current
            return (
              <button
                key={week.start}
                type="button"
                aria-label={label}
                onMouseEnter={(event) => show(event.currentTarget, label)}
                onFocus={(event) => show(event.currentTarget, label)}
                onBlur={hide}
                className="group relative flex h-full flex-1 items-end justify-center rounded-[4px] outline-offset-2"
              >
                {isCurrent && week.seconds > 0 && (
                  <span
                    className="absolute text-[11px] font-medium tabular-nums text-dim"
                    style={{ bottom: `calc(${(week.seconds / scaleTop) * 100}% + 4px)` }}
                  >
                    {hours(week.seconds)}
                  </span>
                )}
                <span
                  className="w-full max-w-[24px] rounded-t-[4px] transition-opacity group-hover:opacity-80"
                  style={{
                    height: week.seconds ? `max(2px, ${(week.seconds / scaleTop) * 100}%)` : 0,
                    background: `rgb(var(--accent-rgb) / ${isCurrent ? 1 : 0.7})`
                  }}
                />
              </button>
            )
          })}
        </div>
      </div>
      <div className="mt-2 ml-9 flex justify-between text-[10.5px] text-muted">
        <span>{shortDate(weeks[0].start)}</span>
        <span>This week</span>
      </div>
      <table className="sr-only">
        <caption>Hours played per week</caption>
        <tbody>
          {weeks.map((week) => (
            <tr key={week.start}>
              <th scope="row">Week of {shortDate(week.start)}</th>
              <td>{hours(week.seconds)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {node}
    </div>
  )
}

const STEPS = [0, 0.3, 0.5, 0.75, 1]

function step(seconds: number): number {
  if (!seconds) return 0
  if (seconds < 30 * 60) return 1
  if (seconds < 90 * 60) return 2
  if (seconds < 3 * 3600) return 3
  return 4
}

function Calendar({ days, today }: { days: Map<number, number>; today: number }) {
  const { box, show, hide, node } = useTip()
  const first = startOfWeek(today) - (WEEKS_CALENDAR - 1) * 7 * DAY
  const columns = Array.from({ length: WEEKS_CALENDAR }, (_, week) =>
    Array.from({ length: 7 }, (_, weekday) => startOfDay(first + (week * 7 + weekday) * DAY + DAY / 2))
  )

  return (
    <div ref={box} className="relative" onMouseLeave={hide}>
      <div
        role="img"
        aria-label={`Days played over the last ${WEEKS_CALENDAR} weeks`}
        className="flex w-fit gap-[3px]"
      >
        {columns.map((column, index) => (
          <div key={index} className="flex flex-col gap-[3px]">
            {column.map((day) => {
              const future = day > today
              const seconds = days.get(day) ?? 0
              const level = step(seconds)
              return (
                <div
                  key={day}
                  data-nav-skip
                  onMouseEnter={(event) =>
                    !future && show(event.currentTarget, `${dayLabel(day)}: ${seconds ? hours(seconds) : 'not played'}`)
                  }
                  className={`h-[15px] w-[15px] rounded-[3px] ${
                    future ? 'opacity-0' : level ? '' : 'bg-white/6'
                  }`}
                  style={level ? { background: `rgb(var(--accent-rgb) / ${STEPS[level]})` } : undefined}
                />
              )
            })}
          </div>
        ))}
      </div>
      <div className="mt-3 flex w-fit items-center gap-1.5 text-[10.5px] text-muted" aria-hidden>
        Less
        {STEPS.map((opacity, level) => (
          <span
            key={level}
            className={`h-2.5 w-2.5 rounded-[3px] ${level ? '' : 'bg-white/6'}`}
            style={level ? { background: `rgb(var(--accent-rgb) / ${opacity})` } : undefined}
          />
        ))}
        More
      </div>
      {node}
    </div>
  )
}

function TopGames({ rows }: { rows: Array<{ game: Game; seconds: number }> }) {
  const { box, show, hide, node } = useTip()
  const max = rows[0]?.seconds ?? 1
  return (
    <div ref={box} className="relative flex flex-col gap-3" onMouseLeave={hide}>
      {rows.map(({ game, seconds }) => {
        const label = `${game.name}: ${hours(seconds)}`
        return (
          <div
            key={game.id}
            className="grid grid-cols-[minmax(0,180px)_1fr] items-center gap-4"
            onMouseEnter={(event) => show(event.currentTarget.lastElementChild!, label)}
          >
            <span className="truncate text-[12.5px] text-dim" title={game.name}>
              {game.name}
            </span>
            <div className="flex items-center gap-2.5">
              <span
                className="h-3 rounded-r-[4px]"
                style={{ width: `${(seconds / max) * 100}%`, background: 'rgb(var(--accent-rgb) / 0.8)' }}
              />
              <span className="shrink-0 text-[11.5px] tabular-nums text-muted">{hours(seconds)}</span>
            </div>
          </div>
        )
      })}
      {node}
    </div>
  )
}

export default function Stats({ games, running }: { games: Game[]; running: RunningState[] }) {
  const [sessions, setSessions] = useState<PlaySession[] | null>(null)

  // refetch when a session ends
  useEffect(() => {
    let alive = true
    void (window.launcher.getSessions?.() ?? Promise.resolve([])).then((list) => {
      if (alive) setSessions(list)
    })
    return () => {
      alive = false
    }
  }, [running.length])

  const view = useMemo(() => {
    const list = sessions ?? []
    const today = startOfDay(Date.now())
    const days = secondsByDay(list)

    const thisWeek = startOfWeek(Date.now())
    const weeks = Array.from({ length: WEEKS_BARS }, (_, index) => {
      const start = startOfWeek(thisWeek - (WEEKS_BARS - 1 - index) * 7 * DAY + DAY / 2)
      let seconds = 0
      for (let d = 0; d < 7; d++) seconds += days.get(startOfDay(start + d * DAY + DAY / 2)) ?? 0
      return { start, seconds }
    })

    // any copy of a merged game counts
    const byCopy = new Map<string, Game>()
    for (const game of games) for (const id of copyIds(game)) byCopy.set(id, game)
    const monthAgo = Date.now() - 30 * DAY
    const perGame = new Map<Game, number>()
    for (const session of list) {
      if (session.end < monthAgo) continue
      const game = byCopy.get(session.gameId)
      if (!game) continue
      const seconds = (session.end - Math.max(session.start, monthAgo)) / 1000
      perGame.set(game, (perGame.get(game) ?? 0) + seconds)
    }
    const top = [...perGame.entries()]
      .map(([game, seconds]) => ({ game, seconds }))
      .sort((a, b) => b.seconds - a.seconds)
      .slice(0, 6)

    let month = 0
    for (const [day, seconds] of days) if (day >= startOfDay(monthAgo)) month += seconds

    return {
      today,
      days,
      weeks,
      top,
      week: weeks[weeks.length - 1].seconds,
      month,
      longest: Math.max(0, ...list.map((session) => (session.end - session.start) / 1000)),
      total: games.reduce((sum, game) => sum + game.playtimeSeconds, 0)
    }
  }, [sessions, games])

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-8 pt-8 pb-12">
      <h1 className="font-display text-[30px] leading-none font-bold tracking-[-0.02em] text-ink [font-stretch:85%]">
        Stats
      </h1>

      <div className="mt-8 mb-12 flex flex-wrap items-end gap-x-12 gap-y-6">
        <div>
          <div className="font-display text-[56px] leading-none font-bold tabular-nums text-ink [font-stretch:80%]">
            {formatPlaytimeShort(view.total)}
          </div>
          <div className="mt-1.5 text-[12px] text-muted">Total played</div>
        </div>
        <Tile label="This week" value={hours(view.week)} />
        <Tile label="Last 30 days" value={hours(view.month)} />
        <Tile label="Sessions" value={sessions ? String(sessions.length) : '—'} />
        <Tile label="Longest session" value={view.longest ? hours(view.longest) : '—'} />
      </div>

      {sessions && !sessions.length ? (
        <p className="text-[12.5px] text-muted">No tracked sessions yet</p>
      ) : (
        <div className="grid gap-12 xl:grid-cols-2">
          <section>
            <Heading>Hours per week</Heading>
            <WeeklyBars weeks={view.weeks} />
          </section>
          <section>
            <Heading>Last 30 days</Heading>
            {view.top.length ? (
              <TopGames rows={view.top} />
            ) : (
              <p className="text-[12.5px] text-muted">Nothing played</p>
            )}
          </section>
          <section className="xl:col-span-2">
            <Heading>Calendar</Heading>
            <Calendar days={view.days} today={view.today} />
          </section>
        </div>
      )}
    </div>
  )
}
