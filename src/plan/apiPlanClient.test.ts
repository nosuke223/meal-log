import { describe, expect, it } from 'vitest'
import { CONNECTION_FAILED_MESSAGE, LOGIN_EXPIRED_MESSAGE } from '../meals/apiMealRepository'
import { LoginExpiredError } from '../meals/mealRepository'
import { createApiPlanClient } from './apiPlanClient'

// プランの窓口の、API の呼び方と応答の扱いを、fetch を差し替えて確かめる。
// 実際の API（server/api.ts）とつないだ確認は server/apiMealRepository.test.ts にある

type Call = { url: string; method: string; credentials: string | undefined; redirect: string | undefined }

function clientWith(respond: () => Response | Promise<Response>) {
  const calls: Call[] = []
  const fetch: typeof globalThis.fetch = async (input, init = {}) => {
    calls.push({ url: String(input), method: init.method ?? 'GET', credentials: init.credentials, redirect: init.redirect })
    return respond()
  }
  return { client: createApiPlanClient({ fetch }), calls }
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

describe('プランの窓口（サーバーの API）', () => {
  it('GET /api/plan を、ログインの cookie を付け、転送をたどらずに呼ぶ', async () => {
    const { client, calls } = clientWith(() => jsonResponse(200, { plan: 'free', limit: 300, count: 12 }))

    expect(await client.getPlan()).toEqual({ plan: 'free', limit: 300, count: 12 })
    expect(calls).toEqual([{ url: '/api/plan', method: 'GET', credentials: 'same-origin', redirect: 'manual' }])
  })

  it('有料なら、上限は null', async () => {
    const { client } = clientWith(() => jsonResponse(200, { plan: 'paid', limit: null, count: 400 }))
    expect(await client.getPlan()).toEqual({ plan: 'paid', limit: null, count: 400 })
  })

  it.each([
    ['401', () => jsonResponse(401, { error: { type: 'Unauthorized', message: 'ログインしていません' } })],
    ['ログイン画面への転送（302）', () => new Response(null, { status: 302, headers: { Location: 'https://team.cloudflareaccess.com/' } })],
    ['ログイン画面への転送（opaqueredirect）', () => ({ type: 'opaqueredirect', status: 0, ok: false }) as Response],
  ])('ログインの期限が切れたとき（%s）は、LoginExpiredError', async (_name, response) => {
    const { client } = clientWith(response)
    const error = await client.getPlan().catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(LoginExpiredError)
    expect((error as Error).message).toBe(LOGIN_EXPIRED_MESSAGE)
  })

  it('つながらないときは、接続できなかったことを伝える', async () => {
    const { client } = clientWith(() => {
      throw new TypeError('Failed to fetch')
    })
    await expect(client.getPlan()).rejects.toThrow(CONNECTION_FAILED_MESSAGE)
  })

  it('サーバーのエラーは、状態コードとメッセージを含める', async () => {
    const { client } = clientWith(() => jsonResponse(500, { error: { type: 'MealStorageError', message: '保存先から読み込めません' } }))
    await expect(client.getPlan()).rejects.toThrow('サーバーでエラーが起きました（500: 保存先から読み込めません）')
  })

  it.each([
    ['JSON として読めない', () => new Response('<html></html>', { status: 200 })],
    ['プランが決まった値でない', () => jsonResponse(200, { plan: 'gold', limit: 300, count: 0 })],
    ['数がない', () => jsonResponse(200, { plan: 'free', limit: 300 })],
    ['上限が文字列', () => jsonResponse(200, { plan: 'free', limit: '300', count: 0 })],
  ])('成功の応答が読めないとき（%s）は、エラー', async (_name, response) => {
    const { client } = clientWith(response)
    await expect(client.getPlan()).rejects.toThrow()
  })
})
