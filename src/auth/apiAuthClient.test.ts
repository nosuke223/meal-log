import { describe, expect, it } from 'vitest'
import { createApiAuthClient } from './apiAuthClient'
import { AUTH_MESSAGES, AuthError } from './authClient'

type Sent = { url: string; init: RequestInit }

/** 決まった応答を返す fetch。送ったリクエストを sent に残す */
function fakeFetch(response: () => Response | Promise<Response>) {
  const sent: Sent[] = []
  const fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    sent.push({ url: String(input), init })
    return response()
  }) as typeof globalThis.fetch
  return { fetch, sent }
}

function json(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(body === null ? 'null' : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

const USER = { id: 'u1', email: 'alice@example.com', name: '', emailVerified: false }

describe('ログインの API を呼ぶ窓口', () => {
  it('会員登録は POST /api/auth/sign-up/email に JSON で送り、前後の空白を除いたメールアドレスと空の名前を送る', async () => {
    const { fetch, sent } = fakeFetch(() => json(200, { token: 't', user: USER }))
    const client = createApiAuthClient({ fetch })

    expect(await client.signUp(' alice@example.com ', 'password-123')).toEqual({ email: 'alice@example.com' })
    expect(sent).toHaveLength(1)
    expect(sent[0].url).toBe('/api/auth/sign-up/email')
    expect(sent[0].init.method).toBe('POST')
    expect(sent[0].init.credentials).toBe('same-origin')
    expect(sent[0].init.redirect).toBe('manual')
    expect((sent[0].init.headers as Record<string, string>)['Content-Type']).toBe('application/json')
    expect(JSON.parse(sent[0].init.body as string)).toEqual({ email: 'alice@example.com', password: 'password-123', name: '' })
  })

  it('ログインは POST /api/auth/sign-in/email、ログアウトは POST /api/auth/sign-out', async () => {
    const { fetch, sent } = fakeFetch(() => json(200, { token: 't', user: USER }))
    const client = createApiAuthClient({ fetch })

    expect(await client.signIn('alice@example.com', 'password-123')).toEqual({ email: 'alice@example.com' })
    await client.signOut()
    expect(sent.map((request) => [request.init.method, request.url])).toEqual([
      ['POST', '/api/auth/sign-in/email'],
      ['POST', '/api/auth/sign-out'],
    ])
  })

  it('ログイン中の会員は GET /api/auth/get-session で読み、ログインしていなければ null', async () => {
    const signedIn = fakeFetch(() => json(200, { session: {}, user: USER }))
    expect(await createApiAuthClient({ fetch: signedIn.fetch }).getSession()).toEqual({ email: 'alice@example.com' })
    expect(signedIn.sent[0].url).toBe('/api/auth/get-session')
    expect(signedIn.sent[0].init.method).toBe('GET')

    const signedOut = fakeFetch(() => json(200, null))
    expect(await createApiAuthClient({ fetch: signedOut.fetch }).getSession()).toBeNull()
  })

  it.each([
    [401, { code: 'INVALID_EMAIL_OR_PASSWORD', message: 'Invalid email or password' }, AUTH_MESSAGES.wrongCredentials],
    [422, { code: 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL', message: 'User already exists.' }, AUTH_MESSAGES.alreadyRegistered],
    [400, { code: 'PASSWORD_TOO_SHORT', message: 'Password too short' }, AUTH_MESSAGES.passwordTooShort],
    [400, { code: 'INVALID_EMAIL', message: 'Invalid email' }, AUTH_MESSAGES.invalidEmail],
    [400, { code: 'VALIDATION_ERROR', message: '[body.email] Invalid email address' }, AUTH_MESSAGES.invalidEmail],
    [429, { code: 'TOO_MANY_REQUESTS', message: AUTH_MESSAGES.tooManyRequests }, AUTH_MESSAGES.tooManyRequests],
    [429, { message: 'Too many requests. Please try again later.' }, AUTH_MESSAGES.tooManyRequests],
    [403, { code: 'INVALID_ORIGIN', message: 'Invalid origin' }, AUTH_MESSAGES.forbidden],
    [
      500,
      { error: { type: 'AuthConfigurationError', message: '環境変数 BETTER_AUTH_SECRET を設定してください' } },
      '環境変数 BETTER_AUTH_SECRET を設定してください',
    ],
    [502, null, 'ログインの処理でエラーが起きました（502）'],
  ])('%i（%j）は、日本語の説明の AuthError にする', async (status, body, message) => {
    const { fetch } = fakeFetch(() => json(status, body))
    const result = createApiAuthClient({ fetch }).signIn('alice@example.com', 'password-123')

    await expect(result).rejects.toThrow(AuthError)
    await expect(result).rejects.toThrow(message)
  })

  it('通信に失敗したときは、接続できなかった説明の AuthError にする（cause に元のエラー）', async () => {
    const cause = new TypeError('Failed to fetch')
    const { fetch } = fakeFetch(() => Promise.reject(cause))

    const error = await createApiAuthClient({ fetch }).getSession().catch((thrown: unknown) => thrown)
    expect(error).toBeInstanceOf(AuthError)
    expect((error as AuthError).message).toBe(AUTH_MESSAGES.connectionFailed)
    expect((error as AuthError).cause).toBe(cause)
  })

  it('転送（Access のログインの期限切れ）は、たどらずにログインの期限切れとして扱う', async () => {
    const { fetch } = fakeFetch(() => new Response(null, { status: 302, headers: { Location: 'https://team.cloudflareaccess.com/' } }))

    await expect(createApiAuthClient({ fetch }).getSession()).rejects.toThrow(AUTH_MESSAGES.loginExpired)
  })

  it('成功の応答に会員がないときは AuthError', async () => {
    const { fetch } = fakeFetch(() => json(200, { token: null }))

    await expect(createApiAuthClient({ fetch }).signIn('alice@example.com', 'password-123')).rejects.toThrow(AuthError)
  })
})
