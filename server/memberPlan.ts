// 会員のプラン（表 member_plans）と、無料のプランの記録の上限

import { FREE_PLAN_RECORD_LIMIT, type Plan } from '../src/meals/plan'
import type { D1Database } from './d1'

/** 会員のプランと、保存している記録の数 */
export type PlanUsage = {
  plan: Plan
  count: number
}

/**
 * 会員のプランと記録の数を、1つの文で読む。プランの行がない会員は無料。
 * 読めなければ、保存先が投げたエラーをそのまま投げる（呼ぶ側で包む）
 */
export async function readPlanUsage(db: D1Database, userId: string): Promise<PlanUsage> {
  const row = await db
    .prepare(
      `SELECT (SELECT plan FROM member_plans WHERE user_id = ?1) AS plan,
         (SELECT COUNT(*) FROM member_meals WHERE user_id = ?1) AS count`,
    )
    .bind(userId)
    .first<{ plan: string | null; count: number }>()
  return { plan: row?.plan === 'paid' ? 'paid' : 'free', count: Number(row?.count ?? 0) }
}

/** そのプランで保存できる記録の数。有料（上限なし）は null */
export function recordLimitFor(plan: Plan, freePlanRecordLimit: number): number | null {
  return plan === 'paid' ? null : freePlanRecordLimit
}

/**
 * 環境変数 FREE_PLAN_RECORD_LIMIT の値を、無料のプランの上限にする。
 * 前後の空白を取って、1以上の整数のときだけ使う。ないときは定数、使えない値のときは警告を出して定数にする
 */
export function parseFreePlanRecordLimit(value: string | undefined, warn: (message: string) => void = console.warn): number {
  if (value === undefined) return FREE_PLAN_RECORD_LIMIT
  const trimmed = value.trim()
  if (/^[1-9]\d*$/.test(trimmed)) {
    const limit = Number(trimmed)
    if (Number.isSafeInteger(limit)) return limit
  }
  warn(
    `環境変数 FREE_PLAN_RECORD_LIMIT の値（${JSON.stringify(value)}）は1以上の整数ではないので使いません。上限は ${FREE_PLAN_RECORD_LIMIT} 品にします`,
  )
  return FREE_PLAN_RECORD_LIMIT
}
