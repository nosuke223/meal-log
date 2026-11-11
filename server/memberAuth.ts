// 会員の登録とログイン（Better Auth）。/api/auth/ 以下のリクエストを処理する（server/api.ts から呼ぶ）。
// Access の確かめより前に動く。記録の読み書き（/api/meals など）は、まだ Access のログインで動く。
// 会員登録したら、メールアドレスを確認するまでログインできない（確認のメールは server/mail/ の部品で送る）

import { betterAuth, type BetterAuthOptions } from 'better-auth'
import { APIError } from 'better-auth/api'
import { AUTH_MESSAGES, MIN_PASSWORD_LENGTH, type EmailVerificationResult } from '../src/auth/authClient'
import { loginHash, resetHash } from '../src/route'
import type { ApiErrorBody } from './api'
import { AuthConfigurationError } from './auth'
import type { D1Database } from './d1'
import { consumeMailRateLimit } from './mail/mailRateLimit'
import {
  createMailer,
  MailConfigurationError,
  MailSendError,
  type Mailer,
  type MailEnv,
  type MailTransport,
} from './mail/mailer'
import type { MailTemplate } from './mail/templates/layout'
import { alreadyRegisteredMail } from './mail/templates/alreadyRegistered'
import { resetPasswordMail } from './mail/templates/resetPassword'
import { verifyEmailMail } from './mail/templates/verifyEmail'

/** ログインの API の入口 */
export const AUTH_BASE_PATH = '/api/auth'

export type MemberAuthEnv = MailEnv & {
  /** セッションなどの署名に使う秘密の値。リポジトリには書かない（本番とプレビューは Cloudflare 側で、手元は起動するときだけ設定する） */
  BETTER_AUTH_SECRET?: string
}

/** 確認のメールのリンクの有効期限（秒） */
export const EMAIL_VERIFICATION_EXPIRES_IN = 24 * 60 * 60

/** パスワード再設定のメールのリンクの有効期限（秒） */
export const RESET_PASSWORD_EXPIRES_IN = 60 * 60

/**
 * 試す回数の上限（総当たりを防ぐ）。IP アドレスとアドレスの組み合わせごとに数え、window 秒の間に max 回まで。
 * 数えた値は D1 の表 rateLimit に保存する（Workers は実行環境が入れ替わるので、メモリーには置かない）
 */
export const AUTH_RATE_LIMITS = {
  '/sign-up/email': { window: 600, max: 10 },
  '/sign-in/email': { window: 600, max: 10 },
  '/sign-out': { window: 600, max: 30 },
  '/send-verification-email': { window: 600, max: 10 },
  '/request-password-reset': { window: 600, max: 10 },
  '/reset-password': { window: 600, max: 10 },
} as const

/** 上記以外の /api/auth/ のアドレス（ログイン中かの確かめなど）の上限 */
const DEFAULT_RATE_LIMIT = { window: 60, max: 100 }

/** 試す回数の上限を超えたときの説明 */
export const TOO_MANY_REQUESTS_MESSAGE = AUTH_MESSAGES.tooManyRequests

/**
 * メールを送ることがあるアドレス。上の上限とは別に、宛先のメールアドレスと IP アドレスの組み合わせごとに、
 * 送る回数の上限（server/mail/mailRateLimit.ts）を数える。登録の有無を探られないよう、実際に送るかどうかに関係なく数える
 */
const RESET_PATHS = ['/request-password-reset', '/reset-password']
const MAIL_PATHS =['/sign-up/email', '/send-verification-email', '/request-password-reset']

/**
 * リクエストごとに付ける ID のヘッダー（このファイルの中だけで使う。外から来た同じ名前のヘッダーは消す）。
 * Better Auth は、会員登録のときにメールを送れなくても、エラーを記録するだけで成功の応答を返すので、
 * メールを送る処理がこの ID でエラーを知らせ、応答を返す前に 500 にする
 */
const REQUEST_ID_HEADER = 'x-meal-log-auth-request-id'

/** メールを送れなかったことを知らせる関数。request は Better Auth がメールを送る処理に渡すリクエスト */
export type MailErrorReporter = (request: Request | undefined, error: MailConfigurationError | MailSendError) => void

/** Cloudflare が付ける、利用者の IP アドレスのヘッダー */
const CLIENT_IP_HEADER = 'cf-connecting-ip'

