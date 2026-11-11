import { describe, expect, it } from 'vitest'
import { CONNECTION_FAILED_MESSAGE, createApiMealRepository, LOGIN_EXPIRED_MESSAGE } from './apiMealRepository'
import { MealValidationError, type MealRecord } from './mealRecord'
import { LoginExpiredError, MealNotFoundError, MealStorageError, type MealRepository } from './mealRepository'

// サーバーの API の呼び方と、応答の扱いを、fetch を差し替えて確かめる。
// 実際の API（server/api.ts）とつないだ確認は server/apiMealRepository.test.ts にある

const RECORD: MealRecord = {
  id: 'a',
  date: '2026-11-06',
  mealType: 'lunch',
  name: 'うどん',
  genre: 'japanese',
  dishType: null,
  status: 'eaten',
  createdAt: '2026-11-06T00:00:00.000Z',
  updatedAt: '2026-11-06T00:00:00.000Z',
}

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown; redirect: string | undefined }

/** 決まった応答を返す fetch と、呼ばれた内容の一覧を作る */
function fakeFetch(respond: () => Response | Promise<Response>) {
  const calls: Call[] = []
  const fetch: typeof globalThis.fetch = async (input, init = {}) => {
    calls.push({
      url: String(input),
      method: init.method ?? 'GET',
      headers: { ...(init.headers as Record<string, string>) },
      body: typeof init.body === 'string' ? JSON.parse(init.body) : init.body,
      redirect: init.redirect,
    })
    return respond()
  }
  return { fetch, calls }
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function errorResponse(status: number, type: string, message: string): Response {
  return jsonResponse(status, { error: { type, message } })
}

function repositoryWith(respond: () => Response | Promise<Response>) {
  const { fetch, calls } = fakeFetch(respond)
  return { repository: createApiMealRepository({ fetch }), calls }
}

describe('API の呼び方', () => {
  const cases: {
    name: string
    run: (repository: MealRepository) => Promise<unknown>
    response: () => Response
    method: string
    url: string
    body?: unknown
    result: unknown
  }[] = [
    {
      name: 'listByDate',
      run: (repository) => repository.listByDate('2026-11-06'),
      response: () => jsonResponse(200, { meals: [RECORD] }),
      method: 'GET',
      url: '/api/meals?date=2026-11-06',
      result: [RECORD],
    },
    {
      name: 'listByDateRange',
      run: (repository) => repository.listByDateRange('2026-11-01', '2026-11-30'),
      response: () => jsonResponse(200, { meals: [RECORD] }),
      method: 'GET',
      url: '/api/meals?from=2026-11-01&to=2026-11-30',
      result: [RECORD],
    },
    {
      name: 'listAll',
      run: (repository) => repository.listAll(),
      response: () => jsonResponse(200, { meals: [RECORD] }),
      method: 'GET',
      url: '/api/meals',
      result: [RECORD],
    },
    {
      name: 'get（ID はエンコードしてクエリに入れる）',
      run: (repository) => repository.get('a/../b&c'),
      response: () => jsonResponse(200, { meal: RECORD }),
      method: 'GET',
      url: '/api/meal?id=a%2F..%2Fb%26c',
      result: RECORD,
    },
    {
      name: 'create',
      run: (repository) => repository.create({ date: '2026-11-06', mealType: 'lunch', name: 'うどん', status: 'eaten' }),
      response: () => jsonResponse(201, { meal: RECORD }),
      method: 'POST',
      url: '/api/meals',
      body: { date: '2026-11-06', mealType: 'lunch', name: 'うどん', status: 'eaten' },
      result: RECORD,
    },
    {
      name: 'update（null は未設定に戻す値として送る）',
      run: (repository) => repository.update('a', { name: 'そば', genre: null }),
      response: () => jsonResponse(200, { meal: RECORD }),
      method: 'PATCH',
      url: '/api/meal?id=a',
      body: { name: 'そば', genre: null },
      result: RECORD,
    },
    {
      name: 'delete',
      run: (repository) => repository.delete('a'),
      response: () => new Response(null, { status: 204 }),
      method: 'DELETE',
      url: '/api/meal?id=a',
      result: undefined,
    },
    {
      name: 'markPlannedAsEatenBefore（基準の日を本文で渡す）',
      run: (repository) => repository.markPlannedAsEatenBefore('2026-11-06'),
      response: () => jsonResponse(200, { meals: [RECORD] }),
      method: 'POST',
      url: '/api/mark-planned-as-eaten',
      body: { date: '2026-11-06' },
      result: [RECORD],
    },
    {
      name: 'importRecords',
      run: (repository) => repository.importRecords([RECORD]),
      response: () => new Response(null, { status: 204 }),
      method: 'POST',
      url: '/api/import',
      body: { records: [RECORD] },
      result: undefined,
    },
  ]

  it.each(cases)('$name', async ({ run, response, method, url, body, result }) => {
    const { repository, calls } = repositoryWith(response)
    await expect(run(repository)).resolves.toEqual(result)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ url, method, body, redirect: 'manual' })
    // 書き込みは、本文のない DELETE も Content-Type: application/json を付ける
    expect(calls[0].headers['Content-Type']).toBe(method === 'GET' ? undefined : 'application/json')
  })

  it('API の場所を変えられる', async () => {
    const { fetch, calls } = fakeFetch(() => jsonResponse(200, { meals: [] }))
    await createApiMealRepository({ fetch, baseUrl: 'https://meal-log.example/api' }).listAll()
    expect(calls[0].url).toBe('https://meal-log.example/api/meals')
  })
})

