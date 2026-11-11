import { getMigrations } from 'better-auth/db/migration'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApiHandler, type ApiEnv, type ApiOptions } from './api'
import { MAIL_RATE_LIMIT } from './mail/mailRateLimit'
import { createMailer, createMemoryTransport, MailSendError, type MailMessage, type MailTransport } from './mail/mailer'
import {
  AUTH_RATE_LIMITS,
  EMAIL_VERIFICATION_EXPIRES_IN,
  memberAuthOptions,
  TOO_MANY_REQUESTS_MESSAGE,
} from './memberAuth'
import { startTestDatabase, type TestDatabase } from './testDatabase'

// 会員の登録とログイン（/api/auth/）。マイグレーションで作った D1（wrangler の Miniflare）で確かめる。
// メールは偽物の送る部分（メモリー）にためて、宛先、件名、リンクを確かめる

let database: TestDatabase
/** このテストで「送った」メール */
let mailbox: ReturnType<typeof createMemoryTransport>

beforeAll(async () => {
  database = await startTestDatabase()
})

afterAll(async () => {
  await database?.dispose()
})

beforeEach(async () => {
  await database.reset()
  vi.restoreAllMocks()
  mailbox = createMemoryTransport()
})

afterEach(() => {
  vi.useRealTimers()
})

const ORIGIN = 'https://meal-log.example'
const SECRET = 'test-only-better-auth-secret-0123456789abcdef'
const PASSWORD = 'correct-horse-battery'
const MAIL_FROM = 'onboarding@resend.dev'

type CallOptions = {
  body?: unknown
  /** 送る cookie（name=value; …） */
  cookie?: string
  /** Origin のヘッダー（既定は同じオリジン。null なら付けない） */
  origin?: string | null
  /** 利用者の IP アドレス（Cloudflare の CF-Connecting-IP） */
  ip?: string
  /** 環境変数（既定は Access の設定と BETTER_AUTH_SECRET と MAIL_FROM。DEV_USER_EMAIL はない＝Access の JWT が要る） */
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

/** API を呼ぶ関数を作る。メールは、既定ではこのテストの mailbox にためる */
function createClient(options: Pick<ApiOptions, 'mailTransport'> = {}) {
  const handle = createApiHandler({
    fetch: () => Promise.reject(new Error('Access の公開鍵は取りに行かない')),
    mailTransport: 'mailTransport' in options ? options.mailTransport : mailbox,
  })
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
      MAIL_FROM,
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

function resend(call: Call, email: string, options: CallOptions = {}) {
  return call('POST', '/api/auth/send-verification-email', { body: { email }, ...options })
}

/** 宛先が to のメール */
function mailsTo(to: string): MailMessage[] {
  return mailbox.messages.filter((message) => message.to === to)
}

/** 宛先が to の、最後の確認のメールのリンク */
function verificationLink(to: string): string {
  const mail = mailsTo(to)
    .filter((message) => message.subject === '【meal-log】メールアドレスの確認')
    .at(-1)
  if (mail === undefined) throw new Error('確認のメールがありません')
  const link = /https?:\/\/\S+\/verify-email\?\S+/.exec(mail.text)?.[0]
  if (link === undefined) throw new Error('確認のメールにリンクがありません')
  return link
}

/** リンクを開く（GET）。転送先（Location）を返す */
async function openLink(call: Call, link: string, options: CallOptions = {}): Promise<CallResult & { location: string | null }> {
  const url = new URL(link)
  const result = await call('GET', `${url.pathname}${url.search}`, { base: url.origin, ...options })
  return { ...result, location: result.headers.get('Location') }
}

/** 登録して、確認のメールのリンクを開いて確認し、ログインする。ログインの結果を返す */
async function signUpAndSignIn(call: Call, email: string, options: CallOptions = {}): Promise<CallResult> {
  expect((await signUp(call, email, PASSWORD, options)).status).toBe(200)
  const opened = await openLink(call, verificationLink(email.toLowerCase()), { ip: options.ip })
  expect(opened.location).toBe(`${options.base ?? ORIGIN}/#/login/verified`)
  const signedIn = await signIn(call, email, PASSWORD, options)
  expect(signedIn.status).toBe(200)
  return signedIn
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
    const mailer = createMailer({ MAIL_FROM }, { transport: mailbox })
    const { toBeCreated, toBeAdded, toBeAddedIndexes } = await getMigrations(
      memberAuthOptions(ORIGIN, SECRET, database.db, mailer),
    )
    expect(toBeCreated).toEqual([])
    expect(toBeAdded).toEqual([])
    expect(toBeAddedIndexes).toEqual([])
  })
})

