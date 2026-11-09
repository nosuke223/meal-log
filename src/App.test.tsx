import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import App from './App'
import { MEAL_STORAGE_KEY, createLocalStorageMealRepository } from './meals/localStorageMealRepository'
import { MealStorageError, type MealRepository } from './meals/mealRepository'

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

type StoredRecord = { id: string; name: string; date: string; status: string; updatedAt: string }

function storedRecords(): StoredRecord[] {
  const data = JSON.parse(window.localStorage.getItem(MEAL_STORAGE_KEY) ?? '{"records":[]}') as {
    records: StoredRecord[]
  }
  return data.records
}

function seed(records: { id: string; date: string; mealType: string; name: string; status: string }[]) {
  const full = records.map((record) => ({
    genre: null,
    dishType: null,
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    ...record,
  }))
  window.localStorage.setItem(MEAL_STORAGE_KEY, JSON.stringify({ version: 1, records: full }))
}

describe('予定と食べた', () => {
  test('今日に追加した品は「予定」になり、1回のタップで「食べた」と「予定」を切り替えられる', async () => {
    render(<App today={TODAY} />)
    await addItem('朝', 'ごはん')
    const morning = within(section('朝'))
    expect(morning.getByRole('button', { name: /ごはん/ })).toHaveTextContent('予定')
    expect(storedRecords().map((record) => record.status)).toEqual(['planned'])

    fireEvent.click(morning.getByRole('button', { name: '食べたにする' }))
    await vi.waitFor(() => {
      expect(morning.getByRole('button', { name: /ごはん/ })).toHaveTextContent('食べた')
    })
    expect(storedRecords().map((record) => record.status)).toEqual(['eaten'])

    fireEvent.click(morning.getByRole('button', { name: '予定に戻す' }))
    await vi.waitFor(() => {
      expect(morning.getByRole('button', { name: /ごはん/ })).toHaveTextContent('予定')
    })
    expect(storedRecords().map((record) => record.status)).toEqual(['planned'])
  })

  test('切り替えのボタンは、どの品のものかが分かる', async () => {
    render(<App today={TODAY} />)
    await addItem('朝', 'ごはん')
    expect(within(section('朝')).getByRole('button', { name: '食べたにする' })).toHaveAccessibleDescription('ごはん')
  })

  test('過去の日に追加した品は「食べた」になり、切り替えのボタンがない', async () => {
    window.history.replaceState(null, '', '/#/day/2026-11-01')
    render(<App today={TODAY} />)
    await addItem('昼', 'うどん')
    const lunch = within(section('昼'))
    expect(lunch.getByRole('button', { name: /うどん/ })).toHaveTextContent('食べた')
    expect(lunch.queryByRole('button', { name: '食べたにする' })).not.toBeInTheDocument()
    expect(lunch.queryByRole('button', { name: '予定に戻す' })).not.toBeInTheDocument()
    expect(storedRecords().map((record) => [record.date, record.status])).toEqual([['2026-11-01', 'eaten']])
  })

  test('明日以降の日に追加した品は「予定」になり、切り替えのボタンがない', async () => {
    window.history.replaceState(null, '', '/#/day/2026-11-07')
    render(<App today={TODAY} />)
    await addItem('夜', '鍋')
    const dinner = within(section('夜'))
    expect(dinner.getByRole('button', { name: /鍋/ })).toHaveTextContent('予定')
    expect(dinner.queryByRole('button', { name: '食べたにする' })).not.toBeInTheDocument()
    expect(storedRecords().map((record) => [record.date, record.status])).toEqual([['2026-11-07', 'planned']])
  })

  test('品の日付を変えると、その日に移り、未来の日は「予定」、過去の日は「食べた」、今日はそのときの状態のままになる', async () => {
    seed([
      { id: 'a', date: TODAY, mealType: 'breakfast', name: 'ごはん', status: 'eaten' },
      { id: 'b', date: TODAY, mealType: 'lunch', name: 'うどん', status: 'planned' },
      { id: 'c', date: '2026-11-03', mealType: 'dinner', name: 'カレー', status: 'eaten' },
      { id: 'd', date: '2026-11-10', mealType: 'dinner', name: '鍋', status: 'planned' },
    ])

    async function changeDate(sectionName: string, name: string, date: string) {
      fireEvent.click(await within(section(sectionName)).findByRole('button', { name: new RegExp(name) }))
      const form = within(within(section(sectionName)).getByRole('form', { name: '品の変更' }))
      fireEvent.change(form.getByLabelText('日付'), { target: { value: date } })
      fireEvent.click(form.getByRole('button', { name: '保存' }))
      await vi.waitFor(() => {
        expect(within(section(sectionName)).queryByText(name)).not.toBeInTheDocument()
      })
    }

    const view = render(<App today={TODAY} />)
    // 今日の「食べた」を未来へ、今日の「予定」を過去へ
    await changeDate('朝', 'ごはん', '2026-11-08')
    await changeDate('昼', 'うどん', '2026-11-02')
    view.unmount()

    // 過去の「食べた」を今日へ（そのまま「食べた」）
    window.history.replaceState(null, '', '/#/day/2026-11-03')
    const past = render(<App today={TODAY} />)
    await changeDate('夜', 'カレー', TODAY)
    past.unmount()

    // 未来の「予定」を今日へ（そのまま「予定」）
    window.history.replaceState(null, '', '/#/day/2026-11-10')
    render(<App today={TODAY} />)
    await changeDate('夜', '鍋', TODAY)

    const byId = new Map(storedRecords().map((record) => [record.id, [record.date, record.status]]))
    expect(byId.get('a')).toEqual(['2026-11-08', 'planned'])
    expect(byId.get('b')).toEqual(['2026-11-02', 'eaten'])
    expect(byId.get('c')).toEqual([TODAY, 'eaten'])
    expect(byId.get('d')).toEqual([TODAY, 'planned'])
  })

  test('日付が空のときは、変更を保存できない', async () => {
    render(<App today={TODAY} />)
    await addItem('朝', 'ごはん')
    fireEvent.click(within(section('朝')).getByRole('button', { name: /ごはん/ }))
    const form = within(within(section('朝')).getByRole('form', { name: '品の変更' }))
    expect(form.getByLabelText('日付')).toHaveValue(TODAY)
    fireEvent.change(form.getByLabelText('日付'), { target: { value: '' } })
    expect(form.getByRole('button', { name: '保存' })).toBeDisabled()
  })
})

