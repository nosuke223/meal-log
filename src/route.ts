// アドレスのハッシュと画面の対応
//   #/day/YYYY-MM-DD   その日の記録の画面
//   #/calendar/YYYY-MM その月のカレンダー
//   それ以外（空を含む） 今日の記録の画面
import { isValidMonth, monthOf } from './calendar/calendarMonth'
import { isValidDate } from './meals/mealRecord'

export type Route =
  /** date が null のときは今日 */
  | { screen: 'day'; date: string | null }
  | { screen: 'calendar'; month: string }

/**
 * ハッシュを画面に直す。今日（YYYY-MM-DD）より後の日と、不正な日付は今日の記録の画面にする。
 * 不正な月はカレンダーの今月にする
 */
export function parseHash(hash: string, today: string): Route {
  const [screen, value] = hash.replace(/^#\/?/, '').split('/')
  if (screen === 'calendar') {
    return { screen: 'calendar', month: isValidMonth(value) ? value : monthOf(today) }
  }
  if (screen === 'day' && isValidDate(value) && value <= today) {
    return { screen: 'day', date: value }
  }
  return { screen: 'day', date: null }
}

export function dayHash(date: string): string {
  return `#/day/${date}`
}

export function calendarHash(month: string): string {
  return `#/calendar/${month}`
}