/** /api/auth/ 以下のアドレスか */
export function isAuthPath(pathname: string): boolean {
  return pathname === AUTH_BASE_PATH || pathname.startsWith(`${AUTH_BASE_PATH}/`)
}

/**
 * 確認のメールのリンク。リンクは API を開き、API が確認の結果をログインの画面（#/login/…）へ転送する。
 * 画面のアドレスはハッシュなので、トークンはクエリにして API で受け取る（画面では受け取らない）
 */
export function verifyEmailUrl(origin: string, token: string): string {
  return `${origin}${AUTH_BASE_PATH}/verify-email?token=${encodeURIComponent(token)}`
}

/**
 * パスワード再設定のメールのリンク。画面のアドレスはハッシュなので、トークンはハッシュの中に入れる
 * （クエリにすると、サーバーの記録にトークンが残る）。画面がトークンを読んだら、アドレスから消す
 */
export function resetPasswordUrl(origin: string, token: string): string {
  return `${origin}/${resetHash(token)}`
}

/**
 * Better Auth の設定。origin は、リクエストのオリジン（プレビューは公開ごとにアドレスが変わるので、固定の値に頼らない）。
 * NODE_ENV によって変わる既定の値（オリジンの確かめ、回数の上限、cookie の Secure）は、すべてここで決める
 */
export function memberAuthOptions(
  origin: string,
  secret: string,
  db: D1Database,
  mailer: Mailer,
  reportMailError: MailErrorReporter = () => {},
): BetterAuthOptions {
  /** メールを送る。送れなかったときは知らせて、Better Auth のエラーにする（宛先と秘密の値は入れない） */
  async function sendMail(to: string, template: MailTemplate, request: Request | undefined): Promise<void> {
    try {
      await mailer.send({ to, ...template })
    } catch (error) {
      if (error instanceof MailConfigurationError || error instanceof MailSendError) {
        reportMailError(request, error)
        throw new APIError('INTERNAL_SERVER_ERROR', { code: 'MAIL_ERROR', message: error.message })
      }
      throw error
    }
  }

  return {
    // Better Auth は、D1 のバインディングをそのまま受け取れる（D1 用の dialect を使う）
    database: db as unknown as BetterAuthOptions['database'],
    secret,
    baseURL: origin,
    basePath: AUTH_BASE_PATH,
    // 同じオリジンからのリクエストだけを受け付ける
    trustedOrigins: [origin],
    emailAndPassword: {
      enabled: true,
      minPasswordLength: MIN_PASSWORD_LENGTH,
      // メールアドレスを確認するまで、ログインできない。登録した直後も、ログインした状態にしない。
      // すでに登録されているメールアドレスでも、登録できたときと同じ応答を返す（Better Auth の標準の動き）
      requireEmailVerification: true,
      autoSignIn: false,
      async onExistingUserSignUp({ user }, request) {
        await sendMail(user.email, alreadyRegisteredMail({ loginUrl: `${origin}/${loginHash()}` }), request)
      },
      // パスワードの再設定。確認が済んでいない会員にも送る（再設定しても、確認が済んだことにはならない）。
      // 再設定したら、その会員のすべてのセッションを切る
      resetPasswordTokenExpiresIn: RESET_PASSWORD_EXPIRES_IN,
      revokeSessionsOnPasswordReset: true,
      async sendResetPassword({ user, token }) {
        // 登録されている会員にだけ送るので、送れなかったことを応答に出すと、登録の有無が分かる。
        // 応答は変えず、記録にだけ残す（message に宛先と秘密の値は入っていない）
        try {
          await mailer.send({ to: user.email, ...resetPasswordMail({ url: resetPasswordUrl(origin, token) }) })
        } catch (error) {
          if (error instanceof MailConfigurationError || error instanceof MailSendError) {
            console.error(`[meal-log-mail] パスワード再設定のメールを送れなかった: ${error.name}: ${error.message}`)
            return
          }
          throw error
        }
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      // 確認前にログインしようとしたときは送らない（画面の「確認のメールをもう一度送る」で送る）
      sendOnSignIn: false,
      // リンクを開いた端末では、ログインした状態にしない
      autoSignInAfterVerification: false,
      expiresIn: EMAIL_VERIFICATION_EXPIRES_IN,
      async sendVerificationEmail({ user, token }, request) {
        await sendMail(user.email, verifyEmailMail({ url: verifyEmailUrl(origin, token) }), request)
      },
    },
    rateLimit: {
      enabled: true,
      storage: 'database',
      ...DEFAULT_RATE_LIMIT,
      customRules: { ...AUTH_RATE_LIMITS },
    },
    advanced: {
      // 手元の http では Secure を付けない（付けるとブラウザが cookie を送らない）
      useSecureCookies: origin.startsWith('https://'),
      defaultCookieAttributes: { httpOnly: true, sameSite: 'lax' },
      disableOriginCheck: false,
      disableCSRFCheck: false,
      // Cloudflare が付ける、利用者の IP アドレス
      ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER] },
    },
    // info の記録には、登録しようとしたメールアドレスが入るので出さない
    logger: { level: 'warn' },
    telemetry: { enabled: false },
  }
}

