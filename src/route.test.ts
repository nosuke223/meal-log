import { expect, test } from 'vitest'
import { EMAIL_VERIFICATION_RESULTS } from './auth/authClient'
import {
  accountHash,
  calendarDateHash,
  calendarHash,
  dataHash,
  loginHash,
  parseHash,
  signupHash,
  todayHash,
} from './route'

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

test('カレンダーの月のハッシュは、その月にする。今月なら今日を選び、ほかの月は何も選ばない', () => {
  expect(parseHash('#/calendar/2026-09', TODAY)).toEqual({ screen: 'calendar', month: '2026-09', selected: null })
  expect(parseHash('#/calendar/2027-11', TODAY)).toEqual({ screen: 'calendar', month: '2027-11', selected: null })
  expect(parseHash(calendarHash('2026-11'), TODAY)).toEqual({
    screen: 'calendar',
    month: '2026-11',
    selected: '2026-11-06',
  })
})

test('カレンダーの日付のハッシュは、その日の月にし、その日を選ぶ（過去・今日・明日以降）', () => {
  for (const date of ['2026-10-03', '2026-11-06', '2026-11-07', '2027-02-28']) {
    expect(parseHash(calendarDateHash(date), TODAY)).toEqual({
      screen: 'calendar',
      month: date.slice(0, 7),
      selected: date,
    })
  }
  expect(calendarDateHash('2026-11-03')).toBe('#/calendar/2026-11-03')
})

test('カレンダーの月や日付がない・不正なときは、今月にし、今日を選ぶ', () => {
  for (const hash of ['#/calendar', '#/calendar/', '#/calendar/2026-13', '#/calendar/2026-02-30', '#/calendar/2026-11-6']) {
    expect(parseHash(hash, TODAY)).toEqual({ screen: 'calendar', month: '2026-11', selected: '2026-11-06' })
  }
})

test('データのハッシュは、データの画面にする', () => {
  expect(dataHash()).toBe('#/data')
  expect(parseHash(dataHash(), TODAY)).toEqual({ screen: 'data' })
})

test('ログイン、会員登録、アカウントのハッシュは、それぞれの画面にする', () => {
  expect(loginHash()).toBe('#/login')
  expect(signupHash()).toBe('#/signup')
  expect(accountHash()).toBe('#/account')
  expect(parseHash(loginHash(), TODAY)).toEqual({ screen: 'login', verification: null })
  expect(parseHash(signupHash(), TODAY)).toEqual({ screen: 'signup' })
  expect(parseHash(accountHash(), TODAY)).toEqual({ screen: 'account' })
})

test('確認のメールのリンクの結果のハッシュは、結果を付けたログインの画面にする。知らない結果は、ただのログインの画面', () => {
  for (const result of EMAIL_VERIFICATION_RESULTS) {
    expect(loginHash(result)).toBe(`#/login/${result}`)
    expect(parseHash(loginHash(result), TODAY)).toEqual({ screen: 'login', verification: result })
  }
  expect(parseHash('#/login/unknown', TODAY)).toEqual({ screen: 'login', verification: null })
})
