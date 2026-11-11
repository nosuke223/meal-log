import { describe, expect, it, vi } from 'vitest'
import {
  createMailer,
  createMemoryTransport,
  MailConfigurationError,
  MailSendError,
  RESEND_API_URL,
  type MailContent,
} from './mailer'
import { alreadyRegisteredMail } from './templates/alreadyRegistered'
import { verifyEmailMail } from './templates/verifyEmail'

const API_KEY = 're_test_secret_key_0123456789'
const TO = 'alice@example.com'

const CONTENT: MailContent = { to: TO, subject: '件名', text: '本文', html: '<p>本文</p>' }

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

describe('Resend の API で送る', () => {
  it('POST https://api.resend.com/emails に、認証のヘッダーと、送信元（表示名 meal-log）、宛先、件名、本文を JSON で送る', async () => {
    const { fetch, sent } = fakeFetch(() => new Response(JSON.stringify({ id: 'email-id' }), { status: 200 }))
    const mailer = createMailer({ RESEND_API_KEY: API_KEY, MAIL_FROM: 'onboarding@resend.dev' }, { fetch })

    expect(await mailer.send(CONTENT)).toBe('sent')
    expect(sent).toHaveLength(1)
    expect(sent[0].url).toBe(RESEND_API_URL)
    expect(RESEND_API_URL).toBe('https://api.resend.com/emails')
    expect(sent[0].init.method).toBe('POST')
    const headers = new Headers(sent[0].init.headers)
    expect(headers.get('Authorization')).toBe(`Bearer ${API_KEY}`)
    expect(headers.get('Content-Type')).toBe('application/json')
    expect(JSON.parse(sent[0].init.body as string)).toEqual({
      from: 'meal-log <onboarding@resend.dev>',
      to: [TO],
      subject: '件名',
      text: '本文',
      html: '<p>本文</p>',
    })
  })

  it('環境変数の前後の空白は除く', async () => {
    const { fetch, sent } = fakeFetch(() => new Response('{}', { status: 200 }))
    await createMailer({ RESEND_API_KEY: ` ${API_KEY}\n`, MAIL_FROM: ' onboarding@resend.dev ' }, { fetch }).send(CONTENT)

    expect(new Headers(sent[0].init.headers).get('Authorization')).toBe(`Bearer ${API_KEY}`)
    expect(JSON.parse(sent[0].init.body as string).from).toBe('meal-log <onboarding@resend.dev>')
  })

  it.each([400, 401, 422, 429, 500])('Resend が失敗（%i）を返したときは MailSendError で、宛先と秘密の値を入れない', async (status) => {
    const { fetch } = fakeFetch(
      () => new Response(JSON.stringify({ message: `Invalid to: ${TO}`, name: 'validation_error' }), { status }),
    )
    const mailer = createMailer({ RESEND_API_KEY: API_KEY, MAIL_FROM: 'onboarding@resend.dev' }, { fetch })

    const error = await mailer.send(CONTENT).catch((thrown: unknown) => thrown)
    expect(error).toBeInstanceOf(MailSendError)
    expect((error as Error).message).toBe(`メールを送れませんでした（Resend: ${status}）`)
    expect((error as Error).message).not.toContain(TO)
    expect((error as Error).message).not.toContain(API_KEY)
  })

  it('Resend に接続できないときも MailSendError', async () => {
    const { fetch } = fakeFetch(() => Promise.reject(new TypeError('fetch failed')))
    const mailer = createMailer({ RESEND_API_KEY: API_KEY, MAIL_FROM: 'onboarding@resend.dev' }, { fetch })

    await expect(mailer.send(CONTENT)).rejects.toThrow(MailSendError)
  })
})

