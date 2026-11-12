// テスト用の会員。API で会員登録し、D1 で確認済みにして（確認のメールのリンクを開く代わり）、ログインする。
// 記録の API のテストで、ログインの cookie を作るのに使う

import type { ApiEnv } from './api'
import type { D1Database } from './d1'

export const TEST_ORIGIN = 'https://meal-log.example'
export const TEST_SECRET = 'test-only-better-auth-secret-0123456789abcdef'
export const TEST_PASSWORD = 'correct-horse-battery'
export const TEST_MAIL_FROM = 'onboarding@resend.dev'

export type ApiHandle = (request: Request, env: ApiEnv) => Promise<Response>

export type TestMember = {
  /** 会員の ID（表 "user" の id） */
  id: string
  email: string
  /** ログインの cookie（Cookie のヘッダーにそのまま入れる） */
  cookie: string
}

/** テストで API に渡す環境変数（D1、秘密の値、メールの送信元） */
export function testEnv(db: D1Database): ApiEnv {
  return { DB: db, BETTER_AUTH_SECRET: TEST_SECRET, MAIL_FROM: TEST_MAIL_FROM }
}

/**
 * 会員登録し、確認済みにして、ログインする。handle は、メールを送らない部分（mailTransport）を差し替えた API。
 * 試す回数の上限に当たらないよう、呼ぶたびに別の接続元（CF-Connecting-IP）にする
 */
export async function createTestMember(handle: ApiHandle, db: D1Database, email: string): Promise<TestMember> {
  const signedUp = await post(handle, db, '/api/auth/sign-up/email', { email, password: TEST_PASSWORD, name: '' })
  if (signedUp.status !== 200) throw new Error(`会員登録できませんでした（${signedUp.status}）`)
  await db.prepare('UPDATE "user" SET "emailVerified" = 1 WHERE "email" = ?').bind(email.toLowerCase()).run()
  return signInTestMember(handle, db, email)
}

/** 登録済みで確認済みの会員でログインする（別の端末でログインしたときの、別のセッション） */
export async function signInTestMember(handle: ApiHandle, db: D1Database, email: string): Promise<TestMember> {
  const response = await post(handle, db, '/api/auth/sign-in/email', { email, password: TEST_PASSWORD })
  if (response.status !== 200) throw new Error(`ログインできませんでした（${response.status}）`)
  const body = (await response.json()) as { user: { id: string; email: string } }
  const cookie = response.headers
    .getSetCookie()
    .map((setCookie) => setCookie.split(';')[0])
    .join('; ')
  return { id: body.user.id, email: body.user.email, cookie }
}

let ipCount = 0

function post(handle: ApiHandle, db: D1Database, path: string, body: unknown): Promise<Response> {
  ipCount++
  const request = new Request(`${TEST_ORIGIN}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: TEST_ORIGIN,
      'CF-Connecting-IP': `198.51.100.${ipCount % 250}`,
    },
    body: JSON.stringify(body),
  })
  return handle(request, testEnv(db))
}
