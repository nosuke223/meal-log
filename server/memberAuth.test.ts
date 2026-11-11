import { getMigrations } from 'better-auth/db/migration'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApiHandler, type ApiEnv } from './api'
import { AUTH_RATE_LIMITS, memberAuthOptions, TOO_MANY_REQUESTS_MESSAGE } from './memberAuth'
import { startTestDatabase, type TestDatabase } from './testDatabase'

// 会員の登録とログイン（/api/auth/）。マイグレーションで作った D1（wrangler の Miniflare）で確かめる

let database: TestDatabase

beforeAll(async () => {
  database = await startTestDatabase()
})

afterAll(async () => {
  await database?.dispose()
})

beforeEach(async () => {
  await database.reset()
  vi.restoreAllMocks()
})

const ORIGIN = 'https://meal-log.example'
const SECRET = 'test-only-better-auth-secret-0123456789abcdef'
const PASSWORD = 'correct-horse-battery'

type CallOptions = {
  body?: unknown
  /** 送る cookie（name=value; …） */
  cookie?: string
  /** Origin のヘッダー（既定は同じオリジン。null なら付けない） */
  origin?: string | null
  /** 利用者の IP アドレス（Cloudflare の CF-Connecting-IP） */
  ip?: string
  /** 環境変数（既定は Access の設定と BETTER_AUTH_SECRET。DEV_USER_EMAIL はない＝Access の JWT が要る） */
  env?: Partial<ApiEnv>
  base?: string
}

type CallResult = {
  status: number
  headers: Headers
  body: Record<string, unknown> | null
  /** Set-Cookie から作った、次のリクエストで送る cookie */
  cookie: string
}

function createClient() {
  const handle = createApiHandler({ fetch: () => Promise.reject(new Error('Access の公開鍵は取りに行かない')) })
  return async function call(method: string, path: string, options: CallOptions = {}): Promise<CallResult> {
    const base = options.base ?? ORIGIN
    const headers = new Headers({ 'CF-Connecting-IP': options.ip ?? '203.0.113.1' })
    if (method !== 'GET') headers.set('Content-Type', 'application/json')
    const origin = options.origin === undefined ? base : options.origin
    if (origin !== null && method !== 'GET') headers.set('Origin', origin)
    if (options.cookie) headers.set('Cookie', options.cookie)
    const request = new Request(`${base}${path}`, {
      method,
      headers,
      body: options.body === undefined ? (method === 'GET' ? undefined : '{}') : JSON.stringify(options.body),
    })
    const env: ApiEnv = {
      DB: database.db,
      ACCESS_TEAM_NAME: 'meal-log-team',
      ACCESS_AUD: 'aud-tag',
      BETTER_AUTH_SECRET: SECRET,
      ...options.env,
    }
    const response = await handle(request, env)
    const text = await response.text()
    const cookie = response.headers
      .getSetCookie()
      .map((setCookie) => setCookie.split(';')[0])
      .join('; ')
    return { status: response.status, headers: response.headers, body: text === '' ? null : JSON.parse(text), cookie }
  }
}

type Call = ReturnType<typeof createClient>

function signUp(call: Call, email: string, password = PASSWORD, options: CallOptions = {}) {
  return call('POST', '/api/auth/sign-up/email', { body: { email, password, name: '' }, ...options })
}

function signIn(call: Call, email: string, password = PASSWORD, options: CallOptions = {}) {
  return call('POST', '/api/auth/sign-in/email', { body: { email, password }, ...options })
}

/** ログイン中の会員のメールアドレス。ログインしていなければ null */
async function sessionEmail(call: Call, cookie: string, options: CallOptions = {}): Promise<string | null> {
  const response = await call('GET', '/api/auth/get-session', { cookie, ...options })
  expect(response.status).toBe(200)
  const user = response.body?.user as { email?: string } | undefined
  return user?.email ?? null
}

/** セッションの cookie の Set-Cookie */
function sessionSetCookie(response: CallResult): string {
  const found = response.headers.getSetCookie().find((value) => /session_token=/.test(value))
  if (found === undefined) throw new Error('セッションの cookie がありません')
  return found
}

