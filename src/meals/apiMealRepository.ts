import { MealValidationError, type MealRecord } from './mealRecord'
import { MealNotFoundError, MealStorageError, type MealRepository } from './mealRepository'

/** ログインの期限が切れたとき（API が 401 を返した、ログイン画面へ転送された）のエラーのメッセージ */
export const LOGIN_EXPIRED_MESSAGE = 'ログインの期限が切れました。ページを読み込み直してください'

/** 通信に失敗したとき（サーバーに届かない）のエラーのメッセージ */
export const CONNECTION_FAILED_MESSAGE = 'サーバーに接続できませんでした。通信の状態を確かめてください'

export type ApiMealRepositoryOptions = {
  /** API を呼ぶのに使う。テストで差し替える */
  fetch?: typeof fetch
  /** API の場所。省略すると同じオリジンの /api */
  baseUrl?: string
}

type CallOptions = {
  body?: unknown
  /** 1件の記録の操作のときの ID（404 を MealNotFoundError にするのに使う） */
  id?: string
}

/** サーバーの API（server/api.ts）に保存する窓口を作る */
export function createApiMealRepository(options: ApiMealRepositoryOptions = {}): MealRepository {
  const fetchApi = options.fetch ?? ((input, init) => fetch(input, init))
  const baseUrl = options.baseUrl ?? '/api'

  async function call(method: string, path: string, callOptions: CallOptions = {}): Promise<unknown> {
    const headers: Record<string, string> = { Accept: 'application/json' }
    // 書き込みは Content-Type: application/json だけを受け付ける（本文のない DELETE も）
    if (method !== 'GET') headers['Content-Type'] = 'application/json'
    let response: Response
    try {
      response = await fetchApi(`${baseUrl}${path}`, {
        method,
        headers,
        body: callOptions.body === undefined ? undefined : JSON.stringify(callOptions.body),
        // ログインの期限が切れると、Access はログイン画面（別のオリジン）へ転送する。
        // 転送をたどると通信の失敗と見分けられないので、たどらずに受け取る
        redirect: 'manual',
      })
    } catch (error) {
      throw new MealStorageError(CONNECTION_FAILED_MESSAGE, { cause: error })
    }
    if (isLoginExpired(response)) throw new MealStorageError(LOGIN_EXPIRED_MESSAGE)
    if (!response.ok) throw await errorOf(response, callOptions.id)
    if (response.status === 204) return null
    return readJson(response)
  }

  function query(params: Record<string, string>): string {
    return `?${new URLSearchParams(params).toString()}`
  }

  return {
    async listByDate(date) {
      return mealsOf(await call('GET', `/meals${query({ date })}`))
    },

    async listByDateRange(from, to) {
      return mealsOf(await call('GET', `/meals${query({ from, to })}`))
    },

    async get(id) {
      try {
        return mealOf(await call('GET', `/meal${query({ id })}`, { id }))
      } catch (error) {
        if (error instanceof MealNotFoundError) return null
        throw error
      }
    },

    async create(input) {
      return mealOf(await call('POST', '/meals', { body: input }))
    },

    async update(id, changes) {
      return mealOf(await call('PATCH', `/meal${query({ id })}`, { body: changes, id }))
    },

    async delete(id) {
      await call('DELETE', `/meal${query({ id })}`, { id })
    },

    async markPlannedAsEatenBefore(date) {
      return mealsOf(await call('POST', '/mark-planned-as-eaten', { body: { date } }))
    },

    async listAll() {
      return mealsOf(await call('GET', '/meals'))
    },

    async importRecords(records) {
      await call('POST', '/import', { body: { records } })
    },
  }
}

function isLoginExpired(response: Response): boolean {
  // redirect: 'manual' では、転送の応答は type が opaqueredirect（状態コードは 0）になる
  if (response.type === 'opaqueredirect') return true
  return response.status === 401 || (response.status >= 300 && response.status < 400)
}

/** エラーの応答（本文は { error: { type, message } }）を、窓口のエラーにする */
async function errorOf(response: Response, id: string | undefined): Promise<Error> {
  let type: unknown
  let message: unknown
  try {
    const body = (await response.json()) as { error?: { type?: unknown; message?: unknown } }
    type = body.error?.type
    message = body.error?.message
  } catch {
    // 本文が読めないときは、状態コードだけで決める
  }
  const detail = typeof message === 'string' && message !== '' ? message : null
  if (response.status === 400) return new MealValidationError(detail ?? '不正な値です')
  // 404 でも、ない API のアドレス（RouteNotFound）は、記録がないのではなく、サーバーの不具合として扱う
  if (response.status === 404 && type === 'MealNotFoundError') return new MealNotFoundError(id ?? '')
  return new MealStorageError(`サーバーでエラーが起きました（${response.status}${detail ? `: ${detail}` : ''}）`)
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch (error) {
    throw new MealStorageError('サーバーの応答が読めません', { cause: error })
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function mealsOf(data: unknown): MealRecord[] {
  if (!isObject(data) || !Array.isArray(data.meals) || !data.meals.every(isObject)) {
    throw new MealStorageError('サーバーの応答の形が違います')
  }
  return data.meals as MealRecord[]
}

function mealOf(data: unknown): MealRecord {
  if (!isObject(data) || !isObject(data.meal)) throw new MealStorageError('サーバーの応答の形が違います')
  return data.meal as MealRecord
}
