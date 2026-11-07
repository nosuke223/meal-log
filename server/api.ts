// 保存の窓口（MealRepository）の全操作に対応する API。Pages Functions（functions/api/[[path]].ts）から呼ぶ

import { MealValidationError, type MealChanges, type MealInput } from '../src/meals/mealRecord'
import { MealNotFoundError, MealStorageError, type MealRepository } from '../src/meals/mealRepository'
import { AuthConfigurationError, createAuthenticator, type AuthEnv } from './auth'
import type { D1Database } from './d1'
import { createD1MealRepository } from './d1MealRepository'

export type ApiEnv = AuthEnv & {
  DB: D1Database
}

export type ApiOptions = {
  /** 今の日時。テストで差し替える */
  now?: () => Date
  /** ID を作る。テストで差し替える */
  generateId?: () => string
  /** Access の公開鍵の取得に使う。テストで差し替える */
  fetch?: typeof fetch
}

/** エラーの本文の type。画面でエラーの種類を見分けるのに使う */
export type ApiErrorType =
  | 'MealValidationError'
  | 'MealNotFoundError'
  | 'MealStorageError'
  | 'Unauthorized'
  | 'AuthConfigurationError'
  | 'RouteNotFound'
  | 'MethodNotAllowed'
  | 'UnsupportedMediaType'

/** エラーの本文の形 */
export type ApiErrorBody = {
  error: {
    type: ApiErrorType
    message: string
  }
}

class HttpError extends Error {
  readonly status: number
  readonly type: ApiErrorType
  readonly headers: Record<string, string>

  constructor(status: number, type: ApiErrorType, message: string, headers: Record<string, string> = {}) {
    super(message)
    this.status = status
    this.type = type
    this.headers = headers
  }
}

const WRITE_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE']

type Route = {
  methods: Record<string, (context: RouteContext) => Promise<Response>>
}

type RouteContext = {
  repository: MealRepository
  url: URL
  request: Request
  params: string[]
}

/** API のリクエストを処理する関数を作る */
export function createApiHandler(options: ApiOptions = {}) {
  const authenticate = createAuthenticator({ fetch: options.fetch, now: options.now })

  return async function handleApiRequest(request: Request, env: ApiEnv): Promise<Response> {
    try {
      let email: string | null
      try {
        email = await authenticate(request, env)
      } catch (error) {
        if (error instanceof AuthConfigurationError) throw new HttpError(500, 'AuthConfigurationError', error.message)
        const reason = error instanceof Error ? error.message : String(error)
        throw new HttpError(500, 'AuthConfigurationError', `認証を確かめられません（${reason}）`)
      }
      if (email === null) throw new HttpError(401, 'Unauthorized', 'ログインしていないか、ログインの情報が正しくありません')

      const url = new URL(request.url)
      const { route, params } = matchRoute(url.pathname)
      const handler = route.methods[request.method]
      if (!handler) {
        const allow = Object.keys(route.methods).join(', ')
        throw new HttpError(405, 'MethodNotAllowed', `この操作には対応していません: ${request.method}`, { Allow: allow })
      }
      if (WRITE_METHODS.includes(request.method) && !isJsonRequest(request)) {
        throw new HttpError(415, 'UnsupportedMediaType', '書き込みのリクエストは Content-Type: application/json にしてください')
      }
      const repository = createD1MealRepository(env.DB, email, options)
      return await handler({ repository, url, request, params })
    } catch (error) {
      return errorResponse(error)
    }
  }
}

const mealsRoute: Route = {
  methods: {
    async GET({ repository, url }) {
      const query = url.searchParams
      const keys = [...new Set(query.keys())].sort().join(',')
      if (keys === '') return json(200, { meals: await repository.listAll() })
      if (keys === 'date') return json(200, { meals: await repository.listByDate(query.get('date') ?? '') })
      if (keys === 'from,to') {
        return json(200, { meals: await repository.listByDateRange(query.get('from') ?? '', query.get('to') ?? '') })
      }
      throw new MealValidationError('取得の条件は、date か、from と to の組み合わせにしてください')
    },
    async POST({ repository, request }) {
      const input = await readObject(request)
      return json(201, { meal: await repository.create(input as MealInput) })
    },
  },
}

