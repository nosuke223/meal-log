import { expect, test } from 'vitest'
import { canToggleStatus, statusForDate } from './mealStatus'

const TODAY = '2026-11-06'

test('追加するときの状態は、今日と明日以降の日は予定、過去の日は食べた', () => {
  expect(statusForDate('2026-11-06', TODAY)).toBe('planned')
  expect(statusForDate('2026-11-07', TODAY)).toBe('planned')
  expect(statusForDate('2027-01-01', TODAY)).toBe('planned')
  expect(statusForDate('2026-11-05', TODAY)).toBe('eaten')
  expect(statusForDate('2025-12-31', TODAY)).toBe('eaten')
})

test('日付を変えるとき、未来の日は予定、過去の日は食べた、今日はそのときの状態のまま', () => {
  for (const current of ['planned', 'eaten'] as const) {
    expect(statusForDate('2026-11-10', TODAY, current)).toBe('planned')
    expect(statusForDate('2026-11-01', TODAY, current)).toBe('eaten')
    expect(statusForDate(TODAY, TODAY, current)).toBe(current)
  }
})

test('予定と食べたを切り替えられるのは、今日の品だけ', () => {
  expect(canToggleStatus('2026-11-06', TODAY)).toBe(true)
  expect(canToggleStatus('2026-11-07', TODAY)).toBe(false)
  expect(canToggleStatus('2026-11-05', TODAY)).toBe(false)
})
