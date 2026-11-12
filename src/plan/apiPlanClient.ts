import { CONNECTION_FAILED_MESSAGE, LOGIN_EXPIRED_MESSAGE } from '../meals/apiMealRepository'
import { LoginExpiredError } from '../meals/mealRepository'
import type { PlanStatus } from '../meals/plan'
import type { PlanClient } from './planClient'

export type ApiPlanClientOptions = {
  /** API を呼ぶのに使う。テストで差し替える */
  fetch?: typeof fetch
  /** API の場所。省略すると同じオリジンの /api */
  baseUrl?: string
}

/** サーバーの API（GET /api/plan）でプランを読む窓口を作る */
export function createApiPlanClient(options: ApiPlanClientOptions = {}): PlanClient {
  const fetchApi = options.fetch ?? ((input, init) => fetch(input, init))
  const baseUrl = options.baseUrl ?? '/api'

  return {
    async getPlan() {
      let response: Response
      try {
        response = await fetchApi(`${baseUrl}/plan`, {
          method: 'GET',
          headers: { Accept: 'application/json' },
          // ログインの cookie を送る
          credentials: 'same-origin',
          // 保存の窓口と同じく、Access のログイン画面への転送はたどらずに受け取る
          redirect: 'manual',
        })
      } catch (error) {
        throw new Error(CONNECTION_FAILED_MESSAGE, { cause: error })
      }
      if (response.type === 'opaqueredirect' || response.status === 401 || (response.status >= 300 && response.status < 400)) {
        throw new LoginExpiredError(LOGIN_EXPIRED_MESSAGE)
      }
      let data: unknown
      try {
        data = await response.json()
      } catch (error) {
        if (!response.ok) throw new Error(`サーバーでエラーが起きました（${response.status}）`, { cause: error })
        throw new Error('サーバーの応答が読めません', { cause: error })
      }
      if (!response.ok) throw new Error(`サーバーでエラーが起きました（${response.status}${detailOf(data)}）`)
      return planStatusOf(data)
    },
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** エラーの本文（{ error: { message } }）の message を、「: <message>」の形にする（なければ空） */
function detailOf(data: unknown): string {
  const message = isObject(data) && isObject(data.error) ? data.error.message : undefined
  return typeof message === 'string' && message !== '' ? `: ${message}` : ''
}

function planStatusOf(data: unknown): PlanStatus {
  if (
    isObject(data) &&
    (data.plan === 'free' || data.plan === 'paid') &&
    (data.limit === null || typeof data.limit === 'number') &&
    typeof data.count === 'number'
  ) {
    return { plan: data.plan, limit: data.limit, count: data.count }
  }
  throw new Error('サーバーの応答の形が違います')
}
