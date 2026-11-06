import { expect, test } from 'vitest'
import { parseHash, todayHash } from './route'

const TODAY = '2026-11-06'

test('todayHash は今日の記録の画面になる', () => {
  expect(parseHash(todayHash(), TODAY)).toEqual({ screen: 'day', date: null })
})

test('ハッシュがないときや知らない形のときは、今日の記録の画面にする', () => {
  expect(parseHash('', TODAY)).toEqual({ screen: 'day', date: null })
  expect(parseHash('#/', TODAY)).toEqual({ screen: 'day', date: null })
  expect(parseHash('#/unknown', TODAY)).toEqual({ screen: 'day', date: null })
})

test('日付のハッシュは、その日の記録の画面にする（明日以降の日も）', () => {
  expect(parseHash('#/day/2026-10-03', TODAY)).toEqual({ screen: 'day', date: '2026-10-03' })
  expect(parseHash('#/day/2026-11-06', TODAY)).toEqual({ screen: 'day', date: '2026-11-06' })
  expect(parseHash('#/day/2026-11-07', TODAY)).toEqual({ screen: 'day', date: '2026-11-07' })
  expect(parseHash('#/day/2027-01-15', TODAY)).toEqual({ screen: 'day', date: '2027-01-15' })
})

test('不正な日付は、今日の記録の画面にする', () => {
  for (const hash of ['#/day/2026-02-30', '#/day/abc', '#/day/2026-1-3', '#/day/']) {
    expect(parseHash(hash, TODAY)).toEqual({ screen: 'day', date: null })
  }
})

test('カレンダーのハッシュは、その月にする。月がない・不正なときは今月にする', () => {
  expect(parseHash('#/calendar/2026-09', TODAY)).toEqual({ screen: 'calendar', month: '2026-09' })
  expect(parseHash('#/calendar', TODAY)).toEqual({ screen: 'calendar', month: '2026-11' })
  expect(parseHash('#/calendar/2026-13', TODAY)).toEqual({ screen: 'calendar', month: '2026-11' })
})