async function count(table: string): Promise<number> {
  const row = await database.db.prepare(`SELECT COUNT(*) AS count FROM "${table}"`).first<{ count: number }>()
  return row?.count ?? 0
}

describe('会員の表', () => {
  it('マイグレーションで作った表が、使っている版の Better Auth が期待する形と同じ（足りない表・列・索引がない）', async () => {
    const { toBeCreated, toBeAdded, toBeAddedIndexes } = await getMigrations(memberAuthOptions(ORIGIN, SECRET, database.db))
    expect(toBeCreated).toEqual([])
    expect(toBeAdded).toEqual([])
    expect(toBeAddedIndexes).toEqual([])
  })
})

describe('会員登録・ログイン・ログアウト', () => {
  it('登録するとそのままログインした状態になり、ログアウトでき、もう一度ログインできる', async () => {
    const call = createClient()

    const signedUp = await signUp(call, 'alice@example.com')
    expect(signedUp.status).toBe(200)
    expect(signedUp.headers.get('Cache-Control')).toBe('no-store')
    expect(await sessionEmail(call, signedUp.cookie)).toBe('alice@example.com')
    expect(await count('user')).toBe(1)

    const signedOut = await call('POST', '/api/auth/sign-out', { cookie: signedUp.cookie })
    expect(signedOut.status).toBe(200)
    expect(await sessionEmail(call, signedUp.cookie)).toBeNull()

    const signedIn = await signIn(call, 'alice@example.com')
    expect(signedIn.status).toBe(200)
    expect(await sessionEmail(call, signedIn.cookie)).toBe('alice@example.com')
  })

  it('ログアウトの後は、前のセッションの cookie を送っても使えない（D1 からセッションが消える）', async () => {
    const call = createClient()
    const signedUp = await signUp(call, 'alice@example.com')
    expect(await count('session')).toBe(1)

    await call('POST', '/api/auth/sign-out', { cookie: signedUp.cookie })
    expect(await count('session')).toBe(0)
    expect(await sessionEmail(call, signedUp.cookie)).toBeNull()
  })

  it('メールアドレスは大文字と小文字を区別しない（小文字にそろえて保存する）', async () => {
    const call = createClient()
    expect((await signUp(call, 'A@x.com')).status).toBe(200)

    const signedIn = await signIn(call, 'a@x.com')
    expect(signedIn.status).toBe(200)
    expect(await sessionEmail(call, signedIn.cookie)).toBe('a@x.com')

    // 大文字で登録し直そうとしても、同じ人として扱う
    expect((await signUp(call, 'a@X.COM')).status).toBe(422)
  })
})

describe('ログインできないとき', () => {
  it('パスワードが違うときは 401（INVALID_EMAIL_OR_PASSWORD）で、cookie を出さない', async () => {
    const call = createClient()
    await signUp(call, 'alice@example.com')

    const response = await signIn(call, 'alice@example.com', 'wrong-password')
    expect(response.status).toBe(401)
    expect(response.body?.code).toBe('INVALID_EMAIL_OR_PASSWORD')
    expect(response.cookie).toBe('')
  })

  it('存在しないメールアドレスのときは、パスワードが違うときと同じ 401', async () => {
    const call = createClient()

    const response = await signIn(call, 'nobody@example.com')
    expect(response.status).toBe(401)
    expect(response.body?.code).toBe('INVALID_EMAIL_OR_PASSWORD')
    expect(response.cookie).toBe('')
  })

  it('すでに登録されているメールアドレスで登録しようとすると 422 で、会員は増えない', async () => {
    const call = createClient()
    await signUp(call, 'alice@example.com')

    const response = await signUp(call, 'alice@example.com', 'another-password')
    expect(response.status).toBe(422)
    expect(response.body?.code).toBe('USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL')
    expect(response.cookie).toBe('')
    expect(await count('user')).toBe(1)
    // 前のパスワードのまま
    expect((await signIn(call, 'alice@example.com')).status).toBe(200)
  })

  it('パスワードが8文字より短いときは 400 で、登録されない（8文字なら登録できる）', async () => {
    const call = createClient()

    const response = await signUp(call, 'alice@example.com', '1234567')
    expect(response.status).toBe(400)
    expect(response.body?.code).toBe('PASSWORD_TOO_SHORT')
    expect(await count('user')).toBe(0)

    expect((await signUp(call, 'alice@example.com', '12345678')).status).toBe(200)
  })

  it('メールアドレスの形が正しくないときは 400 で、登録されない', async () => {
    const call = createClient()

    const response = await signUp(call, 'not-an-email')
    expect(response.status).toBe(400)
    expect(await count('user')).toBe(0)
  })
})