describe('会員登録とメールアドレスの確認', () => {
  it('登録すると確認のメールが届き、登録した直後はログインした状態にならず、ログインもできない', async () => {
    const call = createClient()

    const signedUp = await signUp(call, 'Alice@Example.com')
    expect(signedUp.status).toBe(200)
    expect(signedUp.headers.get('Cache-Control')).toBe('no-store')
    expect(signedUp.body?.token).toBeNull()
    expect(signedUp.cookie).toBe('')
    expect(await count('user')).toBe(1)
    expect(await count('session')).toBe(0)

    // 宛先（小文字）、送信元、件名、リンク
    expect(mailbox.messages).toHaveLength(1)
    const [mail] = mailbox.messages
    expect(mail.to).toBe('alice@example.com')
    expect(mail.from).toBe(`meal-log <${MAIL_FROM}>`)
    expect(mail.subject).toBe('【meal-log】メールアドレスの確認')
    const link = verificationLink('alice@example.com')
    expect(link).toMatch(new RegExp(`^${ORIGIN}/api/auth/verify-email\\?token=[\\w.-]+$`))
    expect(mail.html).toContain(`href="${link}"`)

    const signedIn = await signIn(call, 'alice@example.com')
    expect(signedIn.status).toBe(403)
    expect(signedIn.body?.code).toBe('EMAIL_NOT_VERIFIED')
    expect(signedIn.cookie).toBe('')
  })

  it('リンクを開くと確認でき、ログインの画面（#/login/verified）に移る。リンクを開いた端末ではログインした状態にならない', async () => {
    const call = createClient()
    await signUp(call, 'alice@example.com')

    const opened = await openLink(call, verificationLink('alice@example.com'))
    expect(opened.status).toBe(303)
    expect(opened.location).toBe(`${ORIGIN}/#/login/verified`)
    expect(opened.headers.get('Cache-Control')).toBe('no-store')
    expect(opened.cookie).toBe('')
    expect(await count('session')).toBe(0)

    const signedIn = await signIn(call, 'alice@example.com')
    expect(signedIn.status).toBe(200)
    expect(await sessionEmail(call, signedIn.cookie)).toBe('alice@example.com')
  })

  it('同じリンクをもう一度開くと、使用済み（#/login/link-used）になる', async () => {
    const call = createClient()
    await signUp(call, 'alice@example.com')
    const link = verificationLink('alice@example.com')

    expect((await openLink(call, link)).location).toBe(`${ORIGIN}/#/login/verified`)
    const again = await openLink(call, link)
    expect(again.status).toBe(303)
    expect(again.location).toBe(`${ORIGIN}/#/login/link-used`)
  })

  it(`リンクの有効期限は24時間（${EMAIL_VERIFICATION_EXPIRES_IN} 秒）。過ぎると期限切れ（#/login/link-expired）になり、送り直したリンクで確認できる`, async () => {
    expect(EMAIL_VERIFICATION_EXPIRES_IN).toBe(24 * 60 * 60)
    const start = new Date('2026-11-11T00:00:00Z')
    vi.useFakeTimers({ toFake: ['Date'], now: start })
    const call = createClient()
    await signUp(call, 'alice@example.com')
    const link = verificationLink('alice@example.com')

    vi.setSystemTime(start.getTime() + (EMAIL_VERIFICATION_EXPIRES_IN + 1) * 1000)
    const expired = await openLink(call, link)
    expect(expired.location).toBe(`${ORIGIN}/#/login/link-expired`)
    expect((await signIn(call, 'alice@example.com')).status).toBe(403)

    // 送り直す
    expect((await resend(call, 'alice@example.com')).status).toBe(200)
    const newLink = verificationLink('alice@example.com')
    expect(newLink).not.toBe(link)
    expect((await openLink(call, newLink)).location).toBe(`${ORIGIN}/#/login/verified`)
    expect((await signIn(call, 'alice@example.com')).status).toBe(200)
  })

  it('24時間の少し前までは、リンクを使える', async () => {
    const start = new Date('2026-11-11T00:00:00Z')
    vi.useFakeTimers({ toFake: ['Date'], now: start })
    const call = createClient()
    await signUp(call, 'alice@example.com')

    vi.setSystemTime(start.getTime() + (EMAIL_VERIFICATION_EXPIRES_IN - 60) * 1000)
    expect((await openLink(call, verificationLink('alice@example.com'))).location).toBe(`${ORIGIN}/#/login/verified`)
  })

  it('正しくないリンクは、#/login/link-invalid になる（トークンがない、壊れている、別の秘密の値で作られた）', async () => {
    const call = createClient()
    await signUp(call, 'alice@example.com')
    const token = new URL(verificationLink('alice@example.com')).searchParams.get('token') ?? ''
    const [header, payload] = token.split('.')

    for (const path of [
      '/api/auth/verify-email',
      '/api/auth/verify-email?token=',
      '/api/auth/verify-email?token=not-a-token',
      `/api/auth/verify-email?token=${header}.${payload}.forged-signature`,
    ]) {
      const opened = await openLink(call, `${ORIGIN}${path}`)
      expect(opened.status, path).toBe(303)
      expect(opened.location, path).toBe(`${ORIGIN}/#/login/link-invalid`)
    }
    expect((await signIn(call, 'alice@example.com')).status).toBe(403)
  })

  it('確認前にログインしようとしたら 403（EMAIL_NOT_VERIFIED）で、確認のメールを送り直せる', async () => {
    const call = createClient()
    await signUp(call, 'alice@example.com')
    expect((await signIn(call, 'alice@example.com')).body?.code).toBe('EMAIL_NOT_VERIFIED')
    // ログインしようとしただけでは送らない
    expect(mailsTo('alice@example.com')).toHaveLength(1)

    const resent = await resend(call, 'alice@example.com')
    expect(resent.status).toBe(200)
    expect(resent.body).toEqual({ status: true })
    expect(mailsTo('alice@example.com')).toHaveLength(2)
    expect((await openLink(call, verificationLink('alice@example.com'))).location).toBe(`${ORIGIN}/#/login/verified`)
  })

  it('パスワードが違うときは、確認の前でも 401（INVALID_EMAIL_OR_PASSWORD）', async () => {
    const call = createClient()
    await signUp(call, 'alice@example.com')

    const response = await signIn(call, 'alice@example.com', 'wrong-password')
    expect(response.status).toBe(401)
    expect(response.body?.code).toBe('INVALID_EMAIL_OR_PASSWORD')
  })

  it('送り直しは、登録されていない、または確認済みのメールアドレスでも同じ応答で、メールは送らない', async () => {
    const call = createClient()
    await signUpAndSignIn(call, 'alice@example.com')
    const before = mailbox.messages.length

    for (const email of ['nobody@example.com', 'alice@example.com']) {
      const response = await resend(call, email)
      expect(response.status).toBe(200)
      expect(response.body).toEqual({ status: true })
    }
    expect(mailbox.messages).toHaveLength(before)
  })
})

