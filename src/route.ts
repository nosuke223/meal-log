// アドレスのハッシュと画面の対応
//   #/day/YYYY-MM-DD   その日の記録の画面
//   #/calendar/YYYY-MM-DD その日の月のカレンダー（その日を選んだ状態）
//   #/calendar/YYYY-MM その月のカレンダー（今月なら今日を選んだ状態、ほかの月は何も選ばない）
//   #/data             データ（書き出し・読み込み）の画面
//   それ以外（空を含む） 今日の記録の画面
import { isValidMonth, monthOf } from './calendar/calendarMonth'
import { isValidDate } from './meals/mealRecord'

export type Route =
  /** date が null のときは今日 */
  | { screen: 'day'; date: string | null }
  /** selected は選んだ日（YYYY-MM-DD）。null は何も選んでいない */
  | { screen: 'calendar'; month: string; selected: string | null }
  | { screen: 'data' }

/**
 * ハッシュを画面に直す。不正な日付は今日の記録の画面にする（明日以降の日は、その日の画面にする）。
 * カレンダーの不正な月や日付は、今月（今日を選んだ状態）にする
 */
export function parseHash(hash: string, today: string): Route {
  const [screen, value] = hash.replace(/^#\/?/, '').split('/')
  if (screen === 'calendar') {
    if (isValidDate(value)) {
      return { screen: 'calendar', month: monthOf(value), selected: value }
    }
    const month = isValidMonth(value) ? value : monthOf(today)
    return { screen: 'calendar', month, selected: month === monthOf(today) ? today : null }
  }
  if (screen === 'data') {
    return { screen: 'data' }
  }
  if (screen === 'day' && isValidDate(value)) {
    return { screen: 'day', date: value }
  }
  return { screen: 'day', date: null }
}

/** 今日の記録の画面。日付をまたぐと翌日の画面に変わる */
export function todayHash(): string {
  return '#/'
}

export function dayHash(date: string): string {
  return `#/day/${date}`
}

export function calendarHash(month: string): string {
  return `#/calendar/${month}`
}

/** その日を選んだ状態の、その日の月のカレンダー */
export function calendarDateHash(date: string): string {
  return `#/calendar/${date}`
}

export function dataHash(): string {
  return '#/data'
}