describe('セッションの cookie', () => {
  it('https では HttpOnly、Secure、SameSite=Lax が付く', async () => {
    const call = createClient()
    const setCookie = sessionSetCookie(await signUp(call, 'alice@example.com'))

    expect(setCookie).toMatch(/^__Secure-/)
    expect(setCookie).toMatch(/;\s*HttpOnly/i)
    expect(setCookie).toMatch(/;\s*Secure/i)
    expect(setCookie).toMatch(/;\s*SameSite=Lax/i)
    expect(setCookie).toMatch(/;\s*Path=\//i)
  })

  it('手元の http では Secure を付けない（HttpOnly と SameSite=Lax は付く）', async () => {
    const call = createClient()
    const base = 'http://localhost:5173'
    const response = await signUp(call, 'alice@example.com', PASSWORD, { base })
    expect(response.status).toBe(200)
    const setCookie = sessionSetCookie(response)

    expect(setCookie).not.toMatch(/;\s*Secure/i)
    expect(setCookie).toMatch(/;\s*HttpOnly/i)
    expect(setCookie).toMatch(/;\s*SameSite=Lax/i)
    expect(await sessionEmail(call, response.cookie, { base })).toBe('alice@example.com')
  })
})

describe('試す回数の上限', () => {
  it(`ログインは、同じ IP アドレスから ${AUTH_RATE_LIMITS['/sign-in/email'].max} 回を超えると 429 で、日本語の説明を返す。別の IP アドレスは試せる`, async () => {
    const call = createClient()
    await signUp(call, 'alice@example.com', PASSWORD, { ip: '198.51.100.1' })
    const { max } = AUTH_RATE_LIMITS['/sign-in/email']

    for (let attempt = 0; attempt < max; attempt++) {
      expect((await signIn(call, 'alice@example.com', 'wrong-password', { ip: '203.0.113.9' })).status).toBe(401)
    }
    // 上限を超えると、正しいパスワードでも拒否される
    const limited = await signIn(call, 'alice@example.com', PASSWORD, { ip: '203.0.113.9' })
    expect(limited.status).toBe(429)
    expect(limited.body).toEqual({ code: 'TOO_MANY_REQUESTS', message: TOO_MANY_REQUESTS_MESSAGE })
    expect(Number(limited.headers.get('Retry-After'))).toBeGreaterThan(0)
    expect(limited.cookie).toBe('')

    expect((await signIn(call, 'alice@example.com', PASSWORD, { ip: '203.0.113.10' })).status).toBe(200)
  })

  it(`登録は、同じ IP アドレスから ${AUTH_RATE_LIMITS['/sign-up/email'].max} 回を超えると 429`, async () => {
    const call = createClient()
    const { max } = AUTH_RATE_LIMITS['/sign-up/email']

    for (let attempt = 0; attempt < max; attempt++) {
      expect((await signUp(call, `user${attempt}@example.com`, PASSWORD, { ip: '203.0.113.20' })).status).toBe(200)
    }
    const limited = await signUp(call, 'one-more@example.com', PASSWORD, { ip: '203.0.113.20' })
    expect(limited.status).toBe(429)
    expect(limited.body?.message).toBe(TOO_MANY_REQUESTS_MESSAGE)
    expect(await count('user')).toBe(max)
  })

  it(`ログアウトは、同じ IP アドレスから ${AUTH_RATE_LIMITS['/sign-out'].max} 回を超えると 429`, async () => {
    const call = createClient()
    const { cookie } = await signUp(call, 'alice@example.com')
    const { max } = AUTH_RATE_LIMITS['/sign-out']

    for (let attempt = 0; attempt < max; attempt++) {
      expect((await call('POST', '/api/auth/sign-out', { cookie, ip: '203.0.113.30' })).status).toBe(200)
    }
    expect((await call('POST', '/api/auth/sign-out', { cookie, ip: '203.0.113.30' })).status).toBe(429)
  })

  it('数えた値は D1 の表（rateLimit）に保存する（API を作り直しても上限は続く）', async () => {
    const { max } = AUTH_RATE_LIMITS['/sign-in/email']
    for (let attempt = 0; attempt < max; attempt++) {
      // リクエストごとに API を作り直す（Workers の実行環境が入れ替わったときと同じ）
      await signIn(createClient(), 'nobody@example.com', PASSWORD, { ip: '203.0.113.40' })
    }
    expect(await count('rateLimit')).toBeGreaterThan(0)
    expect((await signIn(createClient(), 'nobody@example.com', PASSWORD, { ip: '203.0.113.40' })).status).toBe(429)
  })
})

describe('他のオリジンからのリクエスト', () => {
  it('ログインと登録は 403 で、cookie を出さない', async () => {
    const call = createClient()
    await signUp(call, 'alice@example.com')

    const signedIn = await signIn(call, 'alice@example.com', PASSWORD, { origin: 'https://evil.example' })
    expect(signedIn.status).toBe(403)
    expect(signedIn.cookie).toBe('')

    const signedUp = await signUp(call, 'bob@example.com', PASSWORD, { origin: 'https://evil.example' })
    expect(signedUp.status).toBe(403)
    expect(await count('user')).toBe(1)
  })

  it('ログアウトは 403 で、セッションは使えるまま', async () => {
    const call = createClient()
    const { cookie } = await signUp(call, 'alice@example.com')

    const response = await call('POST', '/api/auth/sign-out', { cookie, origin: 'https://evil.example' })
    expect(response.status).toBe(403)
    expect(await sessionEmail(call, cookie)).toBe('alice@example.com')
  })

  it('cookie を付けて Origin がないリクエストも、ログアウトさせない', async () => {
    const call = createClient()
    const { cookie } = await signUp(call, 'alice@example.com')

    const response = await call('POST', '/api/auth/sign-out', { cookie, origin: null })
    expect(response.status).toBe(403)
    expect(await sessionEmail(call, cookie)).toBe('alice@example.com')
  })
})

describe('Access と BETTER_AUTH_SECRET', () => {
  it('/api/auth/ は Access の JWT がなくても動く（記録の API は 401 のまま）', async () => {
    const call = createClient()

    expect((await signUp(call, 'alice@example.com')).status).toBe(200)
    const meals = await call('GET', '/api/meals')
    expect(meals.status).toBe(401)
    expect((meals.body?.error as { type: string }).type).toBe('Unauthorized')
  })

  it('ログインの cookie だけでは、記録の API は使えない（記録は、まだ Access のログインで読み書きする）', async () => {
    const call = createClient()
    const { cookie } = await signUp(call, 'alice@example.com')

    expect((await call('GET', '/api/meals', { cookie })).status).toBe(401)
  })

  it('BETTER_AUTH_SECRET がないとき、/api/auth/ は 500（AuthConfigurationError）で、秘密の値がないことが分かる', async () => {
    const call = createClient()

    for (const value of [undefined, '', '  ']) {
      const response = await call('GET', '/api/auth/get-session', { env: { BETTER_AUTH_SECRET: value } })
      expect(response.status).toBe(500)
      expect(response.body?.error).toEqual({
        type: 'AuthConfigurationError',
        message: '環境変数 BETTER_AUTH_SECRET を設定してください',
      })
    }
    expect(await count('user')).toBe(0)
  })

  it('BETTER_AUTH_SECRET がなくても、記録の API と /api/health は今までどおり動く', async () => {
    const call = createClient()
    const env = { BETTER_AUTH_SECRET: undefined, DEV_USER_EMAIL: 'alice@example.com' }

    expect((await call('GET', '/api/meals', { env })).status).toBe(200)
    const created = await call('POST', '/api/meals', {
      env,
      body: { date: '2026-11-11', mealType: 'lunch', name: 'うどん', status: 'eaten' },
    })
    expect(created.status).toBe(201)
    expect((await call('GET', '/api/health', { env })).status).toBe(200)
  })
})
