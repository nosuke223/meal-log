import { createApiMealRepository } from './apiMealRepository'
import type { MealRepository } from './mealRepository'

/**
 * アプリが使う保存の窓口（サーバーの API）を作る。
 * 画面のテストでは、このモジュールを差し替えて、ブラウザ内の窓口を使う（src/vitest.setup.ts）
 */
export function createDefaultMealRepository(): MealRepository {
  return createApiMealRepository()
}