describe('すでに登録されているメールアドレスでの登録', () => {
  it('登録できたときと同じ応答で、会員は増えず、パスワードも変わらない。「すでに登録されています」のメールを送る', async () => {
    const call = createClient()
    const first = await signUp(call, 'alice@example.com')
    await openLink(call, verificationLink('alice@example.com'))

    const again = await signUp(call, 'Alice@Example.com', 'another-password')
    expect(again.status).toBe(first.status)
    expect(again.body?.token).toBeNull()
    expect(Object.keys(again.body ?? {}).sort()).toEqual(Object.keys(first.body ?? {}).sort())
    expect(Object.keys((again.body?.user as object) ?? {}).sort()).toEqual(Object.keys((first.body?.user as object) ?? {}).sort())
    expect(again.cookie).toBe('')
    expect(await count('user')).toBe(1)
    expect((await signIn(call, 'alice@example.com')).status).toBe(200)
    expect((await signIn(call, 'alice@example.com', 'another-password')).status).toBe(401)

    const mails = mailsTo('alice@example.com')
    expect(mails.map((mail) => mail.subject)).toEqual([
      '【meal-log】メールアドレスの確認',
      '【meal-log】このメールアドレスはすでに登録されています',
    ])
    expect(mails[1].text).toContain('ログインするか、パスワードを再設定してください')
    expect(mails[1].text).toContain(`${ORIGIN}/#/login`)
    expect(mails[1].from).toBe(`meal-log <${MAIL_FROM}>`)
  })
})

