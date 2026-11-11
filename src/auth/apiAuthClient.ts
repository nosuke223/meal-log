import { AUTH_MESSAGES, AuthError, EmailNotVerifiedError, ResetLinkError, type AuthClient, type Member } from './authClient'

export type ApiAuthClientOptions = {
  /** API を呼ぶのに使う。テストで差し替える */
  fetch?: typeof fetch
  /** ログインの API の場所。省略すると同じオリジンの /api/auth */
  baseUrl?: string
}

/** ログインの API（Better Auth。server/memberAuth.ts）の、エラーの code ごとの説明 */
const MESSAGES_BY_CODE: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: AUTH_MESSAGES.wrongCredentials,
  PASSWORD_TOO_SHORT: AUTH_MESSAGES.passwordTooShort,
  PASSWORD_TOO_LONG: AUTH_MESSAGES.passwordTooLong,
  INVALID_EMAIL: AUTH_MESSAGES.invalidEmail,
  TOO_MANY_REQUESTS: AUTH_MESSAGES.tooManyRequests,
  // メールを送る回数の上限（server/memberAuth.ts）
  TOO_MANY_MAIL_REQUESTS: AUTH_MESSAGES.tooManyMails,
}

/** サーバーのログインの API を呼ぶ窓口を作る */
export function createApiAuthClient(options: ApiAuthClientOptions = {}): AuthClient {
  const fetchApi = options.fetch ?? ((input, init) => fetch(input, init))
  const baseUrl = options.baseUrl ?? '/api/auth'

  async function call(method: 'GET' | 'POST', path: string, body?: unknown): Promise<unknown> {
    let response: Response
    try {
      response = await fetchApi(`${baseUrl}${path}`, {
        method,
        headers: method === 'GET' ? { Accept: 'application/json' } : { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
        credentials: 'same-origin',
        // 公開の前は、サイト全体を Access が守っている。Access のログインの期限が切れると、別のオリジンへ転送されるので、たどらない
        redirect: 'manual',
      })
    } catch (error) {
      throw new AuthError(AUTH_MESSAGES.connectionFailed, { cause: error })
    }
    if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) {
      throw new AuthError(AUTH_MESSAGES.loginExpired)
    }
    const data = await readJson(response)
    if (!response.ok) throw errorOf(response.status, data)
    return data
  }

  return {
    async getSession() {
      return memberOf(await call('GET', '/get-session'))
    },

    async signUp(email, password) {
      // 名前は使わない（Better Auth が必須にしているので、空で送る）
      await call('POST', '/sign-up/email', { email: email.trim(), password, name: '' })
    },

    async signIn(email, password) {
      const member = memberOf(await call('POST', '/sign-in/email', { email: email.trim(), password }))
      if (member === null) throw new AuthError('ログインの API の応答が正しくありません')
      return member
    },

    async signOut() {
      await call('POST', '/sign-out')
    },

    async sendVerificationEmail(email) {
      await call('POST', '/send-verification-email', { email: email.trim() })
    },

    async requestPasswordReset(email) {
      await call('POST', '/request-password-reset', { email: email.trim() })
    },

    async resetPassword(token, newPassword) {
      // トークンは本文に入れる（アドレスのクエリに入れると、サーバーの記録に残る）
      await call('POST', '/reset-password', { token, newPassword })
    },
  }
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text()
  if (text === '') return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}

/** 応答の user から会員を取り出す。なければ null */
function memberOf(data: unknown): Member | null {
  if (typeof data !== 'object' || data === null) return null
  const user = (data as { user?: unknown }).user
  if (typeof user !== 'object' || user === null) return null
  const email = (user as { email?: unknown }).email
  return typeof email === 'string' ? { email } : null
}

/** エラーの応答を、画面に出す日本語の説明のエラーにする */
function errorOf(status: number, data: unknown): AuthError {
  const body = typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : {}
  const code = typeof body.code === 'string' ? body.code : null
  if (code === 'EMAIL_NOT_VERIFIED') return new EmailNotVerifiedError()
  // 再設定のリンクの、期限切れ、使用済み、正しくないトークンは、区別しない
  if (code === 'INVALID_TOKEN' || code === 'USER_NOT_FOUND') return new ResetLinkError()
  if (code !== null && code in MESSAGES_BY_CODE) return new AuthError(MESSAGES_BY_CODE[code])
  if (status === 429) return new AuthError(AUTH_MESSAGES.tooManyRequests)
  if (status === 403) return new AuthError(AUTH_MESSAGES.forbidden)
  // 入力の形の検査（Better Auth の VALIDATION_ERROR など）。画面で先に確かめるので、ふつうはメールアドレスの形
  if (status === 400) return new AuthError(AUTH_MESSAGES.invalidEmail)
  // API の入口のエラー（server/api.ts の { error: { type, message } }。秘密の値がないときなど）
  const error = body.error
  if (typeof error === 'object' && error !== null && typeof (error as { message?: unknown }).message === 'string') {
    return new AuthError((error as { message: string }).message)
  }
  return new AuthError(`ログインの処理でエラーが起きました（${status}）`)
}
