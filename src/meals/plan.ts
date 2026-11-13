/** 会員のプラン。free は無料（記録の数に上限がある）、paid は有料（上限なし） */
export type Plan = 'free' | 'paid'

/**
 * 無料のプランで保存できる記録の数（予定の記録も数える）。サーバーの既定値として使う
 * （サーバーの環境変数 FREE_PLAN_RECORD_LIMIT で変えられる）。
 * 画面は、この定数ではなく、GET /api/plan の limit を出す
 */
export const FREE_PLAN_RECORD_LIMIT = 300

/** プランと、記録の数（GET /api/plan の応答の形） */
export type PlanStatus = {
  plan: Plan
  /** 保存できる記録の数。有料（上限なし）は null */
  limit: number | null
  /** 今保存している記録の数 */
  count: number
}

/** 追加が上限で拒否されたときのメッセージ */
export function createLimitMessage(limit: number): string {
  return `無料のプランで保存できる記録は${limit}品までです。有料のプランにすると、上限がなくなります（有料のプランは準備中です）`
}

/** 取り込みが上限で拒否されたときのメッセージ */
export function importLimitMessage(limit: number): string {
  return `取り込むと、無料のプランの上限（${limit}品）を超えます。取り込みは行われませんでした`
}
