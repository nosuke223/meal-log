import { useEffect, useState } from 'react'
import { GENRE_LABELS } from '../meals/labels'
import type { MealRecord } from '../meals/mealRecord'
import type { MealRepository } from '../meals/mealRepository'
import {
  buildMonthWeeks,
  GENRE_MARKS,
  genreMarksByDate,
  monthOf,
  monthRange,
  plannedDates,
  shiftMonth,
  type GenreMark,
} from './calendarMonth'
import { DayPreview } from './DayPreview'

type Props = {
  repository: MealRepository
  /** 今日（YYYY-MM-DD） */
  today: string
  /** 表示する月（YYYY-MM） */
  month: string
  /** 選んだ日（YYYY-MM-DD、表示する月の日）。null は何も選んでいない */
  selected: string | null
  /** 保存データが画面の外で変わる（日が過ぎた予定の自動更新など）たびに変わる値。変わると読み直す */
  revision?: number
  /** 日が過ぎた予定の自動更新に失敗したときのエラー。あれば表示する */
  autoUpdateError?: string | null
  onChangeMonth: (month: string) => void
  /** 日を選ぶ（選んでいない日のマスをタップしたとき） */
  onSelectDate: (date: string) => void
  /** その日の記録の画面を開く（一覧のボタンか、選んでいる日のマスをもう一度タップしたとき） */
  onOpenDate: (date: string) => void
  onOpenToday: () => void
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

/** 予定の印の、凡例と読み上げに使う名前 */
const PLANNED_NAME = '予定あり'

function dayLabel(date: string, marks: GenreMark[] | undefined, planned: boolean): string {
  const [, month, day] = date.split('-').map(Number)
  const parts = [`${month}月${day}日`]
  if (marks) parts.push(marks.map((mark) => MARK_NAMES[mark]).join('・'))
  if (planned) parts.push(PLANNED_NAME)
  return parts.join(' ')
}

function Mark({ mark }: { mark: GenreMark }) {
  return (
    <span className={`mark mark-${mark}`} aria-hidden="true">
      {MARK_LETTERS[mark]}
    </span>
  )
}

/** 予定がある日の印。ジャンルの点（丸と角丸の四角）と違う、ひし形にする */
function PlannedMark() {
  return <span className="planned-mark" aria-hidden="true" />
}

type MonthMarks = {
  month: string
  genres: Map<string, GenreMark[]>
  planned: Set<string>
  /** 月の記録。読み込めなかったときは null */
  records: MealRecord[] | null
}

/**
 * 月表示のカレンダー。記録がある日に出てきたジャンルの点を、予定がある日に予定の印を表示する。
 * 選んだ日の品は、カレンダーの下に一覧で表示する
 */
export function CalendarScreen({
  repository,
  today,
  month,
  selected,
  revision,
  autoUpdateError,
  onChangeMonth,
  onSelectDate,
  onOpenDate,
  onOpenToday,
}: Props) {
  const [loaded, setLoaded] = useState<MonthMarks | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const { from, to } = monthRange(month)
    repository
      .listByDateRange(from, to)
      .then((records) => {
        if (cancelled) return
        setLoaded({ month, genres: genreMarksByDate(records), planned: plannedDates(records), records })
        setError(null)
      })
      .catch((cause: unknown) => {
        if (cancelled) return
        // 同じ月の読み直しに失敗したときは、前の表示のままにする。月を移った最初の読み込みなら空にする
        setLoaded((previous) =>
          previous?.month === month ? previous : { month, genres: new Map(), planned: new Set(), records: null },
        )
        setError(`記録を読み込めませんでした: ${messageOf(cause)}`)
      })
    return () => {
      cancelled = true
    }
  }, [repository, month, revision])

  // 月を移った直後は、前の月の点を出さない
  const current = loaded?.month === month ? loaded : null

  const weeks = buildMonthWeeks(month)

  return (
    <main className="screen">
      <header className="screen-header">
        <h1>meal-log</h1>
        <div className="header-actions">
          {/* 一覧が画面に収まるよう、月の行の下に分けず、ここに置く */}
          <button type="button" onClick={() => onChangeMonth(monthOf(today))}>
            今月
          </button>
          <button type="button" onClick={onOpenToday}>
            今日
          </button>
        </div>
      </header>
      {autoUpdateError && (
        <p role="alert" className="error">
          {autoUpdateError}
        </p>
      )}
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
      <table className="calendar" aria-label={formatMonth(month)} aria-busy={current === null}>
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
                const marks = current?.genres.get(date)
                const planned = current?.planned.has(date) ?? false
                const isToday = date === today
                const isSelected = date === selected
                return (
                  <td key={date}>
                    <button
                      type="button"
                      className="day"
                      aria-label={dayLabel(date, marks, planned)}
                      aria-current={isToday ? 'date' : undefined}
                      aria-pressed={isSelected}
                      onClick={() => (isSelected ? onOpenDate(date) : onSelectDate(date))}
                    >
                      <span className="day-head">
                        <span className="day-number">{Number(date.slice(8))}</span>
                        {planned && <PlannedMark />}
                      </span>
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
      <DayPreview date={selected} records={current?.records ?? null} onOpen={onOpenDate} />
      <section className="legend" aria-label="点の凡例">
        <ul className="legend-list">
          {GENRE_MARKS.map((mark) => (
            <li key={mark}>
              <Mark mark={mark} />
              <span>{MARK_NAMES[mark]}</span>
            </li>
          ))}
          <li>
            <PlannedMark />
            <span>{PLANNED_NAME}</span>
          </li>
        </ul>
        <p className="legend-note">
          点は「食べた」の記録のジャンルです（同じジャンルは何品あっても1つ）。予定はひし形の印だけで、点には数えません。
        </p>
      </section>
    </main>
  )
}
