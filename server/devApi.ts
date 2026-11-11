// 手元の開発（npm run dev）と e2e 専用。Vite の開発サーバーで /api/ 以下を API（server/api.ts）で処理する。
// 保存先は手元の D1（wrangler の Miniflare。npm run db:migrate:local と同じ .wrangler/ の下）。
// 認証は省かない（本番と同じく、会員登録してログインする）。会員のログイン（/api/auth/）の秘密の値は、
// 開発専用の値を渡す（DEV_BETTER_AUTH_SECRET）。
// メールは実際には送らず、開発サーバーの中にためる（DEV_MAILS_PATH で読む）。
// 開発サーバーだけに入れる（apply: 'serve'）ので、ビルドした本番のアプリには入らない

import type { IncomingMessage, ServerResponse } from 'node:http'
import { fileURLToPath } from 'node:url'
import type { Plugin, ViteDevServer } from 'vite'
import type { ApiEnv, ApiErrorBody } from './api.ts'
import type { D1Database } from './d1.ts'
import type { MailMessage, MailTransport } from './mail/mailer.ts'

const CONFIG_PATH = fileURLToPath(new URL('../wrangler.dev.jsonc', import.meta.url))

/**
 * 会員のログイン（Better Auth）の秘密の値。手元の開発とテスト専用（本番とプレビューには、別の値を Cloudflare 側で入れる）。
 * 起動するときだけ API に渡し、設定ファイルには書かない
 */
export const DEV_BETTER_AUTH_SECRET = 'meal-log-local-development-only-secret-do-not-use-in-production'

/** 利用者の IP アドレスのヘッダー（本番では Cloudflare が付ける。試す回数の上限を数えるのに使う） */
const CLIENT_IP_HEADER = 'cf-connecting-ip'

/**
 * 手元の開発サーバーでは、メールを実際には送らず、開発サーバーの中にためる。ためたメールは、この受け口で読む
 * （GET /__dev/mails?to=<宛先>。e2e が、確認のメールのリンクを開くのに使う。開発サーバーだけにあり、本番にはない）
 */
export const DEV_MAILS_PATH = '/__dev/mails'

/** 手元の開発サーバーの送信元（Resend の試験用の送信元と同じ。実際には送らない） */
export const DEV_MAIL_FROM = 'onboarding@resend.dev'

/** ためておくメールの数の上限（古いものから捨てる） */
const MAX_DEV_MAILS = 500

export function devApiPlugin(): Plugin {
  return {
    name: 'meal-log-dev-api',
    apply: 'serve',
    configureServer(server) {
      const mails: MailMessage[] = []
      const mailTransport: MailTransport = async (message) => {
        mails.push(message)
        if (mails.length > MAX_DEV_MAILS) mails.splice(0, mails.length - MAX_DEV_MAILS)
      }

      // API と手元の D1 は、最初に API が呼ばれたときに読み込んで起動する（ビルドやテストでは読み込まない）
      let started: Promise<DevApi> | null = null
      function start() {
        started ??= startDevApi(server, mailTransport)
        return started
      }
      server.httpServer?.once('close', () => {
        void started?.then((api) => api.dispose())
      })

      server.middlewares.use((req, res, next) => {
        const path = req.url?.split('?')[0] ?? ''
        if (path === DEV_MAILS_PATH) {
          handleMails(req, res)
          return
        }
        if (path !== '/api' && !path.startsWith('/api/')) {
          next()
          return
        }
        handleRequest(req, res).catch((error: unknown) => handleError(req, res, error))
      })

      /** ためたメールのうち、宛先が to のものを、古い順に返す */
      function handleMails(req: IncomingMessage, res: ServerResponse) {
        const url = new URL(req.url ?? '/', 'http://localhost')
        const to = (url.searchParams.get('to') ?? '').trim().toLowerCase()
        res.setHeader('Content-Type', 'application/json')
        res.setHeader('Cache-Control', 'no-store')
        res.end(JSON.stringify({ mails: mails.filter((mail) => mail.to.toLowerCase() === to) }))
      }

      // エラーは Vite に渡さない（next(error) にしない）。Vite は、開いている画面にエラーの覆いを出し、
      // 画面が1つも開いていないときは次に開いた画面に出すので、関係のない画面の操作をふさいでしまう
      function handleError(req: IncomingMessage, res: ServerResponse, error: unknown) {
        // 画面を移るなどで、ブラウザがリクエストを途中で切ったときは、返す相手がいないので何もしない
        if (res.destroyed || req.socket.destroyed) return
        server.config.logger.error(`[meal-log-dev-api] ${req.method} ${req.url}: ${String(error)}`, {
          timestamp: true,
          error: error instanceof Error ? error : undefined,
        })
        if (res.headersSent) {
          res.end()
          return
        }
        res.statusCode = 500
        res.setHeader('Content-Type', 'application/json')
        const body: ApiErrorBody = {
          error: { type: 'MealStorageError', message: '開発サーバーの API でエラーが起きました' },
        }
        res.end(JSON.stringify(body))
      }

      async function handleRequest(req: IncomingMessage, res: ServerResponse) {
        const api = await start()
        const request = await toRequest(req)
        // 本番の Cloudflare と同じく、利用者の IP アドレスを付ける。e2e は、テストごとに別の値をヘッダーで送り、
        // 試す回数の上限がテストの間で混ざらないようにする（開発サーバーだけ）
        if (!request.headers.has(CLIENT_IP_HEADER) && req.socket.remoteAddress) {
          request.headers.set(CLIENT_IP_HEADER, req.socket.remoteAddress)
        }
        const response = await api.handle(request, {
          DB: api.db,
          BETTER_AUTH_SECRET: DEV_BETTER_AUTH_SECRET,
          MAIL_FROM: DEV_MAIL_FROM,
        })
        res.statusCode = response.status
        response.headers.forEach((value, key) => {
          if (key !== 'set-cookie') res.setHeader(key, value)
        })
        // cookie が複数あるときに1つにまとめない
        const cookies = response.headers.getSetCookie()
        if (cookies.length > 0) res.setHeader('Set-Cookie', cookies)
        res.end(Buffer.from(await response.arrayBuffer()))
      }
    },
  }
}

type DevApi = {
  handle: (request: Request, env: ApiEnv) => Promise<Response>
  db: D1Database
  dispose: () => Promise<void>
}

async function startDevApi(server: ViteDevServer, mailTransport: MailTransport): Promise<DevApi> {
  // API のコードは、Vite に読み込ませる（設定ファイルと一緒にまとめない）
  const { createApiHandler } = (await server.ssrLoadModule('/server/api.ts')) as typeof import('./api.ts')
  const { getPlatformProxy } = await import('wrangler')
  const proxy = await getPlatformProxy<{ DB: D1Database }>({ configPath: CONFIG_PATH })
  return { handle: createApiHandler({ mailTransport }), db: proxy.env.DB, dispose: () => proxy.dispose() }
}

/** Node の受け取ったリクエストを、API が受け取る Request にする */
async function toRequest(req: IncomingMessage): Promise<Request> {
  const headers = new Headers()
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item)
    } else if (value !== undefined) {
      headers.set(key, value)
    }
  }
  const method = req.method ?? 'GET'
  let body: Uint8Array<ArrayBuffer> | undefined
  if (method !== 'GET' && method !== 'HEAD') {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(chunk as Buffer)
    body = new Uint8Array(Buffer.concat(chunks))
  }
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
  return new Request(url, { method, headers, body })
}
