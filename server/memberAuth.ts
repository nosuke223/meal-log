// 会員の登録とログイン（Better Auth）。/api/auth/ 以下のリクエストを処理する（server/api.ts から呼ぶ）。
// Access の確かめより前に動く。記録の読み書き（/api/meals など）は、まだ Access のログインで動く

import { betterAuth, type BetterAuthOptions } from 'better-auth'
import { AuthConfigurationError } from './auth'
import type { D1Database } from './d1'

/** ログインの API の入口 */
export const AUTH_BASE_PATH = '/api/auth'

export type MemberAuthEnv = {
  /** セッションなどの署名に使う秘密の値。リポジトリには書かない（本番とプレビューは Cloudflare 側で、手元は起動するときだけ設定する） */
  BETTER_AUTH_SECRET?: string
}

/** パスワードの最短の文字数 */
export const MIN_PASSWORD_LENGTH = 8

/**
 * 試す回数の上限（総当たりを防ぐ）。IP アドレスとアドレスの組み合わせごとに数え、window 秒の間に max 回まで。
 * 数えた値は D1 の表 rateLimit に保存する（Workers は実行環境が入れ替わるので、メモリーには置かない）
 */
export const AUTH_RATE_LIMITS = {
  '/sign-up/email': { window: 600, max: 10 },
  '/sign-in/email': { window: 600, max: 10 },
  '/sign-out': { window: 600, max: 30 },
} as const

/** 上記以外の /api/auth/ のアドレス（ログイン中かの確かめなど）の上限 */
const DEFAULT_RATE_LIMIT = { window: 60, max: 100 }

/** 試す回数の上限を超えたときの説明 */
export const TOO_MANY_REQUESTS_MESSAGE = '試す回数の上限を超えました。しばらく待ってから、もう一度試してください'

/** /api/auth/ 以下のアドレスか */
export function isAuthPath(pathname: string): boolean {
  return pathname === AUTH_BASE_PATH || pathname.startsWith(`${AUTH_BASE_PATH}/`)
}

/**
 * Better Auth の設定。origin は、リクエストのオリジン（プレビューは公開ごとにアドレスが変わるので、固定の値に頼らない）。
 * NODE_ENV によって変わる既定の値（オリジンの確かめ、回数の上限、cookie の Secure）は、すべてここで決める
 */
export function memberAuthOptions(origin: string, secret: string, db: D1Database): BetterAuthOptions {
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
      // メールの確認は、次の Issue で求める
      requireEmailVerification: false,
      // 登録したら、そのままログインした状態にする
      autoSignIn: true,
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
      ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] },
    },
    telemetry: { enabled: false },
  }
}

type MemberAuth = { handler: (request: Request) => Promise<Response> }

/** /api/auth/ 以下のリクエストを処理する関数を作る */
export function createMemberAuthHandler() {
  // 同じオリジンと秘密の値なら、作った Better Auth を使い回す（最後の1つだけ覚える）
  let cached: { key: string; db: D1Database; auth: MemberAuth } | null = null

  return async function handleAuthRequest(request: Request, env: MemberAuthEnv, db: D1Database): Promise<Response> {
    const secret = env.BETTER_AUTH_SECRET?.trim()
    if (!secret) throw new AuthConfigurationError('環境変数 BETTER_AUTH_SECRET を設定してください')

    const origin = new URL(request.url).origin
    const key = `${origin}\n${secret}`
    if (cached === null || cached.key !== key || cached.db !== db) {
      cached = { key, db, auth: betterAuth(memberAuthOptions(origin, secret, db)) }
    }
    const response = await cached.auth.handler(request)
    if (response.status === 429) return tooManyRequests(response)
    return withNoStore(response)
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
