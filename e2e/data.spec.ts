import { readFile } from 'node:fs/promises'
import type { Page } from '@playwright/test'
import { expect, test, type MealApi, type StoredRecord } from './fixtures'

// スマホの縦画面の大きさ。今日を 2026年11月18日（水）に固定する
test.use({ viewport: { width: 375, height: 667 }, timezoneId: 'Asia/Tokyo' })

const NOW = new Date('2026-11-18T10:00:00+09:00')

function record(overrides: Partial<StoredRecord> & { id: string }): StoredRecord {
  return {
    date: '2026-11-17',
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

async function openWith(page: Page, api: MealApi, records: StoredRecord[], hash = '') {
  await page.clock.setFixedTime(NOW)
  await api.seed(records)
  await page.goto(`/${hash}`)
}

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate<number>(
    'document.documentElement.scrollWidth - document.documentElement.clientWidth',
  )
  expect(overflow).toBeLessThanOrEqual(0)
}

/** 「読み込む」を押して、ファイルを選ぶ */
async function chooseFile(page: Page, file: string | { name: string; mimeType: string; buffer: Buffer }) {
  const chooser = page.waitForEvent('filechooser')
  // 隠したファイル入力欄（「読み込むファイル」）も button として見えるため、完全一致で選ぶ
  await page.getByRole('button', { name: '読み込む', exact: true }).click()
  await (await chooser).setFiles(file)
}

function jsonFile(content: unknown) {
  const text = typeof content === 'string' ? content : JSON.stringify(content)
  return { name: 'meal-log-2026-11-18.json', mimeType: 'application/json', buffer: Buffer.from(text) }
}

const SAMPLE = [
  record({ id: 'a', date: '2026-11-17', mealType: 'dinner', name: '焼き魚', genre: 'japanese' }),
  record({ id: 'b', date: '2026-11-18', mealType: 'lunch', name: 'うどん', genre: 'japanese', status: 'planned' }),
  record({ id: 'c', date: '2026-11-25', mealType: 'dinner', name: '鍋', genre: null, dishType: null, status: 'planned' }),
]

test('「データ」ボタンでデータ画面が開き、読み込み直しても開き、「戻る」で前の画面に戻れる', async ({ page, api }) => {
  await openWith(page, api,[], '#/day/2026-11-10')
  await page.getByRole('button', { name: 'データ' }).click()
  await expect(page).toHaveURL(/#\/data$/)
  await expect(page.getByRole('heading', { name: 'データ' })).toBeVisible()
  await expectNoHorizontalScroll(page)

  await page.reload()
  await expect(page.getByRole('heading', { name: 'データ' })).toBeVisible()

  await page.goBack()
  await expect(page).toHaveURL(/#\/day\/2026-11-10$/)
  await expect(page.getByText('2026年11月10日（火）')).toBeVisible()

  await page.goForward()
  await page.getByRole('button', { name: '記録の画面へ' }).click()
  await expect(page.getByText('2026年11月18日（水）')).toBeVisible()
})

test('書き出したファイルを、空の状態で読み込むと、すべての記録が元のとおりに戻る', async ({ page, api }) => {
  await openWith(page, api,SAMPLE, '#/data')
  const original = await api.records()

  // 書き出し
  const downloading = page.waitForEvent('download')
  await page.getByRole('button', { name: '書き出す' }).click()
  const download = await downloading
  expect(download.suggestedFilename()).toBe('meal-log-2026-11-18.json')
  const path = await download.path()
  const exported = JSON.parse(await readFile(path, 'utf8'))
  expect(exported.version).toBe(1)
  expect(exported.exportedAt).toBe(NOW.toISOString())
  expect(exported.records).toHaveLength(3)
  expect(new Map(exported.records.map((item: StoredRecord) => [item.id, item]))).toEqual(
    new Map(original.map((item) => [item.id, item])),
  )
  await expect(page.getByRole('status')).toHaveText('3件の記録を書き出しました')

  // サーバーの記録を空にして読み込む
  await api.clear()
  await page.reload()
  await chooseFile(page, path)
  const confirm = page.getByRole('group', { name: '取り込みの確認' })
  await expect(confirm).toContainText('追加 3件、更新 0件、変更なし 0件')
  await expectNoHorizontalScroll(page)
  await confirm.getByRole('button', { name: '取り込む' }).click()
  await expect(page.getByRole('status')).toHaveText('取り込みました: 追加 3件、更新 0件、変更なし 0件')
  expect(new Map((await api.records()).map((item) => [item.id, item]))).toEqual(
    new Map(original.map((item) => [item.id, item])),
  )

  // 記録の画面とカレンダーに表示される
  await page.getByRole('button', { name: '記録の画面へ' }).click()
  await expect(page.getByRole('region', { name: '昼', exact: true }).getByRole('button', { name: /うどん/ })).toBeVisible()
  await page.getByRole('button', { name: 'カレンダー' }).click()
  await expect(page.getByRole('table').getByRole('button', { name: '11月17日 和', exact: true })).toBeVisible()
  await expect(page.getByRole('table').getByRole('button', { name: '11月25日 予定あり', exact: true })).toBeVisible()
})

test('今あるデータと混ぜて読み込むと、件数を確認でき、取り消すと何も変わらない', async ({ page, api }) => {
  const existing = [
    record({ id: 'a', name: '今の焼き魚', updatedAt: '2026-11-02T00:00:00.000Z' }),
    record({ id: 'b', name: '今のうどん', updatedAt: '2026-11-02T00:00:00.000Z' }),
    record({ id: 'kept', name: '残る品' }),
  ]
  const file = {
    version: 1,
    exportedAt: '2026-11-18T00:00:00.000Z',
    records: [
      record({ id: 'a', name: '新しい焼き魚', updatedAt: '2026-11-03T00:00:00.000Z' }),
      record({ id: 'b', name: '古いうどん', updatedAt: '2026-11-01T00:00:00.000Z' }),
      record({ id: 'new', date: '2026-11-20', name: '未来の食べた', status: 'eaten' }),
    ],
  }
  await openWith(page, api,existing, '#/data')

  await chooseFile(page, jsonFile(file))
  const confirm = page.getByRole('group', { name: '取り込みの確認' })
  await expect(confirm).toContainText('追加 1件、更新 1件、変更なし 1件')
  await confirm.getByRole('button', { name: '取り消す' }).click()
  await expect(confirm).toHaveCount(0)
  expect(await api.records()).toEqual(existing)

  await chooseFile(page, jsonFile(file))
  await page.getByRole('button', { name: '取り込む' }).click()
  await expect(page.getByRole('status')).toHaveText('取り込みました: 追加 1件、更新 1件、変更なし 1件')
  const byId = new Map((await api.records()).map((item) => [item.id, item]))
  expect(byId.get('a')?.name).toBe('新しい焼き魚')
  expect(byId.get('b')?.name).toBe('今のうどん')
  expect(byId.get('kept')).toEqual(existing[2])
  // 未来の日の「食べた」は「予定」にして取り込む（日時は保つ）
  expect(byId.get('new')).toEqual({ ...file.records[2], status: 'planned' })
})

test('不正なファイルは、何も取り込まず、わかる文言でエラーを表示する', async ({ page, api }) => {
  await openWith(page, api,SAMPLE, '#/data')
  const original = await api.records()
  const cases: [unknown, string][] = [
    ['not json', 'JSON として読めません'],
    [{ version: 2, records: [] }, 'バージョンに対応していません'],
    [{ version: 1 }, '記録の一覧（records）がありません'],
    [{ version: 1, records: [SAMPLE[0], { ...SAMPLE[1], mealType: 'brunch' }] }, '2件目の記録が不正です: 区分が不正です: brunch'],
    [{ version: 1, records: [SAMPLE[0], SAMPLE[1], SAMPLE[0]] }, '3件目の記録の ID が、1件目と同じです: a'],
  ]
  for (const [content, message] of cases) {
    await chooseFile(page, jsonFile(content))
    const alert = page.getByRole('alert')
    await expect(alert).toContainText('読み込めませんでした（何も取り込んでいません）')
    await expect(alert).toContainText(message)
    await expect(page.getByRole('group', { name: '取り込みの確認' })).toHaveCount(0)
  }
  await expectNoHorizontalScroll(page)
  expect(await api.records()).toEqual(original)
})

test('パソコンの画面の大きさでも、データ画面が崩れない', async ({ page, api }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await openWith(page, api,SAMPLE, '#/data')
  await chooseFile(page, jsonFile({ version: 1, records: SAMPLE }))
  await expect(page.getByRole('group', { name: '取り込みの確認' })).toContainText('変更なし 3件')
  await expectNoHorizontalScroll(page)
})
