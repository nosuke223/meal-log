import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import App from '../App'
import { MEAL_STORAGE_KEY } from '../meals/localStorageMealRepository'
import type { MealRecord } from '../meals/mealRecord'

const TODAY = '2026-11-06'

function record(overrides: Partial<MealRecord> = {}): MealRecord {
  return {
    id: 'a',
    date: '2026-11-05',
    mealType: 'dinner',
    name: 'カレー',
    genre: 'other',
    dishType: 'main',
    status: 'eaten',
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    ...overrides,
  }
}

function seed(records: MealRecord[]) {
  window.localStorage.setItem(MEAL_STORAGE_KEY, JSON.stringify({ version: 1, records }))
}

function storedRecords(): MealRecord[] {
  return (JSON.parse(window.localStorage.getItem(MEAL_STORAGE_KEY) ?? '{"records":[]}') as { records: MealRecord[] })
    .records
}

function fileOf(content: unknown, name = 'meal-log-2026-11-06.json'): File {
  return new File([typeof content === 'string' ? content : JSON.stringify(content)], name, { type: 'application/json' })
}

function openDataScreen() {
  window.history.replaceState(null, '', '/#/data')
  render(<App today={TODAY} />)
}

function selectFile(file: File) {
  fireEvent.change(screen.getByLabelText('読み込むファイル'), { target: { files: [file] } })
}

type Download = { fileName: string; blob: Blob }

/** ダウンロードを横取りする。jsdom には URL.createObjectURL がないので足す */
function captureDownloads(): Download[] {
  const downloads: Download[] = []
  const blobs = new Map<string, Blob>()
  URL.createObjectURL = (blob: Blob) => {
    const url = `blob:test/${blobs.size}`
    blobs.set(url, blob)
    return url
  }
  URL.revokeObjectURL = () => {}
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    downloads.push({ fileName: this.download, blob: blobs.get(this.href)! })
  })
  return downloads
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 10, 6, 9, 30))
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

test('記録の画面の「データ」ボタンでデータ画面が開き、「記録の画面へ」で戻れる', async () => {
  render(<App today={TODAY} />)
  fireEvent.click(screen.getByRole('button', { name: 'データ' }))
  expect(window.location.hash).toBe('#/data')
  expect(screen.getByRole('heading', { name: 'データ' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '書き出す' })).toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: '記録の画面へ' }))
  expect(window.location.hash).toBe('#/')
  expect(screen.getByText('2026年11月6日（金）')).toBeInTheDocument()
})

test('アドレスが #/data なら、データ画面が開く', () => {
  openDataScreen()
  expect(screen.getByRole('heading', { name: 'データ' })).toBeInTheDocument()
})