describe('エラー', () => {
  it('通信に失敗すると、MealStorageError（cause に元のエラー）', async () => {
    const failure = new TypeError('Failed to fetch')
    const { repository } = repositoryWith(() => {
      throw failure
    })
    const error = await repository.listAll().catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(MealStorageError)
    expect((error as MealStorageError).message).toBe(CONNECTION_FAILED_MESSAGE)
    expect((error as MealStorageError).cause).toBe(failure)
  })

  it('400 は MealValidationError（メッセージはサーバーのもの）', async () => {
    const { repository } = repositoryWith(() => errorResponse(400, 'MealValidationError', '品名を入力してください'))
    await expect(repository.create({ date: '2026-11-06', mealType: 'lunch', name: ' ', status: 'eaten' })).rejects.toThrow(
      new MealValidationError('品名を入力してください'),
    )
  })

  it('記録がない 404 は、更新・削除では MealNotFoundError、取得では null', async () => {
    const { repository } = repositoryWith(() => errorResponse(404, 'MealNotFoundError', '記録が見つかりません: x'))
    await expect(repository.update('x', { name: 'そば' })).rejects.toThrow(new MealNotFoundError('x'))
    await expect(repository.delete('x')).rejects.toBeInstanceOf(MealNotFoundError)
    await expect(repository.get('x')).resolves.toBeNull()
  })

  it('ない API のアドレスの 404 は、記録がないのではなく MealStorageError', async () => {
    const { repository } = repositoryWith(() => errorResponse(404, 'RouteNotFound', 'この API はありません: /api/meal'))
    await expect(repository.get('a')).rejects.toBeInstanceOf(MealStorageError)
  })

  it.each([
    ['500（保存先の失敗）', () => errorResponse(500, 'MealStorageError', '保存先に書き込めません')],
    ['500（本文が JSON でない）', () => new Response('Internal Server Error', { status: 500 })],
    ['405', () => errorResponse(405, 'MethodNotAllowed', 'この操作には対応していません')],
    ['415', () => errorResponse(415, 'UnsupportedMediaType', 'Content-Type')],
  ])('サーバーのエラー（%s）は MealStorageError', async (_name, response) => {
    const { repository } = repositoryWith(response)
    const error = await repository.listAll().catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(MealStorageError)
    expect((error as Error).message).toContain('サーバーでエラーが起きました')
  })

  it('サーバーのエラーのメッセージを含める', async () => {
    const { repository } = repositoryWith(() => errorResponse(500, 'MealStorageError', '保存先に書き込めません'))
    await expect(repository.listAll()).rejects.toThrow('サーバーでエラーが起きました（500: 保存先に書き込めません）')
  })

  it.each([
    ['401', () => errorResponse(401, 'Unauthorized', 'ログインしていないか、ログインの情報が正しくありません')],
    ['ログイン画面への転送（302）', () => new Response(null, { status: 302, headers: { Location: 'https://team.cloudflareaccess.com/' } })],
    // ブラウザで redirect: 'manual' にしたときの応答（Response を作るだけでは、この type にできない）
    ['ログイン画面への転送（opaqueredirect）', () => ({ type: 'opaqueredirect', status: 0, ok: false }) as Response],
  ])('ログインの期限が切れたとき（%s）は、LoginExpiredError（MealStorageError の一種）でログインし直しを促す', async (_name, response) => {
    const { repository } = repositoryWith(response)
    for (const run of [() => repository.listByDate('2026-11-06'), () => repository.update('a', { name: 'そば' })]) {
      const error = await run().catch((caught: unknown) => caught)
      expect(error).toBeInstanceOf(LoginExpiredError)
      expect(error).toBeInstanceOf(MealStorageError)
      expect((error as Error).message).toBe(LOGIN_EXPIRED_MESSAGE)
      expect(LOGIN_EXPIRED_MESSAGE).toBe('ログインの期限が切れました。ログインし直してください')
    }
  })

  it.each([
    ['JSON として読めない（ログイン画面の HTML など）', () => new Response('<html></html>', { status: 200 })],
    ['形が違う', () => jsonResponse(200, { records: [] })],
    ['記録がオブジェクトでない', () => jsonResponse(200, { meals: ['a'] })],
  ])('成功の応答が読めないとき（%s）は MealStorageError', async (_name, response) => {
    const { repository } = repositoryWith(response)
    await expect(repository.listAll()).rejects.toBeInstanceOf(MealStorageError)
  })
})
