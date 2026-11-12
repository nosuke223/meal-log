import { createApiPlanClient } from './apiPlanClient'
import type { PlanClient } from './planClient'

/**
 * アプリが使うプランの窓口（サーバーの API）を作る。
 * 画面のテストでは、このモジュールを差し替えて、メモリーの中だけで動く窓口を使う（src/vitest.setup.ts）
 */
export function createDefaultPlanClient(): PlanClient {
  return createApiPlanClient()
}
