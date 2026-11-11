// 会員の登録とログインの窓口。画面からは、この窓口だけを使う（ログインの API を直接呼ばない）

/** ログイン中の会員 */
export type Member = {
  /** メールアドレス（小文字にそろえたもの） */
  email: string
}

export interface AuthClient {
  /** ログイン中の会員。ログインしていなければ null */
  getSession(): Promise<Member | null>
  /**
   * 会員登録する。確認のメールが送られる（ログインした状態にはならない）。
   * すでに登録されているメールアドレスでも、登録できたときと同じく成功する（登録の有無を外から探られないようにする）
   */
  signUp(email: string, password: string): Promise<void>
  /** ログインする。メールアドレスの確認が済んでいなければ EmailNotVerifiedError */
  signIn(email: string, password: string): Promise<Member>
  /** ログアウトする */
  signOut(): Promise<void>
  /** 確認のメールを送り直す（確認が済んでいない会員のときだけ届く。それ以外でも成功として扱う） */
  sendVerificationEmail(email: string): Promise<void>
}

/** 登録やログインができなかったときのエラー。message は画面にそのまま出す日本語の説明 */
export class AuthError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'AuthError'
  }
}

/** メールアドレスの確認が済んでいないので、ログインできないときのエラー */
export class EmailNotVerifiedError extends AuthError {
  constructor() {
    super(AUTH_MESSAGES.emailNotVerified)
    this.name = 'EmailNotVerifiedError'
  }
}

/**
 * 確認のメールのリンクを開いた結果。サーバー（server/memberAuth.ts）が、ログインの画面（#/login/<結果>）へ転送する
 *   verified      確認できた
 *   link-used     使用済みのリンク（すでに確認済み）
 *   link-expired  有効期限が切れたリンク
 *   link-invalid  正しくないリンク
 *   link-error    サーバーのエラーで確認できなかった
 */
export const EMAIL_VERIFICATION_RESULTS = ['verified', 'link-used', 'link-expired', 'link-invalid', 'link-error'] as const

export type EmailVerificationResult = (typeof EMAIL_VERIFICATION_RESULTS)[number]

export function isEmailVerificationResult(value: unknown): value is EmailVerificationResult {
  return (EMAIL_VERIFICATION_RESULTS as readonly unknown[]).includes(value)
}

/** パスワードの最短の文字数（サーバーの server/memberAuth.ts と同じ） */
export const MIN_PASSWORD_LENGTH = 8

export const AUTH_MESSAGES = {
  emptyCredentials: 'メールアドレスとパスワードを入力してください',
  emptyEmail: 'メールアドレスを入力してください',
  invalidEmail: 'メールアドレスの形が正しくありません（例: name@example.com）',
  passwordTooShort: `パスワードは${MIN_PASSWORD_LENGTH}文字以上にしてください`,
  passwordTooLong: 'パスワードが長すぎます',
  wrongCredentials: 'メールアドレスかパスワードが違います',
  emailNotVerified: 'メールアドレスの確認が済んでいません',
  tooManyRequests: '試す回数の上限を超えました。しばらく待ってから、もう一度試してください',
  tooManyMails: 'メールを送る回数の上限を超えました。しばらく待ってから、もう一度試してください',
  verificationSent: '確認のメールを送りました。メールのリンクを開いてください',
  emailVerified: 'メールアドレスを確認できました。ログインしてください',
  linkUsed: 'この確認のリンクは、すでに使われています。確認が済んでいれば、ログインしてください',
  linkExpired: '確認のリンクの有効期限が切れています。確認のメールを送り直してください',
  linkInvalid: '確認のリンクが正しくありません。確認のメールを送り直してください',
  linkError: 'メールアドレスを確認できませんでした。しばらく待ってから、もう一度リンクを開いてください',
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

/** 確認のメールを送り直す前に、メールアドレスを確かめる。問題があれば画面に出す説明、なければ null */
export function checkEmail(email: string): string | null {
  if (email.trim() === '') return AUTH_MESSAGES.emptyEmail
  if (!EMAIL_PATTERN.test(email.trim())) return AUTH_MESSAGES.invalidEmail
  return null
}