describe('ログインできないとき', () => {
  it('存在しないメールアドレスのときは、パスワードが違うときと同じ 401', async () => {
    const call = createClient()

    const response = await signIn(call, 'nobody@example.com')
    expect(response.status).toBe(401)
    expect(response.body?.code).toBe('INVALID_EMAIL_OR_PASSWORD')
    expect(response.cookie).toBe('')
  })

  it('パスワードが8文字より短いときは 400 で、登録されず、メールも送らない（8文字なら登録できる）', async () => {
    const call = createClient()

    const response = await signUp(call, 'alice@example.com', '1234567')
    expect(response.status).toBe(400)
    expect(response.body?.code).toBe('PASSWORD_TOO_SHORT')
    expect(await count('user')).toBe(0)
    expect(mailbox.messages).toHaveLength(0)

    expect((await signUp(call, 'alice@example.com', '12345678')).status).toBe(200)
  })

  it('メールアドレスの形が正しくないときは 400 で、登録されない', async () => {
    const call = createClient()

    const response = await signUp(call, 'not-an-email')
    expect(response.status).toBe(400)
    expect(await count('user')).toBe(0)
  })
})

describe('ログインとログアウト', () => {
  it('確認した後は、ログインでき、ログアウトでき、もう一度ログインできる', async () => {
    const call = createClient()
    const signedIn = await signUpAndSignIn(call, 'alice@example.com')
    expect(await sessionEmail(call, signedIn.cookie)).toBe('alice@example.com')

    const signedOut = await call('POST', '/api/auth/sign-out', { cookie: signedIn.cookie })
    expect(signedOut.status).toBe(200)
    expect(await sessionEmail(call, signedIn.cookie)).toBeNull()

    const again = await signIn(call, 'alice@example.com')
    expect(again.status).toBe(200)
    expect(await sessionEmail(call, again.cookie)).toBe('alice@example.com')
  })

  it('ログアウトの後は、前のセッションの cookie を送っても使えない（D1 からセッションが消える）', async () => {
    const call = createClient()
    const signedIn = await signUpAndSignIn(call, 'alice@example.com')
    expect(await count('session')).toBe(1)

    await call('POST', '/api/auth/sign-out', { cookie: signedIn.cookie })
    expect(await count('session')).toBe(0)
    expect(await sessionEmail(call, signedIn.cookie)).toBeNull()
  })

  it('メールアドレスは大文字と小文字を区別しない（小文字にそろえて保存する）', async () => {
    const call = createClient()
    await signUpAndSignIn(call, 'A@x.com')

    const signedIn = await signIn(call, 'a@x.com')
    expect(signedIn.status).toBe(200)
    expect(await sessionEmail(call, signedIn.cookie)).toBe('a@x.com')
  })
})

