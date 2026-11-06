import { expect, test } from 'vitest'
import type { MealRecord } from '../meals/mealRecord'
import { buildMonthWeeks, genreMarksByDate, isValidMonth, monthRange, shiftMonth } from './calendarMonth'

function record(fields: Partial<MealRecord>): MealRecord {
  return {
    id: crypto.randomUUID(),
    date: '2026-11-01',
    mealType: 'lunch',
    name: '品',
    genre: null,
    dishType: null,
    status: 'eaten',
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    ...fields,
  }
}

test('YYYY-MM の書式の月だけを正しい月とする', () => {
  expect(isValidMonth('2026-11')).toBe(true)
  expect(isValidMonth('2026-01')).toBe(true)
  expect(isValidMonth('2026-13')).toBe(false)
  expect(isValidMonth('2026-00')).toBe(false)
  expect(isValidMonth('2026-1')).toBe(false)
  expect(isValidMonth(undefined)).toBe(false)
})

test('月をずらすと、年をまたいでも正しい月になる', () => {
  expect(shiftMonth('2026-11', 1)).toBe('2026-12')
  expect(shiftMonth('2026-12', 1)).toBe('2027-01')
  expect(shiftMonth('2026-01', -1)).toBe('2025-12')
  expect(shiftMonth('2026-03', -14)).toBe('2025-01')
})

test('月の最初の日と最後の日を求める（うるう年を含む）', () => {
  expect(monthRange('2026-11')).toEqual({ from: '2026-11-01', to: '2026-11-30' })
  expect(monthRange('2026-02')).toEqual({ from: '2026-02-01', to: '2026-02-28' })
  expect(monthRange('2028-02')).toEqual({ from: '2028-02-01', to: '2028-02-29' })
  expect(monthRange('2026-12')).toEqual({ from: '2026-12-01', to: '2026-12-31' })
})

test('日曜始まりの週に並べ、月の外のマスは空にする', () => {
  // 2026年10月1日は木曜、31日は土曜
  const october = buildMonthWeeks('2026-10')
  expect(october).toHaveLength(5)
  expect(october[0]).toEqual([null, null, null, null, '2026-10-01', '2026-10-02', '2026-10-03'])
  expect(october[4]).toEqual(['2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31'])

  // 2026年11月1日は日曜、30日は月曜
  const november = buildMonthWeeks('2026-11')
  expect(november[0][0]).toBe('2026-11-01')
  expect(november.at(-1)).toEqual(['2026-11-29', '2026-11-30', null, null, null, null, null])
  for (const week of november) expect(week).toHaveLength(7)
})

test('日ごとに、出てきたジャンルの点を1つずつ、決まった順に並べる', () => {
  const marks = genreMarksByDate([
    record({ date: '2026-11-02', genre: 'chinese' }),
    record({ date: '2026-11-02', genre: 'chinese' }),
    record({ date: '2026-11-02', genre: null }),
    record({ date: '2026-11-02', genre: 'japanese' }),
    record({ date: '2026-11-03', genre: 'western' }),
    record({ date: '2026-11-03', genre: 'other' }),
  ])
  expect(marks.get('2026-11-02')).toEqual(['japanese', 'chinese', 'unset'])
  expect(marks.get('2026-11-03')).toEqual(['western', 'other'])
  expect(marks.has('2026-11-04')).toBe(false)
})

test('予定の記録は点に数えない', () => {
  const marks = genreMarksByDate([
    record({ date: '2026-11-02', genre: 'japanese', status: 'planned' }),
    record({ date: '2026-11-02', genre: 'western', status: 'eaten' }),
    record({ date: '2026-11-05', genre: 'chinese', status: 'planned' }),
  ])
  expect(marks.get('2026-11-02')).toEqual(['western'])
  expect(marks.has('2026-11-05')).toBe(false)
})
