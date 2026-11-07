import { MEAL_STATUS_LABELS } from '../meals/labels'
import type { MealStatus } from '../meals/mealRecord'

/** 状態の札に、文字と並べて書く記号（色だけに頼らず区別できるようにする） */
const STATUS_SYMBOLS = { planned: '○', eaten: '✓' } as const

/** 状態の札（「○ 予定」「✓ 食べた」） */
export function StatusBadge({ status }: { status: MealStatus }) {
  return (
    <span className={`status status-${status}`}>
      <span aria-hidden="true">{STATUS_SYMBOLS[status]}</span>
      {MEAL_STATUS_LABELS[status]}
    </span>
  )
}