describe('書き出し', () => {
  test('すべての記録を、ID と日時を含めて meal-log-YYYY-MM-DD.json に書き出す', async () => {
    const downloads = captureDownloads()
    const records = [record({ id: 'b', date: '2026-12-01', status: 'planned' }), record()]
    seed(records)
    openDataScreen()

    fireEvent.click(screen.getByRole('button', { name: '書き出す' }))
    expect(await screen.findByRole('status')).toHaveTextContent('2件の記録を書き出しました')
    expect(downloads).toHaveLength(1)
    expect(downloads[0].fileName).toBe('meal-log-2026-11-06.json')
    expect(JSON.parse(await downloads[0].blob.text())).toEqual({
      version: 1,
      exportedAt: new Date(2026, 10, 6, 9, 30).toISOString(),
      records: [record(), record({ id: 'b', date: '2026-12-01', status: 'planned' })],
    })
  })

  test('0件でも書き出せる', async () => {
    const downloads = captureDownloads()
    openDataScreen()
    fireEvent.click(screen.getByRole('button', { name: '書き出す' }))
    expect(await screen.findByRole('status')).toHaveTextContent('0件の記録を書き出しました')
    expect(JSON.parse(await downloads[0].blob.text()).records).toEqual([])
  })

  test('保存データが壊れているときは、エラーを表示する', async () => {
    captureDownloads()
    window.localStorage.setItem(MEAL_STORAGE_KEY, '{broken')
    openDataScreen()
    fireEvent.click(screen.getByRole('button', { name: '書き出す' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('書き出せませんでした')
  })
})

describe('読み込み', () => {
  const file = {
    version: 1,
    exportedAt: '2026-11-06T00:00:00.000Z',
    records: [
      record({ id: 'new', name: '新しい品' }),
      record({ id: 'newer', name: 'ファイルの方が新しい', updatedAt: '2026-11-03T00:00:00.000Z' }),
      record({ id: 'older', name: 'ファイルの方が古い', updatedAt: '2026-11-01T00:00:00.000Z' }),
    ],
  }
  const existing = [
    record({ id: 'newer', name: '今の品', updatedAt: '2026-11-02T00:00:00.000Z' }),
    record({ id: 'older', name: '今の品', updatedAt: '2026-11-02T00:00:00.000Z' }),
    record({ id: 'kept', name: '残る品' }),
  ]

  test('件数を表示して確認を取り、取り込むと規則どおりに混ぜて、結果を表示する', async () => {
    seed(existing)
    openDataScreen()
    selectFile(fileOf(file))

    const confirm = await screen.findByRole('group', { name: '取り込みの確認' })
    expect(confirm).toHaveTextContent('追加 1件、更新 1件、変更なし 1件。取り込みますか？')
    expect(storedRecords()).toEqual(existing)

    fireEvent.click(within(confirm).getByRole('button', { name: '取り込む' }))
    expect(await screen.findByRole('status')).toHaveTextContent('取り込みました: 追加 1件、更新 1件、変更なし 1件')
    const byId = new Map(storedRecords().map((stored) => [stored.id, stored]))
    expect(byId.size).toBe(4)
    expect(byId.get('new')).toEqual(file.records[0])
    expect(byId.get('newer')).toEqual(file.records[1])
    expect(byId.get('older')).toEqual(existing[1])
    expect(byId.get('kept')).toEqual(existing[2])
  })

  test('確認で取り消すと、何も変わらない', async () => {
    seed(existing)
    openDataScreen()
    selectFile(fileOf(file))
    const confirm = await screen.findByRole('group', { name: '取り込みの確認' })
    fireEvent.click(within(confirm).getByRole('button', { name: '取り消す' }))

    expect(screen.getByRole('status')).toHaveTextContent('取り込みを取り消しました')
    expect(screen.queryByRole('group', { name: '取り込みの確認' })).not.toBeInTheDocument()
    expect(storedRecords()).toEqual(existing)
  })

  test('取り込む記録の状態を、日付の決まりに合わせて直す（ID と日時は保つ）', async () => {
    openDataScreen()
    selectFile(
      fileOf({
        version: 1,
        records: [
          record({ id: 'future', date: '2026-11-07', status: 'eaten' }),
          record({ id: 'past', date: '2026-11-05', status: 'planned' }),
        ],
      }),
    )
    fireEvent.click(await screen.findByRole('button', { name: '取り込む' }))
    await screen.findByRole('status')
    expect(storedRecords()).toEqual([
      record({ id: 'future', date: '2026-11-07', status: 'planned' }),
      record({ id: 'past', date: '2026-11-05', status: 'eaten' }),
    ])
  })

  test.each([
    ['JSON でない', '{broken', 'JSON として読めません'],
    ['バージョンが違う', { version: 2, records: [] }, 'バージョンに対応していません'],
    ['records がない', { version: 1 }, '記録の一覧（records）がありません'],
    ['1件が不正', { version: 1, records: [record(), record({ id: 'b', name: '' })] }, '2件目の記録が不正です: 品名を入力してください'],
    ['ID が重なっている', { version: 1, records: [record(), record()] }, '2件目の記録の ID が、1件目と同じです: a'],
  ])('不正なファイル（%s）は、何も取り込まず、エラーを表示する', async (_, content, message) => {
    seed(existing)
    openDataScreen()
    selectFile(fileOf(content))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('読み込めませんでした（何も取り込んでいません）')
    expect(alert).toHaveTextContent(message)
    expect(screen.queryByRole('group', { name: '取り込みの確認' })).not.toBeInTheDocument()
    expect(storedRecords()).toEqual(existing)
  })

  test('保存に失敗したときは、データを元のままにして、エラーを表示する', async () => {
    seed(existing)
    const before = window.localStorage.getItem(MEAL_STORAGE_KEY)
    openDataScreen()
    selectFile(fileOf(file))
    const confirm = await screen.findByRole('group', { name: '取り込みの確認' })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError')
    })
    fireEvent.click(within(confirm).getByRole('button', { name: '取り込む' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('取り込めませんでした（データは元のままです）')
    expect(window.localStorage.getItem(MEAL_STORAGE_KEY)).toBe(before)
  })

  test('取り込んだ後、記録の画面に取り込んだ記録が表示される', async () => {
    openDataScreen()
    selectFile(fileOf({ version: 1, records: [record({ id: 'x', date: TODAY, mealType: 'lunch', name: 'うどん' })] }))
    fireEvent.click(await screen.findByRole('button', { name: '取り込む' }))
    await screen.findByRole('status')

    fireEvent.click(screen.getByRole('button', { name: '記録の画面へ' }))
    expect(
      await within(screen.getByRole('region', { name: '昼' })).findByRole('button', { name: /うどん/ }),
    ).toBeInTheDocument()
  })
})
