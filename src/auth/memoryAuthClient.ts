import { AUTH_MESSAGES, AuthError, MIN_PASSWORD_LENGTH, type AuthClient, type Member } from './authClient'

/**
 * メモリーの中だけで動くログインの窓口（画面のテスト用。アプリでは使わない）。
 * サーバーと同じく、メールアドレスは小文字にそろえ、パスワードは8文字以上にし、登録したらログインした状態にする
 */
export function createMemoryAuthClient(): AuthClient & {
  /** 次の呼び出しを、このエラーで失敗させる（回数の上限や通信の失敗の表示を確かめる） */
  failNext(error: Error): void
} {
  const passwords = new Map<string, string>()
  let current: Member | null = null
  let nextError: Error | null = null

  function takeError() {
    const error = nextError
    nextError = null
    if (error) throw error
  }

  return {
    failNext(error) {
      nextError = error
    },

    async getSession() {
      takeError()
      return current
    },

    async signUp(email, password) {
      takeError()
      const normalized = email.trim().toLowerCase()
      if (password.length < MIN_PASSWORD_LENGTH) throw new AuthError(AUTH_MESSAGES.passwordTooShort)
      if (passwords.has(normalized)) throw new AuthError(AUTH_MESSAGES.alreadyRegistered)
      passwords.set(normalized, password)
      current = { email: normalized }
      return current
    },

    async signIn(email, password) {
      takeError()
      const normalized = email.trim().toLowerCase()
      if (passwords.get(normalized) !== password) throw new AuthError(AUTH_MESSAGES.wrongCredentials)
      current = { email: normalized }
      return current
    },

    async signOut() {
      takeError()
      current = null
    },
  }
}