export type MemberAuthHandlerOptions = {
  /** メールを送る部分。省略すると Resend の API で送る。テストと手元の開発サーバーで差し替える */
  mailTransport?: MailTransport
}

type MemberAuth = { handler: (request: Request) => Promise<Response> }

/** /api/auth/ 以下のリクエストを処理する関数を作る */
export function createMemberAuthHandler(options: MemberAuthHandlerOptions = {}) {
  // 同じオリジンと設定なら、作った Better Auth を使い回す（最後の1つだけ覚える）
  let cached: { key: string; db: D1Database; auth: MemberAuth } | null = null
  // 処理中のリクエストの ID ごとの、メールを送れなかったエラー
  const mailErrors = new Map<string, MailConfigurationError | MailSendError>()

  function reportMailError(request: Request | undefined, error: MailConfigurationError | MailSendError) {
    const id = request?.headers.get(REQUEST_ID_HEADER)
    if (id) mailErrors.set(id, error)
  }

  return async function handleAuthRequest(request: Request, env: MemberAuthEnv, db: D1Database): Promise<Response> {
    const secret = env.BETTER_AUTH_SECRET?.trim()
    if (!secret) throw new AuthConfigurationError('環境変数 BETTER_AUTH_SECRET を設定してください')

    const url = new URL(request.url)
    const origin = url.origin
    const key = JSON.stringify([origin, secret, env.RESEND_API_KEY ?? '', env.MAIL_FROM ?? '', env.MAIL_ALLOWED_TO ?? ''])
    if (cached === null || cached.key !== key || cached.db !== db) {
      const mailer = createMailer(env, { transport: options.mailTransport })
      cached = { key, db, auth: betterAuth(memberAuthOptions(origin, secret, db, mailer, reportMailError)) }
    }
    const auth = cached.auth

    const path = url.pathname.slice(AUTH_BASE_PATH.length)
    if (path === '/verify-email' && request.method === 'GET') return handleVerifyEmail(url, request, auth, db)
    // Better Auth のオリジンの確認は、cookie のないリクエストには効かないので、再設定の入口は自分で確かめる
    if (RESET_PATHS.includes(path) && request.method === 'POST') {
      const requestOrigin = request.headers.get('Origin')
      if (requestOrigin !== null && requestOrigin !== origin) {
        return new Response(JSON.stringify({ code: 'INVALID_ORIGIN', message: 'Invalid origin' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
        })
      }
    }
    if (MAIL_PATHS.includes(path) && request.method === 'POST') {
      const limited = await limitMail(request, db)
      if (limited !== null) return limited
    }

    const id = crypto.randomUUID()
    const headers = new Headers(request.headers)
    headers.set(REQUEST_ID_HEADER, id)
    try {
      const response = await auth.handler(new Request(request, { headers }))
      const mailError = mailErrors.get(id)
      if (mailError !== undefined) return mailErrorResponse(mailError)
      if (response.status === 429) return tooManyRequests(response)
      return withNoStore(response)
    } finally {
      mailErrors.delete(id)
    }
  }
}

/**
 * 確認のメールのリンクを開いたとき。Better Auth で確かめ、結果をログインの画面へ転送する
 * （リンクを開いた端末では、ログインした状態にしない）。
 * Better Auth は、確認済みの会員のリンクも成功として扱うので、確かめる前に確認済みだったときは「使用済み」にする
 */
async function handleVerifyEmail(url: URL, request: Request, auth: MemberAuth, db: D1Database): Promise<Response> {
  const token = url.searchParams.get('token') ?? ''
  const verifiedBefore = await isVerifiedMember(db, token)
  // 転送先（callbackURL）は渡さず、結果を JSON で受け取る（転送先は、ここでハッシュのアドレスにする）
  const inner = new Request(verifyEmailUrl(url.origin, token), { method: 'GET', headers: request.headers })
  const response = await auth.handler(inner)
  const body = await readJson(response)

  let result: EmailVerificationResult
  if (response.ok) {
    result = verifiedBefore ? 'link-used' : 'verified'
  } else if (body?.code === 'TOKEN_EXPIRED') {
    result = 'link-expired'
  } else if (response.status === 400 || response.status === 401) {
    // 正しくないトークン（INVALID_TOKEN）、会員がいない（USER_NOT_FOUND）、トークンがない
    result = 'link-invalid'
  } else {
    result = 'link-error'
  }
  return new Response(null, {
    status: 303,
    headers: {
      Location: `${url.origin}/${loginHash(result)}`,
      'Cache-Control': 'no-store',
      // 転送先へ、トークンの入ったアドレスを渡さない
      'Referrer-Policy': 'no-referrer',
    },
  })
}

/**
 * トークンに書かれたメールアドレスの会員が、すでに確認済みか（トークンの正しさは、この後 Better Auth が確かめる。
 * 正しくないトークンは「正しくない」になるので、ここで読んだ値は外に出ない）
 */
async function isVerifiedMember(db: D1Database, token: string): Promise<boolean> {
  const payload = token.split('.')[1]
  if (payload === undefined) return false
  let email: unknown
  try {
    const json = new TextDecoder().decode(
      Uint8Array.from(atob(payload.replace(/-/g, '+').replace(/_/g, '/')), (char) => char.charCodeAt(0)),
    )
    email = (JSON.parse(json) as { email?: unknown }).email
  } catch {
    return false
  }
  if (typeof email !== 'string') return false
  const row = await db
    .prepare('SELECT "emailVerified" FROM "user" WHERE "email" = ?')
    .bind(email.toLowerCase())
    .first<{ emailVerified: number | boolean | string }>()
  return row !== null && (row.emailVerified === true || Number(row.emailVerified) === 1)
}

/** メールを送る回数の上限を数える。超えたときは 429 の応答、超えていなければ null */
async function limitMail(request: Request, db: D1Database): Promise<Response | null> {
  const body = await readJson(request.clone())
  const email = body?.email
  // メールアドレスがないときは、Better Auth が入力のエラーにする
  if (typeof email !== 'string' || email.trim() === '') return null
  const ip = request.headers.get(CLIENT_IP_HEADER) ?? 'unknown'
  const result = await consumeMailRateLimit(db, ip, email)
  if (result.allowed) return null
  return new Response(JSON.stringify({ code: 'TOO_MANY_MAIL_REQUESTS', message: AUTH_MESSAGES.tooManyMails }), {
    status: 429,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Retry-After': String(result.retryAfter),
    },
  })
}

