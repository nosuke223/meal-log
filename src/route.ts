// アドレスのハッシュと画面の対応
//   #/day/YYYY-MM-DD   その日の記録の画面
//   #/calendar/YYYY-MM-DD その日の月のカレンダー（その日を選んだ状態）
//   #/calendar/YYYY-MM その月のカレンダー（今月なら今日を選んだ状態、ほかの月は何も選ばない）
//   #/data             データ（書き出し・読み込み）の画面
//   #/login            ログインの画面
//   #/login/<結果>      確認のメールのリンクを開いた結果を出した、ログインの画面（結果は EmailVerificationResult。
//                      サーバーが転送する。知らない結果は、ただのログインの画面にする）
//   #/signup           会員登録の画面
//   #/account          アカウントの画面（ログインしていなければ、ログインの画面）
//   それ以外（空を含む） 今日の記録の画面
import { isEmailVerificationResult, type EmailVerificationResult } from './auth/authClient'
import { isValidMonth, monthOf } from './calendar/calendarMonth'
import { isValidDate } from './meals/mealRecord'

export type Route =
  /** date が null のときは今日 */
  | { screen: 'day'; date: string | null }
  /** selected は選んだ日（YYYY-MM-DD）。null は何も選んでいない */
  | { screen: 'calendar'; month: string; selected: string | null }
  | { screen: 'data' }
  /** verification は、確認のメールのリンクを開いた結果。なければ null */
  | { screen: 'login'; verification: EmailVerificationResult | null }
  | { screen: 'signup' }
  | { screen: 'account' }

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
  if (screen === 'login') {
    return { screen, verification: isEmailVerificationResult(value) ? value : null }
  }
  if (screen === 'data' || screen === 'signup' || screen === 'account') {
    return { screen }
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

/** ログインの画面。verification を付けると、確認のメールのリンクを開いた結果を出す */
export function loginHash(verification?: EmailVerificationResult): string {
  return verification === undefined ? '#/login' : `#/login/${verification}`
}

export function signupHash(): string {
  return '#/signup'
}

export function accountHash(): string {
  return '#/account'
}