const mealRoute: Route = {
  methods: {
    async GET({ repository, params }) {
      const meal = await repository.get(params[0])
      if (meal === null) throw new MealNotFoundError(params[0])
      return json(200, { meal })
    },
    async PATCH({ repository, request, params }) {
      const changes = await readObject(request)
      return json(200, { meal: await repository.update(params[0], changes as MealChanges) })
    },
    async DELETE({ repository, params }) {
      await repository.delete(params[0])
      return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } })
    },
  },
}

const markPlannedRoute: Route = {
  methods: {
    async POST({ repository, request }) {
      const body = await readObject(request)
      if (typeof body.date !== 'string') throw new MealValidationError('date に基準の日付（YYYY-MM-DD）を入れてください')
      return json(200, { meals: await repository.markPlannedAsEatenBefore(body.date) })
    },
  },
}

const importRoute: Route = {
  methods: {
    async POST({ repository, request }) {
      const body = await readObject(request)
      if (!Array.isArray(body.records)) throw new MealValidationError('records に記録の一覧（配列）を入れてください')
      await repository.importRecords(body.records)
      return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } })
    },
  },
}

function matchRoute(pathname: string): { route: Route; params: string[] } {
  const segments = pathname.split('/').filter((segment) => segment !== '')
  let decoded: string[]
  try {
    decoded = segments.map((segment) => decodeURIComponent(segment))
  } catch {
    throw new HttpError(404, 'RouteNotFound', `この API はありません: ${pathname}`)
  }
  // 操作用のアドレスは /api/meals/ の外に置く（/api/meals/<id> は、どんな ID でも記録を指すようにするため）
  if (decoded[0] === 'api' && decoded.length === 2) {
    if (decoded[1] === 'meals') return { route: mealsRoute, params: [] }
    if (decoded[1] === 'mark-planned-as-eaten') return { route: markPlannedRoute, params: [] }
    if (decoded[1] === 'import') return { route: importRoute, params: [] }
  }
  if (decoded[0] === 'api' && decoded[1] === 'meals' && decoded.length === 3) {
    return { route: mealRoute, params: [decoded[2]] }
  }
  throw new HttpError(404, 'RouteNotFound', `この API はありません: ${pathname}`)
}

function isJsonRequest(request: Request): boolean {
  const contentType = request.headers.get('Content-Type') ?? ''
  return contentType.split(';')[0].trim().toLowerCase() === 'application/json'
}

/** 本文を JSON のオブジェクトとして読む。読めなければ MealValidationError */
async function readObject(request: Request): Promise<Record<string, unknown>> {
  let data: unknown
  try {
    data = JSON.parse(await request.text())
  } catch {
    throw new MealValidationError('リクエストの本文が JSON として読めません')
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new MealValidationError('リクエストの本文は JSON のオブジェクトにしてください')
  }
  return data as Record<string, unknown>
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...headers,
    },
  })
}

function errorBody(type: ApiErrorType, message: string): ApiErrorBody {
  return { error: { type, message } }
}

function errorResponse(error: unknown): Response {
  if (error instanceof HttpError) return json(error.status, errorBody(error.type, error.message), error.headers)
  if (error instanceof MealValidationError) return json(400, errorBody('MealValidationError', error.message))
  if (error instanceof MealNotFoundError) return json(404, errorBody('MealNotFoundError', error.message))
  if (error instanceof MealStorageError) {
    console.error(error)
    return json(500, errorBody('MealStorageError', error.message))
  }
  console.error(error)
  return json(500, errorBody('MealStorageError', 'サーバーでエラーが起きました'))
}
