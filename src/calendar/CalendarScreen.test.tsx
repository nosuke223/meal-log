import { fireEvent, render, screen, within } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import App from '../App'
import { MEAL_STORAGE_KEY } from '../meals/localStorageMealRepository'
import type { MealRecord } from '../meals/mealRecord'

const TODAY = '2026-11-06'

function seed(records: Partial<MealRecord>[]) {
  const full = records.map((fields, index) => ({
    id: `id-${index}`,
    date: '2026-11-01',
    mealType: 'lunch',
    name: `品${index}`,
    genre: null,
    dishType: null,
    status: 'eaten',
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    ...fields,
  }))
  window.localStorage.setItem(MEAL_STORAGE_KEY, JSON.stringify({ version: 1, records: full }))
}

function openCalendar() {
  render(<App today={TODAY} />)
  fireEvent.click(screen.getByRole('button', { name: 'カレンダー' }))
}

function calendar() {
  return within(screen.getByRole('table'))
}

test('記録の画面のボタンでカレンダーを開くと、今月が表示され、今日のマスが強調される', async () => {
  openCalendar()
  expect(screen.getByRole('heading', { name: '2026年11月' })).toBeInTheDocument()
  expect(window.location.hash).toBe('#/calendar/2026-11')
  const today = await calendar().findByRole('button', { name: '11月6日' })
  expect(today).toHaveAttribute('aria-current', 'date')
  expect(calendar().getByRole('button', { name: '11月5日' })).not.toHaveAttribute('aria-current')
})

test('前の月・次の月・今月のボタンで月を移る', () => {
  openCalendar()
  fireEvent.click(screen.getByRole('button', { name: '前の月' }))
  expect(screen.getByRole('heading', { name: '2026年10月' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '前の月' }))
  expect(screen.getByRole('heading', { name: '2026年9月' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '今月' }))
  expect(screen.getByRole('heading', { name: '2026年11月' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '次の月' }))
  fireEvent.click(screen.getByRole('button', { name: '次の月' }))
  expect(screen.getByRole('heading', { name: '2027年1月' })).toBeInTheDocument()
})

test('記録がある日にジャンルごとの点が1つずつ付き、予定と記録のない日には付かない', async () => {
  seed([
    { date: '2026-11-02', genre: 'chinese' },
    { date: '2026-11-02', genre: 'chinese' },
    { date: '2026-11-02', genre: 'japanese' },
    { date: '2026-11-02', genre: null },
    { date: '2026-11-03', genre: 'western', status: 'planned' },
    { date: '2026-10-31', genre: 'other' },
  ])
  openCalendar()
  const marked = await calendar().findByRole('button', { name: '11月2日 和・中・未設定' })
  expect(marked).toHaveTextContent('和中未')
  expect(calendar().getByRole('button', { name: '11月3日' })).toHaveTextContent(/^3$/)
  expect(calendar().getByRole('button', { name: '11月4日' })).toHaveTextContent(/^4$/)

  fireEvent.click(screen.getByRole('button', { name: '前の月' }))
  expect(await calendar().findByRole('button', { name: '10月31日 その他' })).toBeInTheDocument()
})

test('凡例に、すべてのジャンルの点が表示される', () => {
  openCalendar()
  const legend = within(screen.getByRole('region', { name: '点の凡例' }))
  const items = legend.getAllByRole('listitem').map((item) => item.textContent)
  // 点の文字と名前
  expect(items).toEqual(['和和', '洋洋', '中中', '他その他', '未未設定'])
})

test('未来の日は選べない', () => {
  openCalendar()
  expect(calendar().getByRole('button', { name: '11月7日' })).toBeDisabled()
  expect(calendar().getByRole('button', { name: '11月6日' })).toBeEnabled()
  fireEvent.click(screen.getByRole('button', { name: '次の月' }))
  expect(calendar().getByRole('button', { name: '12月1日' })).toBeDisabled()
})

test('過去の日を選ぶとその日の記録の画面が開き、追加した品が戻ったカレンダーの点に出る', async () => {
  seed([{ date: '2026-10-20', mealType: 'dinner', name: 'カレー', genre: 'other' }])
  openCalendar()
  fireEvent.click(screen.getByRole('button', { name: '前の月' }))
  fireEvent.click(await calendar().findByRole('button', { name: '10月20日 その他' }))

  expect(window.location.hash).toBe('#/day/2026-10-20')
  expect(screen.getByText('2026年10月20日（火）')).toBeInTheDocument()
  const dinner = within(screen.getByRole('region', { name: '夜' }))
  expect(await dinner.findByRole('button', { name: /カレー/ })).toBeInTheDocument()

  const morning = within(screen.getByRole('region', { name: '朝' }))
  fireEvent.click(within(morning.getByRole('group', { name: 'ジャンル' })).getByRole('button', { name: '洋' }))
  fireEvent.change(morning.getByRole('textbox', { name: '新しい品名' }), { target: { value: 'パン' } })
  fireEvent.click(morning.getByRole('button', { name: '追加' }))
  await morning.findByRole('button', { name: /パン/ })

  // jsdom では「戻る」で popstate が起きないため、画面のボタンで戻る（「戻る」は Playwright で確かめる）
  fireEvent.click(screen.getByRole('button', { name: 'カレンダー' }))
  expect(await calendar().findByRole('button', { name: '10月20日 洋・その他' })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: '2026年10月' })).toBeInTheDocument()
})

test('アドレスに日付があれば、その日の記録の画面を開く', async () => {
  seed([{ date: '2026-09-15', mealType: 'breakfast', name: 'おにぎり' }])
  window.history.replaceState(null, '', '/#/day/2026-09-15')
  render(<App today={TODAY} />)
  expect(screen.getByText('2026年9月15日（火）')).toBeInTheDocument()
  expect(await within(screen.getByRole('region', { name: '朝' })).findByRole('button', { name: /おにぎり/ })).toBeInTheDocument()
})

test('アドレスの日付が不正なときや未来の日のときは、今日の記録の画面を開く', () => {
  for (const hash of ['#/day/2026-02-30', '#/day/hello', '#/day/2026-11-07']) {
    window.history.replaceState(null, '', `/${hash}`)
    const view = render(<App today={TODAY} />)
    expect(screen.getByText('2026年11月6日（金）')).toBeInTheDocument()
    view.unmount()
  }
})

test('カレンダーの読み込みに失敗したとき、エラーを表示する', async () => {
  window.localStorage.setItem(MEAL_STORAGE_KEY, '{broken')
  openCalendar()
  await vi.waitFor(() => {
    expect(screen.getByRole('alert')).toHaveTextContent('記録を読み込めませんでした: 保存データが壊れています')
  })
})