describe('セッションの cookie', () => {
  it('https では HttpOnly、Secure、SameSite=Lax が付く', async () => {
    const call = createClient()
    const setCookie = sessionSetCookie(await signUpAndSignIn(call, 'alice@example.com'))

    expect(setCookie).toMatch(/^__Secure-/)
    expect(setCookie).toMatch(/;\s*HttpOnly/i)
    expect(setCookie).toMatch(/;\s*Secure/i)
    expect(setCookie).toMatch(/;\s*SameSite=Lax/i)
    expect(setCookie).toMatch(/;\s*Path=\//i)
  })

  it('手元の http では Secure を付けない（HttpOnly と SameSite=Lax は付く）', async () => {
    const call = createClient()
    const base = 'http://localhost:5173'
    const response = await signUpAndSignIn(call, 'alice@example.com', { base })
    const setCookie = sessionSetCookie(response)

    expect(setCookie).not.toMatch(/;\s*Secure/i)
    expect(setCookie).toMatch(/;\s*HttpOnly/i)
    expect(setCookie).toMatch(/;\s*SameSite=Lax/i)
    expect(await sessionEmail(call, response.cookie, { base })).toBe('alice@example.com')
  })
})

describe('MAIL_ALLOWED_TO（プレビュー用）', () => {
  it('宛先が違うときは送らず、登録はエラーにならず、送ったときと同じ応答になる。記録には宛先を出さない', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const call = createClient()
    const env = { MAIL_ALLOWED_TO: 'owner@example.com' }

    const response = await signUp(call, 'alice@example.com', PASSWORD, { env })
    expect(response.status).toBe(200)
    expect(response.body?.token).toBeNull()
    expect(await count('user')).toBe(1)
    expect(mailbox.messages).toHaveLength(0)
    expect(info).toHaveBeenCalledWith(expect.stringContaining('送り先が許可されていないので送らなかった'))
    expect(JSON.stringify(info.mock.calls)).not.toContain('alice@example.com')

    expect((await resend(call, 'alice@example.com', { env })).status).toBe(200)
    expect(mailbox.messages).toHaveLength(0)
  })

  it('宛先が同じなら送る', async () => {
    const call = createClient()
    const env = { MAIL_ALLOWED_TO: 'Owner@Example.com' }

    expect((await signUp(call, 'owner@example.com', PASSWORD, { env })).status).toBe(200)
    expect(mailsTo('owner@example.com')).toHaveLength(1)
  })
})

describe('メールを送れないとき', () => {
  /** 記録（console）に出たものをすべて文字にする */
  function spyConsole() {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => {}),
    )
    return () => spies.map((spy) => JSON.stringify(spy.mock.calls, (_, value: unknown) => (value instanceof Error ? `${value.name}: ${value.message} ${value.stack}` : value))).join('\n')
  }

  it.each([
    ['RESEND_API_KEY', { MAIL_FROM }, '環境変数 RESEND_API_KEY を設定してください'],
    ['MAIL_FROM', { RESEND_API_KEY: 're_test_secret_key', MAIL_FROM: undefined }, '環境変数 MAIL_FROM を設定してください'],
  ])('%s がないときは、登録と送り直しが 500（MailConfigurationError）で、送れないことが分かる', async (_, env, message) => {
    const logs = spyConsole()
    // 本番と同じく、送る部分を差し替えない（Resend の API で送る）
    const call = createClient({ mailTransport: undefined })

    const signedUp = await signUp(call, 'alice@example.com', PASSWORD, { env })
    expect(signedUp.status).toBe(500)
    expect(signedUp.body).toEqual({ error: { type: 'MailConfigurationError', message } })
    expect(signedUp.headers.get('Cache-Control')).toBe('no-store')

    const resent = await resend(call, 'alice@example.com', { env })
    expect(resent.status).toBe(500)
    expect(resent.body).toEqual({ error: { type: 'MailConfigurationError', message } })

    expect(logs()).not.toContain('alice@example.com')
    expect(logs()).not.toContain('re_test_secret_key')
  })

  it('メールを送らない API（ログイン中かの確かめ）は、メールの設定がなくても動く', async () => {
    const call = createClient({ mailTransport: undefined })
    const response = await call('GET', '/api/auth/get-session', { env: { MAIL_FROM: undefined } })
    expect(response.status).toBe(200)
  })

  it('Resend が失敗を返したときは 500（MailSendError）で、応答と記録に宛先と秘密の値を出さない', async () => {
    const logs = spyConsole()
    const failing: MailTransport = async () => {
      throw new MailSendError('メールを送れませんでした（Resend: 422）')
    }
    const call = createClient({ mailTransport: failing })

    const response = await signUp(call, 'alice@example.com', PASSWORD, { env: { RESEND_API_KEY: 're_test_secret_key' } })
    expect(response.status).toBe(500)
    expect(response.body).toEqual({ error: { type: 'MailSendError', message: 'メールを送れませんでした（Resend: 422）' } })
    expect(JSON.stringify(response.body)).not.toContain('alice@example.com')
    expect(logs()).not.toContain('alice@example.com')
    expect(logs()).not.toContain('re_test_secret_key')
    expect(logs()).not.toContain(SECRET)
  })

  it('すでに登録されているときのメールを送れないときも、同じ 500（MailSendError）', async () => {
    spyConsole()
    const call = createClient()
    await signUp(call, 'alice@example.com')
    const failing: MailTransport = async () => {
      throw new MailSendError('メールを送れませんでした（Resend: 500）')
    }

    const response = await signUp(createClient({ mailTransport: failing }), 'alice@example.com')
    expect(response.status).toBe(500)
    expect((response.body?.error as { type: string }).type).toBe('MailSendError')
  })
})

