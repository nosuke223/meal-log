// 手元の開発（npm run dev）と e2e 専用。Vite の開発サーバーで /api/ 以下を API（server/api.ts）で処理する。
// 保存先は手元の D1（wrangler の Miniflare。npm run db:migrate:local と同じ .wrangler/ の下）。
// 認証は省く（DEV_USER_EMAIL）。開発サーバーだけに入れる（apply: 'serve'）ので、ビルドした本番のアプリには入らない

import type { IncomingMessage, ServerResponse } from 'node:http'
import { fileURLToPath } from 'node:url'
import type { Plugin, ViteDevServer } from 'vite'
import type { ApiEnv } from './api.ts'
import type { D1Database } from './d1.ts'

const CONFIG_PATH = fileURLToPath(new URL('../wrangler.dev.jsonc', import.meta.url))

/** 認証を省いたときに扱う人 */
export const DEV_USER_EMAIL = 'dev@example.com'

/**
 * このヘッダーがあると、その値のメールアドレスの人として扱う（手元の開発サーバーだけ）。
 * e2e で、テストごとに別の人にして、記録が混ざらないようにするのに使う
 */
export const DEV_USER_HEADER = 'x-dev-user-email'

export function devApiPlugin(): Plugin {
  return {
    name: 'meal-log-dev-api',
    apply: 'serve',
    configureServer(server) {
      // API と手元の D1 は、最初に API が呼ばれたときに読み込んで起動する（ビルドやテストでは読み込まない）
      let started: Promise<DevApi> | null = null
      function start() {
        started ??= startDevApi(server)
        return started
      }
      server.httpServer?.once('close', () => {
        void started?.then((api) => api.dispose())
      })

      server.middlewares.use((req, res, next) => {
        const path = req.url?.split('?')[0] ?? ''
        if (path !== '/api' && !path.startsWith('/api/')) {
          next()
          return
        }
        handleRequest(req, res).catch(next)
      })

      async function handleRequest(req: IncomingMessage, res: ServerResponse) {
        const api = await start()
        const header = req.headers[DEV_USER_HEADER]
        const email = typeof header === 'string' && header.trim() !== '' ? header : DEV_USER_EMAIL
        const response = await api.handle(await toRequest(req), { DB: api.db, DEV_USER_EMAIL: email })
        res.statusCode = response.status
        response.headers.forEach((value, key) => res.setHeader(key, value))
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

async function startDevApi(server: ViteDevServer): Promise<DevApi> {
  // API のコードは、Vite に読み込ませる（設定ファイルと一緒にまとめない）
  const { createApiHandler } = (await server.ssrLoadModule('/server/api.ts')) as typeof import('./api.ts')
  const { getPlatformProxy } = await import('wrangler')
  const proxy = await getPlatformProxy<{ DB: D1Database }>({ configPath: CONFIG_PATH })
  return { handle: createApiHandler(), db: proxy.env.DB, dispose: () => proxy.dispose() }
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