describe('メールの設定', () => {
  it.each([
    ['RESEND_API_KEY がない', { MAIL_FROM: 'onboarding@resend.dev' }, '環境変数 RESEND_API_KEY を設定してください'],
    ['RESEND_API_KEY が空白だけ', { RESEND_API_KEY: '  ', MAIL_FROM: 'onboarding@resend.dev' }, '環境変数 RESEND_API_KEY を設定してください'],
    ['MAIL_FROM がない', { RESEND_API_KEY: API_KEY }, '環境変数 MAIL_FROM を設定してください'],
    ['MAIL_FROM が空', { RESEND_API_KEY: API_KEY, MAIL_FROM: '' }, '環境変数 MAIL_FROM を設定してください'],
  ])('%sときは、送らずに MailConfigurationError', async (_, env, message) => {
    const { fetch, sent } = fakeFetch(() => new Response('{}', { status: 200 }))

    const error = await createMailer(env, { fetch })
      .send(CONTENT)
      .catch((thrown: unknown) => thrown)
    expect(error).toBeInstanceOf(MailConfigurationError)
    expect((error as Error).message).toBe(message)
    expect(sent).toHaveLength(0)
  })

  it('送る部分を差し替えたときは、RESEND_API_KEY がなくても送れる（MAIL_FROM は要る）', async () => {
    const transport = createMemoryTransport()

    expect(await createMailer({ MAIL_FROM: 'dev@example.com' }, { transport }).send(CONTENT)).toBe('sent')
    expect(transport.messages).toEqual([{ ...CONTENT, from: 'meal-log <dev@example.com>' }])
    await expect(createMailer({}, { transport }).send(CONTENT)).rejects.toThrow(MailConfigurationError)
  })
})

describe('MAIL_ALLOWED_TO（プレビュー用）', () => {
  const ENV = { RESEND_API_KEY: API_KEY, MAIL_FROM: 'onboarding@resend.dev' }

  it('宛先が違うときは、送らず、エラーにもしない。記録には宛先を出さず、送らなかったことだけを残す', async () => {
    const { fetch, sent } = fakeFetch(() => new Response('{}', { status: 200 }))
    const log = vi.fn()
    const mailer = createMailer({ ...ENV, MAIL_ALLOWED_TO: 'owner@example.com' }, { fetch, log })

    expect(await mailer.send(CONTENT)).toBe('skipped')
    expect(sent).toHaveLength(0)
    expect(log).toHaveBeenCalledTimes(1)
    expect(log.mock.calls[0][0]).toContain('送り先が許可されていないので送らなかった')
    expect(JSON.stringify(log.mock.calls)).not.toContain(TO)
    expect(JSON.stringify(log.mock.calls)).not.toContain('owner@example.com')
  })

  it('宛先が同じ（大文字と小文字、前後の空白は区別しない）ときは送る', async () => {
    const { fetch, sent } = fakeFetch(() => new Response('{}', { status: 200 }))
    const mailer = createMailer({ ...ENV, MAIL_ALLOWED_TO: ' Alice@Example.com ' }, { fetch, log: vi.fn() })

    expect(await mailer.send(CONTENT)).toBe('sent')
    expect(sent).toHaveLength(1)
  })

  it('設定されていない（空を含む）ときは、どの宛先にも送る', async () => {
    for (const allowed of [undefined, '', '  ']) {
      const { fetch, sent } = fakeFetch(() => new Response('{}', { status: 200 }))
      expect(await createMailer({ ...ENV, MAIL_ALLOWED_TO: allowed }, { fetch }).send(CONTENT)).toBe('sent')
      expect(sent).toHaveLength(1)
    }
  })
})

describe('メールの文面', () => {
  it('確認のメール: 文字だけの版と HTML の版にリンクがあり、有効期限と、心当たりがない人向けの文がある', () => {
    const url = 'https://meal-log.example/api/auth/verify-email?token=a.b.c&x=1'
    const mail = verifyEmailMail({ url })

    expect(mail.subject).toBe('【meal-log】メールアドレスの確認')
    expect(mail.text).toContain(url)
    expect(mail.text).toContain('24時間')
    expect(mail.text).toContain('このメールに心当たりがなければ、無視してください。')
    // HTML では & をエスケープする
    expect(mail.html).toContain('href="https://meal-log.example/api/auth/verify-email?token=a.b.c&amp;x=1"')
    expect(mail.html).toContain('このメールに心当たりがなければ、無視してください。')
    expect(mail.html).toMatch(/^<!doctype html>/)
  })

  it('すでに登録されているときのメール: ログインかパスワードの再設定を勧め、心当たりがない人向けの文がある', () => {
    const mail = alreadyRegisteredMail({ loginUrl: 'https://meal-log.example/#/login' })

    expect(mail.subject).toBe('【meal-log】このメールアドレスはすでに登録されています')
    expect(mail.text).toContain('すでに登録されています。ログインするか、パスワードを再設定してください')
    expect(mail.text).toContain('https://meal-log.example/#/login')
    expect(mail.text).toContain('このメールに心当たりがなければ、無視してください。')
    expect(mail.html).toContain('href="https://meal-log.example/#/login"')
    expect(mail.html).toContain('このメールに心当たりがなければ、無視してください。')
  })
})