describe('メールを送る回数の上限', () => {
  it(`同じメールアドレスと同じ IP アドレスからは、${MAIL_RATE_LIMIT.window} 秒の間に ${MAIL_RATE_LIMIT.max} 回を超えると 429 で、日本語の説明を返し、送らない`, async () => {
    const call = createClient()
    const ip = '203.0.113.50'
    expect((await signUp(call, 'alice@example.com', PASSWORD, { ip })).status).toBe(200)
    for (let attempt = 1; attempt < MAIL_RATE_LIMIT.max; attempt++) {
      expect((await resend(call, 'alice@example.com', { ip })).status).toBe(200)
    }
    expect(mailsTo('alice@example.com')).toHaveLength(MAIL_RATE_LIMIT.max)

    const limited = await resend(call, 'Alice@Example.com', { ip })
    expect(limited.status).toBe(429)
    expect(limited.body).toEqual({
      code: 'TOO_MANY_MAIL_REQUESTS',
      message: 'メールを送る回数の上限を超えました。しばらく待ってから、もう一度試してください',
    })
    expect(Number(limited.headers.get('Retry-After'))).toBeGreaterThan(0)
    // 登録し直しても送らない
    expect((await signUp(call, 'alice@example.com', PASSWORD, { ip })).status).toBe(429)
    expect(mailsTo('alice@example.com')).toHaveLength(MAIL_RATE_LIMIT.max)

    // 別の IP アドレスや、別のメールアドレスは送れる
    expect((await resend(call, 'alice@example.com', { ip: '203.0.113.51' })).status).toBe(200)
    expect((await signUp(call, 'bob@example.com', PASSWORD, { ip })).status).toBe(200)
  })

  it('登録されていないメールアドレスでも、同じように数える（登録の有無を探られないようにする）', async () => {
    const call = createClient()
    const ip = '203.0.113.60'
    for (let attempt = 0; attempt < MAIL_RATE_LIMIT.max; attempt++) {
      expect((await resend(call, 'nobody@example.com', { ip })).status).toBe(200)
    }
    expect((await resend(call, 'nobody@example.com', { ip })).status).toBe(429)
  })

  it(`${MAIL_RATE_LIMIT.window} 秒たつと、また送れる。数えた値は D1 に、宛先をそのまま入れずに保存する`, async () => {
    const start = new Date('2026-11-11T00:00:00Z')
    vi.useFakeTimers({ toFake: ['Date'], now: start })
    const call = createClient()
    const ip = '203.0.113.70'
    await signUp(call, 'alice@example.com', PASSWORD, { ip })
    for (let attempt = 1; attempt < MAIL_RATE_LIMIT.max; attempt++) await resend(call, 'alice@example.com', { ip })
    expect((await resend(call, 'alice@example.com', { ip })).status).toBe(429)

    vi.setSystemTime(start.getTime() + MAIL_RATE_LIMIT.window * 1000)
    expect((await resend(call, 'alice@example.com', { ip })).status).toBe(200)

    const { results } = await database.db.prepare(`SELECT "key" FROM "rateLimit" WHERE "key" LIKE 'mail:%'`).all<{ key: string }>()
    expect(results.length).toBeGreaterThan(0)
    expect(JSON.stringify(results)).not.toContain('alice')
  })
})