describe('日が過ぎた予定', () => {
  test('アプリを開いたとき、過去の日の「予定」を「食べた」にし、更新日時も変える', async () => {
    seed([
      { id: 'past', date: '2026-11-05', mealType: 'dinner', name: 'カレー', status: 'planned' },
      { id: 'today', date: TODAY, mealType: 'breakfast', name: 'ごはん', status: 'planned' },
      { id: 'future', date: '2026-11-07', mealType: 'lunch', name: 'うどん', status: 'planned' },
    ])
    render(<App today={TODAY} />)
    await vi.waitFor(() => {
      expect(storedRecords().find((record) => record.id === 'past')?.status).toBe('eaten')
    })
    const byId = new Map(storedRecords().map((record) => [record.id, record]))
    expect(Date.parse(byId.get('past')!.updatedAt)).toBeGreaterThan(Date.parse('2026-11-01T00:00:00.000Z'))
    expect(byId.get('today')).toMatchObject({ status: 'planned', updatedAt: '2026-11-01T00:00:00.000Z' })
    expect(byId.get('future')).toMatchObject({ status: 'planned', updatedAt: '2026-11-01T00:00:00.000Z' })
  })

  test('過去の日の画面を開いたとき、日が過ぎた予定は「食べた」で表示される', async () => {
    seed([{ id: 'past', date: '2026-11-05', mealType: 'dinner', name: 'カレー', status: 'planned' }])
    window.history.replaceState(null, '', '/#/day/2026-11-05')
    render(<App today={TODAY} />)
    await vi.waitFor(() => {
      expect(within(section('夜')).getByRole('button', { name: /カレー/ })).toHaveTextContent('食べた')
    })
  })

  test('タブや画面に戻ってきたときにも、過去の日の「予定」を「食べた」にする', async () => {
    render(<App today={TODAY} />)
    // 開いた後に、別のタブなどで過去の日の予定が保存された
    seed([{ id: 'past', date: '2026-11-05', mealType: 'dinner', name: 'カレー', status: 'planned' }])

    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await vi.waitFor(() => {
      expect(storedRecords()[0].status).toBe('eaten')
    })

    seed([{ id: 'past2', date: '2026-11-04', mealType: 'dinner', name: '鍋', status: 'planned' }])
    act(() => {
      window.dispatchEvent(new Event('focus'))
    })
    await vi.waitFor(() => {
      expect(storedRecords()[0].status).toBe('eaten')
    })
  })

  test('書き込みだけに失敗したときは、エラーを表示し、次に成功したら消す', async () => {
    seed([{ id: 'past', date: '2026-11-05', mealType: 'dinner', name: 'カレー', status: 'planned' }])
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError')
    })
    render(<App today={TODAY} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('日が過ぎた予定を「食べた」にできませんでした')
    expect(storedRecords()[0].status).toBe('planned')

    setItem.mockRestore()
    act(() => {
      window.dispatchEvent(new Event('focus'))
    })
    await vi.waitFor(() => {
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })
    expect(storedRecords()[0].status).toBe('eaten')
  })

  test('カレンダーの画面でも、書き込みに失敗したときはエラーを表示する', async () => {
    seed([{ id: 'past', date: '2026-11-05', mealType: 'dinner', name: 'カレー', status: 'planned' }])
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError')
    })
    window.history.replaceState(null, '', '/#/calendar/2026-11')
    render(<App today={TODAY} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('日が過ぎた予定を「食べた」にできませんでした')
  })

  test('今日を指定しないとき、日付をまたぐと、前の日の「予定」が「食べた」になる', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
    vi.setSystemTime(new Date(2026, 10, 6, 23, 59, 40))
    render(<App />)
    await addItem('夜', 'カレー')
    expect(storedRecords().map((record) => record.status)).toEqual(['planned'])

    act(() => {
      vi.setSystemTime(new Date(2026, 10, 7, 0, 0, 10))
      vi.advanceTimersByTime(30_000)
    })
    await vi.waitFor(() => {
      expect(storedRecords().map((record) => record.status)).toEqual(['eaten'])
    })
  })
})

