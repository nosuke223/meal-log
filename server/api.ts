// 保存の窓口（MealRepository）の全操作に対応する API。Pages Functions（functions/api/[[path]].ts）から呼ぶ。
// 記録の API は、cookie のセッション（会員のログイン）で本人を確かめ、その会員の記録だけを読み書きする

import { MealValidationError, type MealChanges, type MealInput } from '../src/meals/mealRecord'
import { MealNotFoundError, MealStorageError, PlanLimitError, type MealRepository } from '../src/meals/mealRepository'
import type { PlanStatus } from '../src/meals/plan'
import type { D1Database } from './d1'
import { createD1MealRepository } from './d1MealRepository'
import type { MailTransport } from './mail/mailer'
import {
  AuthConfigurationError,
  createMemberAuth,
  isAuthPath,
  type AuthenticatedMember,
  type MemberAuthEnv,
} from './memberAuth'
import { parseFreePlanRecordLimit, readPlanUsage, recordLimitFor } from './memberPlan'
import { applyMigrations, appliedMigrationNames, type Migration } from './migrate'

export type ApiEnv = MemberAuthEnv & {
  /** つながっていない環境（Pages の設定で D1 をつないでいないとき）では無い */
  DB?: D1Database
  /**
   * 無料のプランで保存できる記録の数（1以上の整数）。プレビューで上限を手早く試すためのもの。
   * 本番には設定しない（ないときは src/meals/plan.ts の FREE_PLAN_RECORD_LIMIT）
   */
  FREE_PLAN_RECORD_LIMIT?: string
}

export type ApiOptions = {
  /** 今の日時。テストで差し替える */
  now?: () => Date
  /** ID を作る。テストで差し替える */
  generateId?: () => string
  /** 当てるマイグレーション。テストで差し替える（既定は migrations/ のすべて） */
  migrations?: readonly Migration[]
  /** メールを送る部分。省略すると Resend の API で送る。テストと手元の開発サーバーで差し替える */
  mailTransport?: MailTransport
}

/** エラーの本文の type。画面でエラーの種類を見分けるのに使う */
export type ApiErrorType =
  | 'MealValidationError'
  | 'MealNotFoundError'
  | 'MealStorageError'
  | 'Unauthorized'
  | 'Forbidden'
  | 'AuthConfigurationError'
  | 'RouteNotFound'
  | 'MethodNotAllowed'
  | 'UnsupportedMediaType'
  | 'DatabaseNotConfigured'
  | 'MigrationError'
  | 'MailConfigurationError'
  | 'MailSendError'
  | 'PlanLimitExceeded'