describe('試す回数の上限', () => {
  it(`ログインは、同じ IP アドレスから ${AUTH_RATE_LIMITS['/sign-in/email'].max} 回を超えると 429 で、日本語の説明を返す。別の IP アドレスは試せる`, async () => {
    const call = createClient()
    await signUpAndSignIn(call, 'alice@example.com', { ip: '198.51.100.1' })
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

  it(`確認のメールの送り直しは、同じ IP アドレスから ${AUTH_RATE_LIMITS['/send-verification-email'].max} 回を超えると 429`, async () => {
    const call = createClient()
    const { max } = AUTH_RATE_LIMITS['/send-verification-email']

    for (let attempt = 0; attempt < max; attempt++) {
      expect((await resend(call, `user${attempt}@example.com`, { ip: '203.0.113.25' })).status).toBe(200)
    }
    const limited = await resend(call, 'one-more@example.com', { ip: '203.0.113.25' })
    expect(limited.status).toBe(429)
    expect(limited.body?.message).toBe(TOO_MANY_REQUESTS_MESSAGE)
  })

  it(`ログアウトは、同じ IP アドレスから ${AUTH_RATE_LIMITS['/sign-out'].max} 回を超えると 429`, async () => {
    const call = createClient()
    const { cookie } = await signUpAndSignIn(call, 'alice@example.com')
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
  it('ログインと登録は 403 で、cookie を出さず、メールも送らない', async () => {
    const call = createClient()
    await signUpAndSignIn(call, 'alice@example.com')
    const before = mailbox.messages.length

    const signedIn = await signIn(call, 'alice@example.com', PASSWORD, { origin: 'https://evil.example' })
    expect(signedIn.status).toBe(403)
    expect(signedIn.cookie).toBe('')

    const signedUp = await signUp(call, 'bob@example.com', PASSWORD, { origin: 'https://evil.example' })
    expect(signedUp.status).toBe(403)
    expect(await count('user')).toBe(1)
    expect(mailbox.messages).toHaveLength(before)
  })

  it('ログアウトは 403 で、セッションは使えるまま', async () => {
    const call = createClient()
    const { cookie } = await signUpAndSignIn(call, 'alice@example.com')

    const response = await call('POST', '/api/auth/sign-out', { cookie, origin: 'https://evil.example' })
    expect(response.status).toBe(403)
    expect(await sessionEmail(call, cookie)).toBe('alice@example.com')
  })

  it('cookie を付けて Origin がないリクエストも、ログアウトさせない', async () => {
    const call = createClient()
    const { cookie } = await signUpAndSignIn(call, 'alice@example.com')

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
    const { cookie } = await signUpAndSignIn(call, 'alice@example.com')

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

  it('BETTER_AUTH_SECRET とメールの設定がなくても、記録の API と /api/health は今までどおり動く', async () => {
    const call = createClient({ mailTransport: undefined })
    const env = { BETTER_AUTH_SECRET: undefined, MAIL_FROM: undefined, DEV_USER_EMAIL: 'alice@example.com' }

    expect((await call('GET', '/api/meals', { env })).status).toBe(200)
    const created = await call('POST', '/api/meals', {
      env,
      body: { date: '2026-11-11', mealType: 'lunch', name: 'うどん', status: 'eaten' },
    })
    expect(created.status).toBe(201)
    expect((await call('GET', '/api/health', { env })).status).toBe(200)
  })
})
