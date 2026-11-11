import { AUTH_MESSAGES, AuthError, type AuthClient, type Member } from './authClient'

export type ApiAuthClientOptions = {
  /** API を呼ぶのに使う。テストで差し替える */
  fetch?: typeof fetch
  /** ログインの API の場所。省略すると同じオリジンの /api/auth */
  baseUrl?: string
}

/** ログインの API（Better Auth。server/memberAuth.ts）の、エラーの code ごとの説明 */
const MESSAGES_BY_CODE: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: AUTH_MESSAGES.wrongCredentials,
  USER_ALREADY_EXISTS: AUTH_MESSAGES.alreadyRegistered,
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: AUTH_MESSAGES.alreadyRegistered,
  PASSWORD_TOO_SHORT: AUTH_MESSAGES.passwordTooShort,
  PASSWORD_TOO_LONG: AUTH_MESSAGES.passwordTooLong,
  INVALID_EMAIL: AUTH_MESSAGES.invalidEmail,
  TOO_MANY_REQUESTS: AUTH_MESSAGES.tooManyRequests,
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

  async function signInOrUp(path: string, body: Record<string, string>): Promise<Member> {
    const member = memberOf(await call('POST', path, body))
    if (member === null) throw new AuthError('ログインの API の応答が正しくありません')
    return member
  }

  return {
    async getSession() {
      return memberOf(await call('GET', '/get-session'))
    },

    signUp(email, password) {
      // 名前は使わない（Better Auth が必須にしているので、空で送る）
      return signInOrUp('/sign-up/email', { email: email.trim(), password, name: '' })
    },

    signIn(email, password) {
      return signInOrUp('/sign-in/email', { email: email.trim(), password })
    },

    async signOut() {
      await call('POST', '/sign-out')
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
  if (status === 429) return new AuthError(AUTH_MESSAGES.tooManyRequests)
  if (code !== null && code in MESSAGES_BY_CODE) return new AuthError(MESSAGES_BY_CODE[code])
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
