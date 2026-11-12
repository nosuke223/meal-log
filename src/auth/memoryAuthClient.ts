import {
  AUTH_MESSAGES,
  AuthError,
  EmailNotVerifiedError,
  MIN_PASSWORD_LENGTH,
  ResetLinkError,
  type AuthClient,
  type Member,
} from './authClient'

/** メモリーの窓口が「送った」メール（宛先と種類）。resetPassword は再設定のメールで、token が要る */
export type MemoryMail = {
  to: string
  kind: 'verification' | 'alreadyRegistered' | 'resetPassword'
  /** 再設定のメールのリンクのトークン（resetPassword のときだけ） */
  token?: string
}

export type MemoryAuthClientOptions = {
  /** 登録・確認済みで、ログインした状態から始める会員のメールアドレス（パスワードは password） */
  signedInAs?: string
  password?: string
}

/** signedInAs の会員の、既定のパスワード */
export const MEMORY_MEMBER_PASSWORD = 'member-password'

/**
 * メモリーの中だけで動くログインの窓口（画面のテスト用。アプリでは使わない）。
 * サーバーと同じく、メールアドレスは小文字にそろえ、パスワードは8文字以上にする。
 * 登録しても、メールアドレスを確認する（verify）までログインできない
 */
export function createMemoryAuthClient(options: MemoryAuthClientOptions = {}): AuthClient & {
  /** 次の呼び出しを、このエラーで失敗させる（回数の上限や通信の失敗の表示を確かめる） */
  failNext(error: Error): void
  /** メールアドレスを確認済みにする（確認のメールのリンクを開いたときの代わり） */
  verify(email: string): void
  /** 再設定のメールのリンクを期限切れにする（1時間たったときの代わり） */
  expireResetTokens(): void
  /** 「送った」メール */
  mails: MemoryMail[]
} {
  const members = new Map<string, { password: string; verified: boolean }>()
  const mails: MemoryMail[] = []
  /** 使える再設定のトークンと、その会員のメールアドレス */
  const resetTokens = new Map<string, string>()
  let tokenCount = 0
  let current: Member | null = null
  let nextError: Error | null = null
  if (options.signedInAs !== undefined) {
    const email = options.signedInAs.trim().toLowerCase()
    members.set(email, { password: options.password ?? MEMORY_MEMBER_PASSWORD, verified: true })
    current = { email }
  }

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

    expireResetTokens() {
      resetTokens.clear()
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

    async requestPasswordReset(email) {
      takeError()
      const normalized = email.trim().toLowerCase()
      // 登録されていなければ送らない（確認が済んでいなくても送る）。どちらも成功する
      if (!members.has(normalized)) return
      const token = `token-${++tokenCount}`
      resetTokens.set(token, normalized)
      mails.push({ to: normalized, kind: 'resetPassword', token })
    },

    async resetPassword(token, newPassword) {
      takeError()
      if (newPassword.length < MIN_PASSWORD_LENGTH) throw new AuthError(AUTH_MESSAGES.passwordTooShort)
      const email = resetTokens.get(token)
      const member = email === undefined ? undefined : members.get(email)
      if (email === undefined || member === undefined) throw new ResetLinkError()
      // リンクは1回だけ使える。変えても、確認が済んだことにはならない。ログインした状態にもならない
      resetTokens.delete(token)
      member.password = newPassword
      if (current?.email === email) current = null
    },
  }
}
