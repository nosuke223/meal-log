import { AUTH_MESSAGES, AuthError, EmailNotVerifiedError, MIN_PASSWORD_LENGTH, type AuthClient, type Member } from './authClient'

/** メモリーの窓口が「送った」メール（宛先と種類） */
export type MemoryMail = {
  to: string
  kind: 'verification' | 'alreadyRegistered'
}

/**
 * メモリーの中だけで動くログインの窓口（画面のテスト用。アプリでは使わない）。
 * サーバーと同じく、メールアドレスは小文字にそろえ、パスワードは8文字以上にする。
 * 登録しても、メールアドレスを確認する（verify）までログインできない
 */
export function createMemoryAuthClient(): AuthClient & {
  /** 次の呼び出しを、このエラーで失敗させる（回数の上限や通信の失敗の表示を確かめる） */
  failNext(error: Error): void
  /** メールアドレスを確認済みにする（確認のメールのリンクを開いたときの代わり） */
  verify(email: string): void
  /** 「送った」メール */
  mails: MemoryMail[]
} {
  const members = new Map<string, { password: string; verified: boolean }>()
  const mails: MemoryMail[] = []
  let current: Member | null = null
  let nextError: Error | null = null

  function takeError() {
    const error = nextError
    nextError = null
    if (error) throw error
  }

  return {
    mails,

    failNext(error) {
      nextError = error
    },

    verify(email) {
      const member = members.get(email.trim().toLowerCase())
      if (member) member.verified = true
    },

    async getSession() {
      takeError()
      return current
    },

    async signUp(email, password) {
      takeError()
      const normalized = email.trim().toLowerCase()
      if (password.length < MIN_PASSWORD_LENGTH) throw new AuthError(AUTH_MESSAGES.passwordTooShort)
      if (members.has(normalized)) {
        mails.push({ to: normalized, kind: 'alreadyRegistered' })
        return
      }
      members.set(normalized, { password, verified: false })
      mails.push({ to: normalized, kind: 'verification' })
    },

    async signIn(email, password) {
      takeError()
      const normalized = email.trim().toLowerCase()
      const member = members.get(normalized)
      if (member?.password !== password) throw new AuthError(AUTH_MESSAGES.wrongCredentials)
      if (!member.verified) throw new EmailNotVerifiedError()
      current = { email: normalized }
      return current
    },

    async signOut() {
      takeError()
      current = null
    },

    async sendVerificationEmail(email) {
      takeError()
      const normalized = email.trim().toLowerCase()
      if (members.get(normalized)?.verified === false) mails.push({ to: normalized, kind: 'verification' })
    },
  }
}
