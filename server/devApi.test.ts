import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Connect, ViteDevServer } from 'vite'
import { describe, expect, it, vi } from 'vitest'
import { devApiPlugin } from './devApi'

/** API の読み込みに失敗する、開発サーバーの代わり。登録された処理と、記録したエラーを返す */
function setUp() {
  let handler: Connect.NextHandleFunction | undefined
  const logError = vi.fn()
  const server = {
    middlewares: { use: (fn: Connect.NextHandleFunction) => (handler = fn) },
    httpServer: null,
    config: { logger: { error: logError } },
    ssrLoadModule: () => Promise.reject(new Error('読み込めません')),
  } as unknown as ViteDevServer
  const configureServer = devApiPlugin().configureServer as (server: ViteDevServer) => void
  configureServer(server)
  if (!handler) throw new Error('処理が登録されていません')
  return { handler, logError }
}

function fakeRequest(socketDestroyed: boolean) {
  return { url: '/api/meals', method: 'GET', headers: {}, socket: { destroyed: socketDestroyed } } as unknown as IncomingMessage
}

function fakeResponse() {
  return {
    destroyed: false,
    headersSent: false,
    statusCode: 200,
    setHeader: vi.fn(),
    end: vi.fn(),
  }
}

describe('開発サーバーの API のエラー', () => {
  it('Vite に渡さず（覆いを出さない）、500 と API のエラーの形の本文を返し、記録を残す', async () => {
    const { handler, logError } = setUp()
    const res = fakeResponse()
    const next = vi.fn()
    handler(fakeRequest(false), res as unknown as ServerResponse, next)

    await vi.waitFor(() => expect(res.end).toHaveBeenCalled())
    expect(next).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(500)
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/json')
    expect(JSON.parse(res.end.mock.calls[0][0] as string)).toEqual({
      error: { type: 'MealStorageError', message: '開発サーバーの API でエラーが起きました' },
    })
    expect(logError).toHaveBeenCalledTimes(1)
  })

  it('ブラウザがリクエストを途中で切ったときは、何も返さず、Vite にも渡さない', async () => {
    const { handler, logError } = setUp()
    const res = fakeResponse()
    const next = vi.fn()
    handler(fakeRequest(true), res as unknown as ServerResponse, next)

    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(next).not.toHaveBeenCalled()
    expect(res.end).not.toHaveBeenCalled()
    expect(logError).not.toHaveBeenCalled()
  })

  it('/api/ 以外は、そのまま次の処理に渡す', () => {
    const { handler } = setUp()
    const next = vi.fn()
    handler({ url: '/src/main.tsx' } as IncomingMessage, fakeResponse() as unknown as ServerResponse, next)
    expect(next).toHaveBeenCalledWith()
  })
})
