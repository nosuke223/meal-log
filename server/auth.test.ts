import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createApiHandler, type ApiEnv } from './api'
import { ACCESS_JWT_HEADER } from './auth'
import { startTestDatabase, type TestDatabase } from './testDatabase'

const TEAM = 'myteam'
const AUD = 'test-aud-tag'
const ISSUER = `https://${TEAM}.cloudflareaccess.com`
const CERTS_URL = `${ISSUER}/cdn-cgi/access/certs`
const NOW = new Date('2026-11-06T00:00:00.000Z')
const NOW_SECONDS = NOW.getTime() / 1000

let database: TestDatabase
let signingKey: CryptoKey
let otherKey: CryptoKey
let publicJwk: JsonWebKey

beforeAll(async () => {
  database = await startTestDatabase()
  const algorithm = { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }
  const pair = (await crypto.subtle.generateKey(algorithm, true, ['sign', 'verify'])) as CryptoKeyPair
  signingKey = pair.privateKey
  publicJwk = await crypto.subtle.exportKey('jwk', pair.publicKey)
  otherKey = ((await crypto.subtle.generateKey(algorithm, true, ['sign', 'verify'])) as CryptoKeyPair).privateKey
})

afterAll(async () => {
  await database?.dispose()
})

beforeEach(async () => {
  await database.reset()
})

function base64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function encodeJson(value: unknown): string {
  return base64Url(new TextEncoder().encode(JSON.stringify(value)))
}

type TokenOptions = {
  header?: Record<string, unknown>
  claims?: Record<string, unknown>
  key?: CryptoKey
}

async function signToken(options: TokenOptions = {}): Promise<string> {
  const header = { alg: 'RS256', kid: 'key-1', typ: 'JWT', ...options.header }
  const claims = {
    iss: ISSUER,
    aud: [AUD],
    email: 'Alice@Example.com',
    sub: 'user-1',
    iat: NOW_SECONDS - 60,
    nbf: NOW_SECONDS - 60,
    exp: NOW_SECONDS + 3600,
    ...options.claims,
  }
  const input = `${encodeJson(header)}.${encodeJson(claims)}`
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', options.key ?? signingKey, new TextEncoder().encode(input))
  return `${input}.${base64Url(new Uint8Array(signature))}`
}

function createClient() {
  const fetched: string[] = []
  const fakeFetch = (async (input: RequestInfo | URL) => {
    const url = String(input)
    fetched.push(url)
    if (url !== CERTS_URL) return new Response('not found', { status: 404 })
    return Response.json({ keys: [{ ...publicJwk, kid: 'key-1', alg: 'RS256', use: 'sig' }] })
  }) as typeof fetch
  const handle = createApiHandler({ now: () => NOW, fetch: fakeFetch })
  const env: ApiEnv = { DB: database.db, ACCESS_TEAM_NAME: TEAM, ACCESS_AUD: AUD }

  async function call(token: string | null, envOverrides: Partial<ApiEnv> = {}, init: RequestInit = {}) {
    const headers = new Headers(init.headers)
    if (token !== null) headers.set(ACCESS_JWT_HEADER, token)
    const response = await handle(new Request('https://meal-log.example/api/meals', { ...init, headers }), {
      ...env,
      ...envOverrides,
    })
    return { status: response.status, body: await response.json() }
  }
  return { call, fetched }
}

