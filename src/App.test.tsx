import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import App from './App'
import { MEAL_STORAGE_KEY } from './meals/localStorageMealRepository'

const TODAY = '2026-11-06'

function section(name: string) {
  return screen.getByRole('region', { name })
}

async function addItem(sectionName: string, name: string) {
  const target = section(sectionName)
  fireEvent.change(within(target).getByRole('textbox', { name: '新しい品名' }), { target: { value: name } })
  fireEvent.click(within(target).getByRole('button', { name: '追加' }))
  await within(target).findByRole('button', { name: new RegExp(name) })
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

test('今日の日付と、朝・昼・夜・間食の4つの欄を表示する', () => {
  render(<App today={TODAY} />)
  expect(screen.getByText('2026年11月6日（金）')).toBeInTheDocument()
  for (const name of ['朝', '昼', '夜', '間食']) {
    expect(section(name)).toBeInTheDocument()
  }
})

test('品名を入力して追加すると、その欄に品が表示され、品名の欄が空に戻る', async () => {
  render(<App today={TODAY} />)
  await addItem('朝', 'ごはん')
  expect(within(section('朝')).getByRole('textbox', { name: '新しい品名' })).toHaveValue('')
  expect(within(section('昼')).queryByRole('button', { name: /ごはん/ })).not.toBeInTheDocument()
})

test('品名が空白だけのとき、追加ボタンを押せない', () => {
  render(<App today={TODAY} />)
  const target = section('朝')
  const button = within(target).getByRole('button', { name: '追加' })
  expect(button).toBeDisabled()
  fireEvent.change(within(target).getByRole('textbox', { name: '新しい品名' }), { target: { value: '  ' } })
  expect(button).toBeDisabled()
})

test('描画し直しても、追加した品が残っている', async () => {
  const first = render(<App today={TODAY} />)
  await addItem('昼', 'うどん')
  first.unmount()
  render(<App today={TODAY} />)
  expect(await within(section('昼')).findByRole('button', { name: /うどん/ })).toBeInTheDocument()
})

test('ジャンルと料理の分類を選べ、同じボタンをもう一度押すと未設定に戻る', () => {
  render(<App today={TODAY} />)
  const genre = within(within(section('朝')).getByRole('group', { name: 'ジャンル' }))
  const dish = within(within(section('朝')).getByRole('group', { name: '料理の分類' }))
  fireEvent.click(genre.getByRole('button', { name: '和' }))
  expect(genre.getByRole('button', { name: '和' })).toHaveAttribute('aria-pressed', 'true')
  fireEvent.click(genre.getByRole('button', { name: '和' }))
  expect(genre.getByRole('button', { name: '和' })).toHaveAttribute('aria-pressed', 'false')
  fireEvent.click(dish.getByRole('button', { name: '主食' }))
  expect(dish.getByRole('button', { name: '主食' })).toHaveAttribute('aria-pressed', 'true')
  fireEvent.click(dish.getByRole('button', { name: '主食' }))
  expect(dish.getByRole('button', { name: '主食' })).toHaveAttribute('aria-pressed', 'false')
})

test('同じ区分の次の品にはジャンルが引き継がれ、料理の分類と別の区分には引き継がれない', async () => {
  render(<App today={TODAY} />)
  const morning = section('朝')
  fireEvent.click(within(within(morning).getByRole('group', { name: 'ジャンル' })).getByRole('button', { name: '和' }))
  fireEvent.click(within(within(morning).getByRole('group', { name: '料理の分類' })).getByRole('button', { name: '主食' }))
  await addItem('朝', 'ごはん')

  const genre = within(within(section('朝')).getByRole('group', { name: 'ジャンル' }))
  const dish = within(within(section('朝')).getByRole('group', { name: '料理の分類' }))
  expect(genre.getByRole('button', { name: '和' })).toHaveAttribute('aria-pressed', 'true')
  expect(dish.getByRole('button', { name: '主食' })).toHaveAttribute('aria-pressed', 'false')

  const lunchGenre = within(within(section('昼')).getByRole('group', { name: 'ジャンル' }))
  expect(lunchGenre.getByRole('button', { name: '和' })).toHaveAttribute('aria-pressed', 'false')

  // 引き継がれたジャンルは押して外せる
  fireEvent.click(genre.getByRole('button', { name: '和' }))
  expect(genre.getByRole('button', { name: '和' })).toHaveAttribute('aria-pressed', 'false')
})

test('品の内容と区分を変更でき、区分を変えると変更先の欄に移る', async () => {
  render(<App today={TODAY} />)
  await addItem('朝', 'ごはん')
  fireEvent.click(within(section('朝')).getByRole('button', { name: /ごはん/ }))

  const item = within(within(section('朝')).getByRole('form', { name: '品の変更' }))
  fireEvent.change(item.getByRole('textbox', { name: '品名' }), { target: { value: 'おにぎり' } })
  fireEvent.click(within(item.getByRole('group', { name: 'ジャンル' })).getByRole('button', { name: '和' }))
  fireEvent.click(within(item.getByRole('group', { name: '料理の分類' })).getByRole('button', { name: '主食' }))
  fireEvent.change(item.getByRole('combobox', { name: '区分' }), { target: { value: 'lunch' } })
  fireEvent.click(item.getByRole('button', { name: '保存' }))

  const moved = await within(section('昼')).findByRole('button', { name: /おにぎり/ })
  expect(moved).toHaveTextContent('和')
  expect(moved).toHaveTextContent('主食')
  expect(within(section('朝')).queryByRole('button', { name: /おにぎり/ })).not.toBeInTheDocument()
})

test('削除は確認の後に行い、取り消すと削除されない', async () => {
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
  render(<App today={TODAY} />)
  await addItem('夜', 'カレー')

  fireEvent.click(within(section('夜')).getByRole('button', { name: /カレー/ }))
  fireEvent.click(within(section('夜')).getByRole('button', { name: '削除' }))
  expect(confirm).toHaveBeenCalledTimes(1)
  expect(within(section('夜')).getByRole('textbox', { name: '品名' })).toHaveValue('カレー')

  confirm.mockReturnValue(true)
  fireEvent.click(within(section('夜')).getByRole('button', { name: '削除' }))
  await vi.waitFor(() => {
    expect(within(section('夜')).queryByRole('textbox', { name: '品名' })).not.toBeInTheDocument()
  })
  expect(within(section('夜')).queryByText('カレー')).not.toBeInTheDocument()
})

test('今日を指定しないとき、日付をまたぐと表示と記録の対象日が翌日に変わる', async () => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
  vi.setSystemTime(new Date(2026, 10, 6, 23, 59, 40))
  render(<App />)
  expect(screen.getByText('2026年11月6日（金）')).toBeInTheDocument()
  await addItem('朝', 'ごはん')

  act(() => {
    vi.setSystemTime(new Date(2026, 10, 7, 0, 0, 10))
    vi.advanceTimersByTime(30_000)
  })
  expect(screen.getByText('2026年11月7日（土）')).toBeInTheDocument()
  await vi.waitFor(() => {
    expect(within(section('朝')).queryByRole('button', { name: /ごはん/ })).not.toBeInTheDocument()
  })

  await addItem('朝', 'パン')
  const stored = JSON.parse(window.localStorage.getItem(MEAL_STORAGE_KEY) ?? '{}') as {
    records: { name: string; date: string }[]
  }
  expect(stored.records.map((record) => [record.name, record.date])).toEqual([
    ['ごはん', '2026-11-06'],
    ['パン', '2026-11-07'],
  ])
})

