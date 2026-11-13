import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { AUTH_MESSAGES } from '../src/auth/authClient'
import { createApiHandler } from './api'
import type { D1Database } from './d1'
import { createMemoryTransport } from './mail/mailer'
import { AUTH_RATE_LIMITS, TOO_MANY_REQUESTS_MESSAGE } from './memberAuth'
import { overrideDatabase, startTestDatabase, type TestDatabase } from './testDatabase'
import { createTestMember, TEST_ORIGIN, TEST_PASSWORD, testEnv, type TestMember } from './testMember'

// 退会（POST /api/auth/delete-user）。マイグレーションで作った D1（wrangler の Miniflare）で確かめる

let database: TestDatabase
const handle = createApiHandler({ mailTransport: createMemoryTransport() })

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

type CallOptions = {
  body?: unknown
  cookie?: string
  /** Origin のヘッダー（既定は同じオリジン。null なら付けない） */
  origin?: string | null
  /** 利用者の IP アドレス（Cloudflare の CF-Connecting-IP） */
  ip?: string
  db?: D1Database
}

type CallResult = { status: number; headers: Headers; body: Record<string, unknown> | null }

async function call(method: string, path: string, options: CallOptions = {}): Promise<CallResult> {
  const headers = new Headers({ 'CF-Connecting-IP': options.ip ?? '203.0.113.1' })
  if (method !== 'GET') headers.set('Content-Type', 'application/json')
  const origin = options.origin === undefined ? TEST_ORIGIN : options.origin
  if (origin !== null && method !== 'GET') headers.set('Origin', origin)
  if (options.cookie) headers.set('Cookie', options.cookie)
  const request = new Request(`${TEST_ORIGIN}${path}`, {
    method,
    headers,
    body: method === 'GET' ? undefined : JSON.stringify(options.body ?? {}),
  })
  const response = await handle(request, testEnv(options.db ?? database.db))
  const text = await response.text()
  return { status: response.status, headers: response.headers, body: text === '' ? null : JSON.parse(text) }
}

function deleteUser(member: TestMember | null, body: unknown, options: CallOptions = {}): Promise<CallResult> {
  return call('POST', '/api/auth/delete-user', { body, cookie: member?.cookie, ...options })
}

const lunch = { date: '2026-11-11', mealType: 'lunch', name: 'うどん', status: 'eaten' }

/** 記録を入れ、有料のプランにし、パスワードの再設定を求めて（確認用の行を作り）、会員の行をそろえる */
async function fillMember(member: TestMember): Promise<void> {
  expect((await call('POST', '/api/meals', { body: lunch, cookie: member.cookie })).status).toBe(201)
  expect((await call('POST', '/api/meals', { body: { ...lunch, name: 'そば' }, cookie: member.cookie })).status).toBe(201)
  await database.db
    .prepare(`INSERT INTO member_plans (user_id, plan, updated_at) VALUES (?, 'paid', '2026-11-13T00:00:00.000Z')`)
    .bind(member.id)
    .run()
  const reset = await call('POST', '/api/auth/request-password-reset', {
    body: { email: member.email },
    ip: `192.0.2.${member.email.length}`,
  })
  expect(reset.status).toBe(200)
}

/** 会員に結びつく行の数（表ごと） */
async function rowsOf(memberId: string): Promise<Record<string, number>> {
  const queries: Record<string, string> = {
    member_meals: 'SELECT COUNT(*) AS count FROM member_meals WHERE user_id = ?',
    member_plans: 'SELECT COUNT(*) AS count FROM member_plans WHERE user_id = ?',
    verification: 'SELECT COUNT(*) AS count FROM "verification" WHERE "value" = ?',
    session: 'SELECT COUNT(*) AS count FROM "session" WHERE "userId" = ?',
    account: 'SELECT COUNT(*) AS count FROM "account" WHERE "userId" = ?',
    user: 'SELECT COUNT(*) AS count FROM "user" WHERE "id" = ?',
  }
  const counts: Record<string, number> = {}
  for (const [table, query] of Object.entries(queries)) {
    counts[table] = (await database.db.prepare(query).bind(memberId).first<{ count: number }>())?.count ?? 0
  }
  return counts
}

const FILLED = { member_meals: 2, member_plans: 1, verification: 1, session: 1, account: 1, user: 1 }
const EMPTY = { member_meals: 0, member_plans: 0, verification: 0, session: 0, account: 0, user: 0 }

