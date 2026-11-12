import type { PlanStatus } from '../meals/plan'

/**
 * 会員のプランを読む窓口。画面からはこの窓口だけを使う（API を直接呼ばない）。
 * ログインの期限が切れていたら LoginExpiredError（src/meals/mealRepository.ts）
 */
export interface PlanClient {
  /** ログイン中の会員のプラン、保存できる記録の数（有料は null）、今の記録の数 */
  getPlan(): Promise<PlanStatus>
}