describe('Cloudflare Access の JWT', () => {
  it('正しい JWT なら、中のメールアドレス（小文字）の人として扱う', async () => {
    const { call, fetched } = createClient()
    const token = await signToken()
    const created = await call(token, {}, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: '2026-11-06', mealType: 'lunch', name: 'ご飯', status: 'eaten' }),
    })
    expect(created.status).toBe(201)

    const mine = await call(token)
    expect(mine.status).toBe(200)
    expect(mine.body.meals).toEqual([created.body.meal])
    // 認証を省いて、同じメールアドレス（小文字）の人として見ると、同じ記録が見える
    expect((await call(null, { DEV_USER_EMAIL: 'alice@example.com' })).body.meals).toEqual([created.body.meal])
    // 公開鍵は、チームの決まったアドレスから取得し、使い回す
    expect(fetched).toEqual([CERTS_URL])
  })

  it('aud が文字列1つでも受け付ける', async () => {
    const { call } = createClient()

    expect((await call(await signToken({ claims: { aud: AUD } }))).status).toBe(200)
  })

  it('JWT がなければ 401', async () => {
    const { call } = createClient()
    const response = await call(null)

    expect(response.status).toBe(401)
    expect(response.body.error.type).toBe('Unauthorized')
  })

  const invalidTokens: [string, () => Promise<string>][] = [
    ['期限切れ', () => signToken({ claims: { exp: NOW_SECONDS - 1 } })],
    ['期限がちょうど今', () => signToken({ claims: { exp: NOW_SECONDS } })],
    ['期限がない', () => signToken({ claims: { exp: undefined } })],
    ['まだ有効でない（nbf が未来）', () => signToken({ claims: { nbf: NOW_SECONDS + 60 } })],
    ['別の鍵で署名した', () => signToken({ key: otherKey })],
    ['知らない kid', () => signToken({ header: { kid: 'unknown' } })],
    ['別のアルゴリズム', () => signToken({ header: { alg: 'HS256' } })],
    ['alg が none', async () => `${encodeJson({ alg: 'none', kid: 'key-1' })}.${encodeJson({ iss: ISSUER, aud: [AUD], email: 'a@example.com', exp: NOW_SECONDS + 60 })}.`],
    ['別の AUD', () => signToken({ claims: { aud: ['other-aud'] } })],
    ['別のチームの発行', () => signToken({ claims: { iss: 'https://other.cloudflareaccess.com' } })],
    ['メールアドレスがない', () => signToken({ claims: { email: undefined } })],
    ['メールアドレスが空', () => signToken({ claims: { email: ' ' } })],
    [
      '中身を書き換えた',
      async () => {
        const [header, , signature] = (await signToken()).split('.')
        return `${header}.${encodeJson({ iss: ISSUER, aud: [AUD], email: 'bob@example.com', exp: NOW_SECONDS + 3600 })}.${signature}`
      },
    ],
    ['形が違う', async () => 'not-a-jwt'],
    ['base64url でない', async () => 'a.b.c!'],
  ]

  it.each(invalidTokens)('%s の JWT なら 401', async (_, makeToken) => {
    const { call } = createClient()
    const response = await call(await makeToken())

    expect(response.status).toBe(401)
    expect(response.body.error.type).toBe('Unauthorized')
  })

  it('JWT が不正なら、書き込みもできない', async () => {
    const { call } = createClient()
    const response = await call(await signToken({ claims: { exp: NOW_SECONDS - 1 } }), {}, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ records: [] }),
    })

    expect(response.status).toBe(401)
  })
})

describe('認証を省く環境変数（DEV_USER_EMAIL）', () => {
  it('設定されていないときは、認証を省けない（JWT がなければ 401）', async () => {
    const { call } = createClient()

    expect((await call(null, { DEV_USER_EMAIL: undefined })).status).toBe(401)
    expect((await call(null, { DEV_USER_EMAIL: '' })).status).toBe(401)
    expect((await call(null, { DEV_USER_EMAIL: '  ' })).status).toBe(401)
  })

  it('設定されているときは、JWT を検証せずに、その人として扱う', async () => {
    const { call, fetched } = createClient()

    expect((await call(null, { DEV_USER_EMAIL: 'dev@example.com' })).status).toBe(200)
    expect(fetched).toEqual([])
  })
})

describe('認証の設定', () => {
  it.each([
    ['チーム名がない', { ACCESS_TEAM_NAME: undefined }],
    ['AUD タグがない', { ACCESS_AUD: undefined }],
    ['チーム名に使えない文字がある', { ACCESS_TEAM_NAME: 'evil.example.com/' }],
  ])('%s なら 500（AuthConfigurationError）', async (_, overrides) => {
    const { call } = createClient()
    const response = await call(await signToken(), overrides)

    expect(response.status).toBe(500)
    expect(response.body.error.type).toBe('AuthConfigurationError')
  })
})