describe('退会', () => {
  it('パスワードを添えると、その会員の記録、プラン、確認用の行、ログインの状態、ログインの方法、会員の行が消え、cookie も消える', async () => {
    const alice = await createTestMember(handle, database.db, 'alice@example.com')
    await fillMember(alice)
    expect(await rowsOf(alice.id)).toEqual(FILLED)

    const response = await deleteUser(alice, { password: TEST_PASSWORD })
    expect(response.status).toBe(200)
    expect(await rowsOf(alice.id)).toEqual(EMPTY)
    // ログアウトと同じく、セッションの cookie を消す
    const cleared = response.headers.getSetCookie().find((value) => /session_token=/.test(value))
    expect(cleared).toMatch(/Max-Age=0/)
  })

  it('ほかの会員の記録、プラン、確認用の行、ログインの状態には触れない', async () => {
    const alice = await createTestMember(handle, database.db, 'alice@example.com')
    const bob = await createTestMember(handle, database.db, 'bob@example.com')
    await fillMember(alice)
    await fillMember(bob)

    expect((await deleteUser(alice, { password: TEST_PASSWORD })).status).toBe(200)
    expect(await rowsOf(bob.id)).toEqual(FILLED)
    const listed = await call('GET', '/api/meals', { cookie: bob.cookie })
    expect(listed.status).toBe(200)
    expect(listed.body?.meals).toHaveLength(2)
  })

  it('パスワードが違うと 400 で、何も消えない', async () => {
    const alice = await createTestMember(handle, database.db, 'alice@example.com')
    await fillMember(alice)

    const response = await deleteUser(alice, { password: 'wrong-password' })
    expect(response.status).toBe(400)
    expect(response.body?.code).toBe('INVALID_PASSWORD')
    expect(await rowsOf(alice.id)).toEqual(FILLED)
  })

  it('パスワードがない、または空なら、ログインして間もないセッションでも 400 で、何も消えない', async () => {
    const alice = await createTestMember(handle, database.db, 'alice@example.com')
    await fillMember(alice)

    for (const body of [{}, { password: '' }, { password: null }]) {
      const response = await deleteUser(alice, body)
      expect(response.status).toBe(400)
      expect(response.body).toEqual({ code: 'INVALID_PASSWORD', message: AUTH_MESSAGES.wrongPassword })
    }
    expect(await rowsOf(alice.id)).toEqual(FILLED)
  })

  it('確認のメールのトークンだけでは消えない。確認のメールのリンクの入口（/delete-user/callback）は 404', async () => {
    const alice = await createTestMember(handle, database.db, 'alice@example.com')
    await fillMember(alice)

    expect((await deleteUser(alice, { token: 'any-token' })).status).toBe(400)
    const callback = await call('GET', '/api/auth/delete-user/callback?token=any-token', { cookie: alice.cookie })
    expect(callback.status).toBe(404)
    expect(await rowsOf(alice.id)).toEqual(FILLED)
  })

  it('ログインしていない（cookie がない、ログアウト済み、正しくない cookie）ときは 401 で、何も消えない', async () => {
    const alice = await createTestMember(handle, database.db, 'alice@example.com')
    await fillMember(alice)
    const loggedOut = await createTestMember(handle, database.db, 'bob@example.com')
    expect((await call('POST', '/api/auth/sign-out', { cookie: loggedOut.cookie })).status).toBe(200)

    for (const cookie of [undefined, loggedOut.cookie, 'better-auth.session_token=invalid']) {
      const response = await deleteUser(null, { password: TEST_PASSWORD }, { cookie })
      expect(response.status).toBe(401)
      expect(response.body?.code).toBe('UNAUTHORIZED')
    }
    expect(await rowsOf(alice.id)).toEqual(FILLED)
    expect((await rowsOf(loggedOut.id)).user).toBe(1)
  })

  it('メールアドレスの確認前の会員は 401 で、何も消えない', async () => {
    const alice = await createTestMember(handle, database.db, 'alice@example.com')
    await database.db.prepare('UPDATE "user" SET "emailVerified" = 0 WHERE "id" = ?').bind(alice.id).run()

    expect((await deleteUser(alice, { password: TEST_PASSWORD })).status).toBe(401)
    expect((await rowsOf(alice.id)).user).toBe(1)
  })

  it('ログインの期限が切れていると 401 で、何も消えない', async () => {
    const alice = await createTestMember(handle, database.db, 'alice@example.com')
    await database.db
      .prepare(`UPDATE "session" SET "expiresAt" = '2000-01-01T00:00:00.000Z' WHERE "userId" = ?`)
      .bind(alice.id)
      .run()

    expect((await deleteUser(alice, { password: TEST_PASSWORD })).status).toBe(401)
    expect((await rowsOf(alice.id)).user).toBe(1)
  })

  it('退会の後、古い cookie で記録の API を呼ぶと 401', async () => {
    const alice = await createTestMember(handle, database.db, 'alice@example.com')
    await fillMember(alice)
    expect((await deleteUser(alice, { password: TEST_PASSWORD })).status).toBe(200)

    const listed = await call('GET', '/api/meals', { cookie: alice.cookie })
    expect(listed.status).toBe(401)
    expect((listed.body?.error as { type: string }).type).toBe('Unauthorized')
    expect((await call('POST', '/api/meals', { body: lunch, cookie: alice.cookie })).status).toBe(401)
    // 同じ cookie でもう一度退会しようとしても 401
    expect((await deleteUser(alice, { password: TEST_PASSWORD })).status).toBe(401)
  })

  it('他のオリジンからのリクエストと、Origin のないリクエストは 403 で、何も消えない', async () => {
    const alice = await createTestMember(handle, database.db, 'alice@example.com')
    await fillMember(alice)

    expect((await deleteUser(alice, { password: TEST_PASSWORD }, { origin: 'https://evil.example' })).status).toBe(403)
    expect((await deleteUser(alice, { password: TEST_PASSWORD }, { origin: null })).status).toBe(403)
    expect(await rowsOf(alice.id)).toEqual(FILLED)
  })

  it(`同じ IP アドレスから ${AUTH_RATE_LIMITS['/delete-user'].max} 回を超えると 429 で、日本語の説明を返す`, async () => {
    const alice = await createTestMember(handle, database.db, 'alice@example.com')
    const { max } = AUTH_RATE_LIMITS['/delete-user']

    for (let attempt = 0; attempt < max; attempt++) {
      expect((await deleteUser(alice, { password: 'wrong-password' }, { ip: '203.0.113.50' })).status).toBe(400)
    }
    // 上限を超えると、正しいパスワードでも断られる
    const limited = await deleteUser(alice, { password: TEST_PASSWORD }, { ip: '203.0.113.50' })
    expect(limited.status).toBe(429)
    expect(limited.body).toEqual({ code: 'TOO_MANY_REQUESTS', message: TOO_MANY_REQUESTS_MESSAGE })
    expect((await rowsOf(alice.id)).user).toBe(1)
  })

  it('消す途中で失敗したら、何も消えていない（1回の batch で消す）', async () => {
    const alice = await createTestMember(handle, database.db, 'alice@example.com')
    await fillMember(alice)
    // 消す文の途中に、失敗する文を入れる
    const failing = overrideDatabase(database.db, {
      batch: (statements) =>
        database.db.batch([...statements.slice(0, 3), database.db.prepare('DELETE FROM no_such_table'), ...statements.slice(3)]),
    })
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const response = await deleteUser(alice, { password: TEST_PASSWORD }, { db: failing })
    expect(response.status).toBe(500)
    expect(await rowsOf(alice.id)).toEqual(FILLED)
    // 消えていないので、まだ使える
    expect((await call('GET', '/api/meals', { cookie: alice.cookie })).status).toBe(200)
  })

  it('退会の後は、同じメールアドレスとパスワードでログインできない。登録し直すと新しい会員になり、記録は0件', async () => {
    const alice = await createTestMember(handle, database.db, 'alice@example.com')
    await fillMember(alice)
    expect((await deleteUser(alice, { password: TEST_PASSWORD })).status).toBe(200)

    const signIn = await call('POST', '/api/auth/sign-in/email', {
      body: { email: 'alice@example.com', password: TEST_PASSWORD },
      ip: '203.0.113.60',
    })
    expect(signIn.status).toBe(401)

    const again = await createTestMember(handle, database.db, 'alice@example.com')
    expect(again.id).not.toBe(alice.id)
    const listed = await call('GET', '/api/meals', { cookie: again.cookie })
    expect(listed.status).toBe(200)
    expect(listed.body?.meals).toEqual([])
    const plan = await call('GET', '/api/plan', { cookie: again.cookie })
    expect(plan.body).toMatchObject({ plan: 'free', count: 0 })
  })
})
