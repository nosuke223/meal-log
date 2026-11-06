// 状態（予定／食べた）の決まり
//   明日以降の日の品は、必ず「予定」
//   過去の日の品は、必ず「食べた」
//   今日の品は、どちらにもできる
import type { MealStatus } from './mealRecord'

/**
 * 日付（YYYY-MM-DD）に合う状態を返す。今日のときは current（省略すると「予定」）のまま。
 * 品を追加するときは current を省略し、日付を変えるときは変える前の状態を渡す
 */
export function statusForDate(date: string, today: string, current: MealStatus = 'planned'): MealStatus {
  if (date > today) return 'planned'
  if (date < today) return 'eaten'
  return current
}

/** 予定と食べたを切り替えられる日（今日だけ）なら true */
export function canToggleStatus(date: string, today: string): boolean {
  return date === today
}