/**
 * メールを送れなかったときの応答（500。API のエラーの形 { error: { type, message } }）。
 * 会員登録では、登録の有無にかかわらずメールを送るので、この応答から登録の有無は分からない
 */
function mailErrorResponse(error: MailConfigurationError | MailSendError): Response {
  const errorBody: ApiErrorBody = {
    error: { type: error instanceof MailConfigurationError ? 'MailConfigurationError' : 'MailSendError', message: error.message },
  }
  return new Response(JSON.stringify(errorBody), {
    status: 500,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}

async function readJson(source: Request | Response): Promise<Record<string, unknown> | null> {
  try {
    const data: unknown = JSON.parse(await source.text())
    return typeof data === 'object' && data !== null && !Array.isArray(data) ? (data as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/** 回数の上限を超えたときの応答を、日本語の説明にする（待つ秒数のヘッダーは残す） */
function tooManyRequests(response: Response): Response {
  const headers = new Headers({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  const retryAfter = response.headers.get('X-Retry-After')
  if (retryAfter !== null) {
    headers.set('X-Retry-After', retryAfter)
    headers.set('Retry-After', retryAfter)
  }
  return new Response(JSON.stringify({ code: 'TOO_MANY_REQUESTS', message: TOO_MANY_REQUESTS_MESSAGE }), {
    status: 429,
    headers,
  })
}

/** ログインの状態を含む応答なので、キャッシュさせない */
function withNoStore(response: Response): Response {
  const copy = new Response(response.body, response)
  copy.headers.set('Cache-Control', 'no-store')
  return copy
}
