// アドレスのハッシュと画面の対応
//   #/day/YYYY-MM-DD   その日の記録の画面
//   #/calendar/YYYY-MM-DD その日の月のカレンダー（その日を選んだ状態）
//   #/calendar/YYYY-MM その月のカレンダー（今月なら今日を選んだ状態、ほかの月は何も選ばない）
//   #/data             データ（書き出し・読み込み）の画面
//   #/login            ログインの画面
//   #/login/<結果>      結果を出した、ログインの画面（結果は LoginNotice。確認のメールのリンクの結果はサーバーが転送する。
//                      password-reset はパスワードを再設定した後。知らない結果は、ただのログインの画面にする）
//   #/signup           会員登録の画面
//   #/forgot           パスワードの再設定のメールを送る画面
//   #/reset            新しいパスワードを決める画面（#/reset/<トークン> は再設定のメールのリンク。画面が #/reset に置き換える）
//   #/account          アカウントの画面（ログインしていなければ、ログインの画面）
//   それ以外（空を含む） 今日の記録の画面
import { isLoginNotice, type LoginNotice } from './auth/authClient'
import { isValidMonth, monthOf } from './calendar/calendarMonth'
import { isValidDate } from './meals/mealRecord'

export type Route =
  /** date が null のときは今日 */
  | { screen: 'day'; date: string | null }
  /** selected は選んだ日（YYYY-MM-DD）。null は何も選んでいない */
  | { screen: 'calendar'; month: string; selected: string | null }
  | { screen: 'data' }
  /** notice は、確認のメールのリンクを開いた結果か、パスワードを再設定した結果。なければ null */
  | { screen: 'login'; notice: LoginNotice | null }
  | { screen: 'signup' }
  | { screen: 'forgot' }
  /** token は、アドレスに付いていた再設定のトークン（#/reset だけのときは null）。画面が読んだら、アドレスから消す */
  | { screen: 'reset'; token: string | null }
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
    return { screen, notice: isLoginNotice(value) ? value : null }
  }
  if (screen === 'reset') {
    return { screen, token: value ? decodeToken(value) : null }
  }
  if (screen === 'data' || screen === 'signup' || screen === 'account' || screen === 'forgot') {
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

/** ログインの画面。notice を付けると、確認のメールのリンクを開いた結果か、パスワードを再設定した結果を出す */
export function loginHash(notice?: LoginNotice): string {
  return notice === undefined ? '#/login' : `#/login/${notice}`
}

/** パスワードの再設定のメールを送る画面 */
export function forgotHash(): string {
  return '#/forgot'
}

/** 新しいパスワードを決める画面。token を付けると、再設定のメールのリンクのアドレス */
export function resetHash(token?: string): string {
  return token === undefined ? '#/reset' : `#/reset/${encodeURIComponent(token)}`
}

function decodeToken(value: string): string | null {
  try {
    return decodeURIComponent(value)
  } catch {
    return null
  }
}

export function signupHash(): string {
  return '#/signup'
}

export function accountHash(): string {
  return '#/account'
}
