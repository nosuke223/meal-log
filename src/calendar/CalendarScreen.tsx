import { useEffect, useState } from 'react'
import { GENRE_LABELS } from '../meals/labels'
import type { MealRepository } from '../meals/mealRepository'
import {
  buildMonthWeeks,
  GENRE_MARKS,
  genreMarksByDate,
  monthOf,
  monthRange,
  shiftMonth,
  type GenreMark,
} from './calendarMonth'

type Props = {
  repository: MealRepository
  /** 今日（YYYY-MM-DD） */
  today: string
  /** 表示する月（YYYY-MM） */
  month: string
  onChangeMonth: (month: string) => void
  onSelectDate: (date: string) => void
}

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土']

/** 凡例と読み上げに使う名前 */
const MARK_NAMES: Record<GenreMark, string> = { ...GENRE_LABELS, unset: '未設定' }

/** マスの中の点に書く1文字 */
const MARK_LETTERS: Record<GenreMark, string> = {
  japanese: '和',
  western: '洋',
  chinese: '中',
  other: '他',
  unset: '未',
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function formatMonth(month: string): string {
  const [year, monthNumber] = month.split('-').map(Number)
  return `${year}年${monthNumber}月`
}

function dayLabel(date: string, marks: GenreMark[] | undefined): string {
  const [, month, day] = date.split('-').map(Number)
  const base = `${month}月${day}日`
  return marks ? `${base} ${marks.map((mark) => MARK_NAMES[mark]).join('・')}` : base
}

function Mark({ mark }: { mark: GenreMark }) {
  return (
    <span className={`mark mark-${mark}`} aria-hidden="true">
      {MARK_LETTERS[mark]}
    </span>
  )
}

/** 月表示のカレンダー。記録がある日に、出てきたジャンルの点を表示する */
export function CalendarScreen({ repository, today, month, onChangeMonth, onSelectDate }: Props) {
  const [marksByDate, setMarksByDate] = useState<Map<string, GenreMark[]>>(new Map())
  const [loadedMonth, setLoadedMonth] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const { from, to } = monthRange(month)
    repository
      .listByDateRange(from, to)
      .then((records) => {
        if (cancelled) return
        setMarksByDate(genreMarksByDate(records))
        setLoadedMonth(month)
        setError(null)
      })
      .catch((cause: unknown) => {
        if (cancelled) return
        setMarksByDate(new Map())
        setLoadedMonth(month)
        setError(`記録を読み込めませんでした: ${messageOf(cause)}`)
      })
    return () => {
      cancelled = true
    }
  }, [repository, month])

  const weeks = buildMonthWeeks(month)

  return (
    <main className="screen">
      <header>
        <h1>meal-log</h1>
      </header>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className="month-nav">
        <button type="button" onClick={() => onChangeMonth(shiftMonth(month, -1))}>
          前の月
        </button>
        <h2 className="month-title">{formatMonth(month)}</h2>
        <button type="button" onClick={() => onChangeMonth(shiftMonth(month, 1))}>
          次の月
        </button>
      </div>
      <div className="month-nav-sub">
        <button type="button" onClick={() => onChangeMonth(monthOf(today))}>
          今月
        </button>
      </div>
      <table className="calendar" aria-label={formatMonth(month)} aria-busy={loadedMonth !== month}>
        <thead>
          <tr>
            {WEEKDAYS.map((weekday) => (
              <th key={weekday} scope="col">
                {weekday}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week) => (
            <tr key={week.find((date) => date !== null)}>
              {week.map((date, index) => {
                if (date === null) return <td key={`empty-${index}`} />
                const marks = loadedMonth === month ? marksByDate.get(date) : undefined
                const isToday = date === today
                const isFuture = date > today
                return (
                  <td key={date}>
                    <button
                      type="button"
                      className="day"
                      aria-label={dayLabel(date, marks)}
                      aria-current={isToday ? 'date' : undefined}
                      disabled={isFuture}
                      onClick={() => onSelectDate(date)}
                    >
                      <span className="day-number">{Number(date.slice(8))}</span>
                      {marks && (
                        <span className="marks">
                          {marks.map((mark) => (
                            <Mark key={mark} mark={mark} />
                          ))}
                        </span>
                      )}
                    </button>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <section className="legend" aria-label="点の凡例">
        <ul className="legend-list">
          {GENRE_MARKS.map((mark) => (
            <li key={mark}>
              <Mark mark={mark} />
              <span>{MARK_NAMES[mark]}</span>
            </li>
          ))}
        </ul>
        <p className="legend-note">点は「食べた」の記録のジャンルです（同じジャンルは何品あっても1つ）。未来の日は選べません。</p>
      </section>
    </main>
  )
}
