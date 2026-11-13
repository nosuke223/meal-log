import type { MealRepository } from '../meals/mealRepository'
import { FREE_PLAN_RECORD_LIMIT, type Plan } from '../meals/plan'
import type { PlanClient } from './planClient'

export type MemoryPlanClientOptions = {
  /** 既定は free */
  plan?: Plan
  /** 無料のプランで保存できる記録の数。既定は FREE_PLAN_RECORD_LIMIT */
  limit?: number
  /** 記録の数を数える保存の窓口。省くと、記録の数は 0 */
  repository?: MealRepository
}

/** メモリーの中だけで動くプランの窓口（画面のテスト用。アプリでは使わない） */
export function createMemoryPlanClient(options: MemoryPlanClientOptions = {}): PlanClient & {
  /** 次の呼び出しを、このエラーで失敗させる */
  failNext(error: Error): void
} {
  const plan = options.plan ?? 'free'
  const limit = options.limit ?? FREE_PLAN_RECORD_LIMIT
  let nextError: Error | null = null

  return {
    failNext(error) {
      nextError = error
    },

    async getPlan() {
      const error = nextError
      nextError = null
      if (error) throw error
      const count = options.repository ? (await options.repository.listAll()).length : 0
      return { plan, limit: plan === 'paid' ? null : limit, count }
    },
  }
}
