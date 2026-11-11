// 会員の登録とログインの窓口。画面からは、この窓口だけを使う（ログインの API を直接呼ばない）

/** ログイン中の会員 */
export type Member = {
  /** メールアドレス（小文字にそろえたもの） */
  email: string
}

export interface AuthClient {
  /** ログイン中の会員。ログインしていなければ null */
  getSession(): Promise<Member | null>
  /** 会員登録する。登録できたら、そのままログインした状態になる */
  signUp(email: string, password: string): Promise<Member>
  /** ログインする */
  signIn(email: string, password: string): Promise<Member>
  /** ログアウトする */
  signOut(): Promise<void>
}

/** 登録やログインができなかったときのエラー。message は画面にそのまま出す日本語の説明 */
export class AuthError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'AuthError'
  }
}

/** パスワードの最短の文字数（サーバーの server/memberAuth.ts と同じ） */
export const MIN_PASSWORD_LENGTH = 8

export const AUTH_MESSAGES = {
  emptyCredentials: 'メールアドレスとパスワードを入力してください',
  invalidEmail: 'メールアドレスの形が正しくありません（例: name@example.com）',
  passwordTooShort: `パスワードは${MIN_PASSWORD_LENGTH}文字以上にしてください`,
  passwordTooLong: 'パスワードが長すぎます',
  wrongCredentials: 'メールアドレスかパスワードが違います',
  alreadyRegistered: 'このメールアドレスは、すでに登録されています。ログインしてください',
  tooManyRequests: '試す回数の上限を超えました。しばらく待ってから、もう一度試してください',
  connectionFailed: 'サーバーに接続できませんでした。通信の状態を確かめてください',
  loginExpired: 'ログインの期限が切れました。ページを読み込み直してください',
  forbidden: 'このページからは受け付けられませんでした。ページを読み込み直してください',
} as const

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * 送る前に入力を確かめる。問題があれば画面に出す説明、なければ null。
 * 会員登録のときだけ、パスワードの長さも確かめる（ログインでは、違うパスワードとして扱う）
 */
export function checkCredentials(email: string, password: string, mode: 'signIn' | 'signUp'): string | null {
  if (email.trim() === '' || password === '') return AUTH_MESSAGES.emptyCredentials
  if (!EMAIL_PATTERN.test(email.trim())) return AUTH_MESSAGES.invalidEmail
  if (mode === 'signUp' && password.length < MIN_PASSWORD_LENGTH) return AUTH_MESSAGES.passwordTooShort
  return null
}