describe('保存の後の読み直しだけに失敗したとき', () => {
  const RELOAD_ERROR = 'サーバーに接続できませんでした。通信の状態を確かめてください'

  /**
   * ブラウザ内の窓口を包んだ窓口を作る。failReloadAfterNextSave を呼ぶと、
   * 次の保存の操作（追加・変更・削除）の直後の listByDate を1回だけ失敗させる
   */
  function setUpRepository() {
    const inner = createLocalStorageMealRepository()
    let armed = false
    let failNextList = false
    function afterSave<T>(result: Promise<T>): Promise<T> {
      return result.then((value) => {
        failNextList = armed
        armed = false
        return value
      })
    }
    const repository: MealRepository = {
      ...inner,
      listByDate(date) {
        if (failNextList) {
          failNextList = false
          return Promise.reject(new MealStorageError(RELOAD_ERROR))
        }
        return inner.listByDate(date)
      },
      create: (input) => afterSave(inner.create(input)),
      update: (id, changes) => afterSave(inner.update(id, changes)),
      delete: (id) => afterSave(inner.delete(id)),
    }
    return {
      repository,
      failReloadAfterNextSave() {
        armed = true
      },
    }
  }

  async function expectSavedButNotReloaded() {
    await vi.waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(`保存しました。一覧を読み込めませんでした: ${RELOAD_ERROR}`)
    })
    expect(screen.queryByText(/保存できませんでした/)).not.toBeInTheDocument()
  }

  async function openEditForm(sectionName: string, name: string) {
    fireEvent.click(await within(section(sectionName)).findByRole('button', { name: new RegExp(name) }))
    return within(within(section(sectionName)).getByRole('form', { name: '品の変更' }))
  }

  test('追加: 保存できたことがわかるエラーを表示し、入力欄を空にする。次に読み直せたらエラーが消え、一覧が最新になる', async () => {
    const { repository, failReloadAfterNextSave } = setUpRepository()
    render(<App today={TODAY} repository={repository} />)
    const lunch = within(section('昼'))

    failReloadAfterNextSave()
    fireEvent.change(lunch.getByRole('textbox', { name: '新しい品名' }), { target: { value: 'うどん' } })
    fireEvent.click(lunch.getByRole('button', { name: '追加' }))
    await expectSavedButNotReloaded()
    expect(lunch.getByRole('textbox', { name: '新しい品名' })).toHaveValue('')
    expect(storedRecords().map((record) => record.name)).toEqual(['うどん'])
    // 一覧は前の表示のまま
    expect(lunch.queryByRole('button', { name: /うどん/ })).not.toBeInTheDocument()

    // 次の保存の後は読み直しに成功する
    await addItem('昼', 'そば')
    expect(lunch.getByRole('button', { name: /うどん/ })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(storedRecords().map((record) => record.name)).toEqual(['うどん', 'そば'])
  })

  test('変更: 保存できたことがわかるエラーを表示し、変更の欄を閉じる', async () => {
    seed([{ id: 'a', date: TODAY, mealType: 'breakfast', name: 'ごはん', status: 'planned' }])
    const { repository, failReloadAfterNextSave } = setUpRepository()
    render(<App today={TODAY} repository={repository} />)

    const form = await openEditForm('朝', 'ごはん')
    fireEvent.change(form.getByRole('textbox', { name: '品名' }), { target: { value: 'おにぎり' } })
    failReloadAfterNextSave()
    fireEvent.click(form.getByRole('button', { name: '保存' }))
    await expectSavedButNotReloaded()
    expect(within(section('朝')).queryByRole('form', { name: '品の変更' })).not.toBeInTheDocument()
    expect(storedRecords().map((record) => record.name)).toEqual(['おにぎり'])
  })

  test('削除: 保存できたことがわかるエラーを表示し、変更の欄を閉じる', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    seed([{ id: 'a', date: TODAY, mealType: 'dinner', name: 'カレー', status: 'planned' }])
    const { repository, failReloadAfterNextSave } = setUpRepository()
    render(<App today={TODAY} repository={repository} />)

    const form = await openEditForm('夜', 'カレー')
    failReloadAfterNextSave()
    fireEvent.click(form.getByRole('button', { name: '削除' }))
    await expectSavedButNotReloaded()
    expect(within(section('夜')).queryByRole('form', { name: '品の変更' })).not.toBeInTheDocument()
    expect(storedRecords()).toEqual([])
  })

  test('予定と食べたの切り替え: 保存できたことがわかるエラーを表示する', async () => {
    seed([{ id: 'a', date: TODAY, mealType: 'breakfast', name: 'ごはん', status: 'planned' }])
    const { repository, failReloadAfterNextSave } = setUpRepository()
    render(<App today={TODAY} repository={repository} />)

    const button = await within(section('朝')).findByRole('button', { name: '食べたにする' })
    failReloadAfterNextSave()
    fireEvent.click(button)
    await expectSavedButNotReloaded()
    expect(storedRecords().map((record) => record.status)).toEqual(['eaten'])
  })

  test('追加の保存そのものに失敗したときは、「保存できませんでした」と表示し、入力中の品名を残す', async () => {
    const { repository } = setUpRepository()
    vi.spyOn(repository, 'create').mockRejectedValueOnce(new MealStorageError(RELOAD_ERROR))
    render(<App today={TODAY} repository={repository} />)
    const lunch = within(section('昼'))
    fireEvent.change(lunch.getByRole('textbox', { name: '新しい品名' }), { target: { value: 'うどん' } })
    fireEvent.click(lunch.getByRole('button', { name: '追加' }))

    await vi.waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(`保存できませんでした: ${RELOAD_ERROR}`)
    })
    expect(lunch.getByRole('textbox', { name: '新しい品名' })).toHaveValue('うどん')
    expect(storedRecords()).toEqual([])
  })

  test('変更の保存そのものに失敗したときは、「保存できませんでした」と表示し、変更の欄を残す', async () => {
    seed([{ id: 'a', date: TODAY, mealType: 'breakfast', name: 'ごはん', status: 'planned' }])
    const { repository } = setUpRepository()
    vi.spyOn(repository, 'update').mockRejectedValueOnce(new MealStorageError(RELOAD_ERROR))
    render(<App today={TODAY} repository={repository} />)

    const form = await openEditForm('朝', 'ごはん')
    fireEvent.change(form.getByRole('textbox', { name: '品名' }), { target: { value: 'おにぎり' } })
    fireEvent.click(form.getByRole('button', { name: '保存' }))
    await vi.waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(`保存できませんでした: ${RELOAD_ERROR}`)
    })
    expect(form.getByRole('textbox', { name: '品名' })).toHaveValue('おにぎり')
    expect(storedRecords().map((record) => record.name)).toEqual(['ごはん'])
  })
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
