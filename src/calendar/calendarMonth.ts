// カレンダーの月の計算と、日ごとのジャンルの点の算出
import { GENRES, type Genre, type MealRecord } from '../meals/mealRecord'

/** 点の種類。unset はジャンルが未設定の品 */
export type GenreMark = Genre | 'unset'

/** 点を並べる順 */
export const GENRE_MARKS: readonly GenreMark[] = [...GENRES, 'unset']

const MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/

/** YYYY-MM の書式の月なら true */
export function isValidMonth(value: unknown): value is string {
  return typeof value === 'string' && MONTH_PATTERN.test(value)
}

/** 日付（YYYY-MM-DD）の月（YYYY-MM） */
export function monthOf(date: string): string {
  return date.slice(0, 7)
}

function parseMonth(month: string): { year: number; month: number } {
  const [year, monthNumber] = month.split('-').map(Number)
  return { year, month: monthNumber }
}

function pad(value: number, length = 2): string {
  return String(value).padStart(length, '0')
}

function formatMonth(year: number, month: number): string {
  return `${pad(year, 4)}-${pad(month)}`
}

/** 月を delta か月ずらす（負の数で前の月） */
export function shiftMonth(month: string, delta: number): string {
  const parsed = parseMonth(month)
  const index = parsed.year * 12 + (parsed.month - 1) + delta
  return formatMonth(Math.floor(index / 12), (index % 12) + 1)
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/** 月の最初の日と最後の日（YYYY-MM-DD） */
export function monthRange(month: string): { from: string; to: string } {
  const { year, month: monthNumber } = parseMonth(month)
  return {
    from: `${month}-01`,
    to: `${month}-${pad(daysInMonth(year, monthNumber))}`,
  }
}

/**
 * 月の日を、日曜始まりの週ごとに並べる。月の外のマスは null。
 * 例: 2026-11 は 1日が日曜なので、最初の週は 11-01 から 11-07
 */
export function buildMonthWeeks(month: string): (string | null)[][] {
  const { year, month: monthNumber } = parseMonth(month)
  const firstWeekday = new Date(Date.UTC(year, monthNumber - 1, 1)).getUTCDay()
  const cells: (string | null)[] = Array.from({ length: firstWeekday }, () => null)
  for (let day = 1; day <= daysInMonth(year, monthNumber); day++) {
    cells.push(`${month}-${pad(day)}`)
  }
  while (cells.length % 7 !== 0) cells.push(null)
  const weeks: (string | null)[][] = []
  for (let start = 0; start < cells.length; start += 7) {
    weeks.push(cells.slice(start, start + 7))
  }
  return weeks
}

/**
 * 日ごとに、出てきたジャンルの点を求める。数えるのは「食べた」の記録だけ。
 * 同じジャンルが何品あっても点は1つで、GENRE_MARKS の順に並ぶ。記録のない日は含まない
 */
export function genreMarksByDate(records: readonly MealRecord[]): Map<string, GenreMark[]> {
  const found = new Map<string, Set<GenreMark>>()
  for (const record of records) {
    if (record.status !== 'eaten') continue
    const marks = found.get(record.date) ?? new Set<GenreMark>()
    marks.add(record.genre ?? 'unset')
    found.set(record.date, marks)
  }
  const result = new Map<string, GenreMark[]>()
  for (const [date, marks] of found) {
    result.set(date, GENRE_MARKS.filter((mark) => marks.has(mark)))
  }
  return result
}