/** エラーの本文の形。上限のエラー（PlanLimitExceeded）のときだけ、limit（上限）と count（今の記録の数）が入る */
export type ApiErrorBody = {
  error: {
    type: ApiErrorType
    message: string
    limit?: number
    count?: number
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
  /** ログインした会員のプランと記録の数を読む */
  readPlan: () => Promise<PlanStatus>
}

/** API のリクエストを処理する関数を作る */
export function createApiHandler(options: ApiOptions = {}) {
  const memberAuth = createMemberAuth({ mailTransport: options.mailTransport })
  const migrations = options.migrations
  // マイグレーションを当て終えたか（当てている途中なら、その処理）。この実行環境で最初のリクエストのときだけ当て、
  // 失敗したら覚えず、次のリクエストでやり直す
  let migrated: Promise<void> | null = null

  function migrate(db: D1Database): Promise<void> {
    migrated ??= applyMigrations(db, migrations).catch((error: unknown) => {
      migrated = null
      console.error(error)
      throw new HttpError(500, 'MigrationError', '表の変更（マイグレーション）を当てられませんでした')
    })
    return migrated
  }

  // 無料のプランの上限。環境変数の解析（と使えない値のときの警告）は、同じ値につき1回だけ行う
  let freePlanLimit: { value: string | undefined; limit: number } | null = null
  function freePlanRecordLimit(env: ApiEnv): number {
    const value = env.FREE_PLAN_RECORD_LIMIT
    if (freePlanLimit === null || freePlanLimit.value !== value) {
      freePlanLimit = { value, limit: parseFreePlanRecordLimit(value) }
    }
    return freePlanLimit.limit
  }

  return async function handleApiRequest(request: Request, env: ApiEnv): Promise<Response> {
    try {
      const db = env.DB
      if (!db) {
        throw new HttpError(500, 'DatabaseNotConfigured', 'データベース（D1）がつながっていません。DB の名前でつないでください')
      }
      // 認証より前に当てる（ログインしていないリクエストでも、表は当たっているようにする）
      await migrate(db)

      const url = new URL(request.url)
      if (routeName(url.pathname) === 'health') return await handleHealth(request, db)
      // 会員の登録とログイン（ログインしていなくても使う）
      if (isAuthPath(url.pathname)) {
        return await withAuthConfiguration(() => memberAuth.handleAuthRequest(request, env, db))
      }

      // 記録の API は、ログインした会員だけが使える（cookie のセッションで確かめる）
      const member: AuthenticatedMember | null = await withAuthConfiguration(() => memberAuth.getMember(request, env, db))
      if (member === null) throw new HttpError(401, 'Unauthorized', 'ログインしていないか、ログインの期限が切れています')

      const route = matchRoute(url.pathname)
      const handler = route.methods[request.method]
      if (!handler) {
        const allow = Object.keys(route.methods).join(', ')
        throw new HttpError(405, 'MethodNotAllowed', `この操作には対応していません: ${request.method}`, { Allow: allow })
      }
      if (WRITE_METHODS.includes(request.method)) {
        // cookie で認証するので、他のオリジンの画面からの書き込みは受け付けない
        const requestOrigin = request.headers.get('Origin')
        if (requestOrigin !== null && requestOrigin !== url.origin) {
          throw new HttpError(403, 'Forbidden', '他のオリジンからの書き込みは受け付けません')
        }
        if (!isJsonRequest(request)) {
          throw new HttpError(415, 'UnsupportedMediaType', '書き込みのリクエストは Content-Type: application/json にしてください')
        }
      }
      const freeLimit = freePlanRecordLimit(env)
      const repository = createD1MealRepository(db, member.id, { ...options, freePlanRecordLimit: freeLimit })
      const memberId = member.id
      const readPlan = async (): Promise<PlanStatus> => {
        let usage
        try {
          usage = await readPlanUsage(db, memberId)
        } catch (error) {
          const reason = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
          throw new MealStorageError(`保存先から読み込めません（${reason}）`, { cause: error })
        }
        return { plan: usage.plan, limit: recordLimitFor(usage.plan, freeLimit), count: usage.count }
      }
      return await handler({ repository, url, request, readPlan })
    } catch (error) {
      return errorResponse(error)
    }
  }
}

/** 秘密の値がないときのエラー（AuthConfigurationError）を、500 の応答にする */
async function withAuthConfiguration<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    if (error instanceof AuthConfigurationError) throw new HttpError(500, 'AuthConfigurationError', error.message)
    throw error
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

// 1件の記録は、ID をクエリ（/api/meal?id=<id>）で指定する。パスに入れると、「.」や「..」だけの ID が
// URL の正規化で消えて、その記録を扱えなくなるため
const mealRoute: Route = {
  methods: {
    async GET({ repository, url }) {
      const id = recordId(url)
      const meal = await repository.get(id)
      if (meal === null) throw new MealNotFoundError(id)
      return json(200, { meal })
    },
    async PATCH({ repository, request, url }) {
      const id = recordId(url)
      const changes = await readObject(request)
      return json(200, { meal: await repository.update(id, changes as MealChanges) })
    },
    async DELETE({ repository, url }) {
      await repository.delete(recordId(url))
      return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } })
    },
  },
}

/** クエリの id を読む。id がない、ほかの条件がある、または同じ条件が重なっていたら MealValidationError */
function recordId(url: URL): string {
  const query = url.searchParams
  const ids = query.getAll('id')
  if ([...query.keys()].some((key) => key !== 'id') || ids.length !== 1 || ids[0] === '') {
    throw new MealValidationError('id に記録の ID を1つだけ入れてください（例: /api/meal?id=<id>）')
  }
  return ids[0]
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

const planRoute: Route = {
  methods: {
    async GET({ readPlan }) {
      return json(200, await readPlan())
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

/**
 * 動いていることを確かめる（ログインなしで開ける）。当てたマイグレーションの名前を番号順に返す。
 * 秘密の値やエラーの詳しい内容は返さない
 */
async function handleHealth(request: Request, db: D1Database): Promise<Response> {
  if (request.method !== 'GET') {
    throw new HttpError(405, 'MethodNotAllowed', `この操作には対応していません: ${request.method}`, { Allow: 'GET' })
  }
  return json(200, { migrations: await appliedMigrationNames(db) })
}

/** /api/<名前> の名前（デコードしたもの）。その形でなければ null */
function routeName(pathname: string): string | null {
  const segments = pathname.split('/').filter((segment) => segment !== '')
  let decoded: string[]
  try {
    decoded = segments.map((segment) => decodeURIComponent(segment))
  } catch {
    return null
  }
  return decoded[0] === 'api' && decoded.length === 2 ? decoded[1] : null
}

function matchRoute(pathname: string): Route {
  const name = routeName(pathname)
  if (name === 'meals') return mealsRoute
  if (name === 'meal') return mealRoute
  if (name === 'mark-planned-as-eaten') return markPlannedRoute
  if (name === 'import') return importRoute
  if (name === 'plan') return planRoute
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
  if (error instanceof PlanLimitError) {
    const body = errorBody('PlanLimitExceeded', error.message)
    if (error.limit !== null) body.error.limit = error.limit
    if (error.count !== null) body.error.count = error.count
    return json(403, body)
  }
  if (error instanceof MealStorageError) {
    console.error(error)
    return json(500, errorBody('MealStorageError', error.message))
  }
  console.error(error)
  return json(500, errorBody('MealStorageError', 'サーバーでエラーが起きました'))
}