test('今日を指定しないとき、日付をまたいだ後の読み込みに失敗すると、エラーを表示し、前の日の品は表示しない', async () => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
  vi.setSystemTime(new Date(2026, 10, 6, 23, 59, 40))
  render(<App />)
  await addItem('朝', 'ごはん')

  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new DOMException('denied', 'SecurityError')
  })
  act(() => {
    vi.setSystemTime(new Date(2026, 10, 7, 0, 0, 10))
    vi.advanceTimersByTime(30_000)
  })
  expect(screen.getByText('2026年11月7日（土）')).toBeInTheDocument()
  expect(await screen.findByRole('alert')).toHaveTextContent('記録を読み込めませんでした')
  expect(within(section('朝')).queryByRole('button', { name: /ごはん/ })).not.toBeInTheDocument()
})

test('保存先へのアクセスが拒否される環境でも、画面を表示し、エラーを表示する', async () => {
  vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
    throw new DOMException('denied', 'SecurityError')
  })
  render(<App today={TODAY} />)
  expect(screen.getByText('2026年11月6日（金）')).toBeInTheDocument()
  expect(await screen.findByRole('alert')).toHaveTextContent('記録を読み込めませんでした')
})

test('保存データが壊れているとき、エラーを表示し、データを上書きしない', async () => {
  window.localStorage.setItem(MEAL_STORAGE_KEY, '{broken')
  render(<App today={TODAY} />)
  expect(await screen.findByRole('alert')).toHaveTextContent('保存データが壊れています')

  const target = section('朝')
  fireEvent.change(within(target).getByRole('textbox', { name: '新しい品名' }), { target: { value: 'ごはん' } })
  fireEvent.click(within(target).getByRole('button', { name: '追加' }))
  await vi.waitFor(() => {
    expect(screen.getByRole('alert')).toHaveTextContent('保存できませんでした')
  })
  expect(window.localStorage.getItem(MEAL_STORAGE_KEY)).toBe('{broken')
})
