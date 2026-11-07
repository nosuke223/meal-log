import { expect, test, type Page } from '@playwright/test'

// スマホの縦画面の大きさ。今日を 2026年11月18日（水）に固定する
test.use({ viewport: { width: 375, height: 667 }, timezoneId: 'Asia/Tokyo' })

const NOW = new Date('2026-11-18T10:00:00+09:00')

type Seed = { id: string; date: string; mealType: string; name: string; genre: string | null; status: string }

const OLD_TIMESTAMP = '2026-11-01T00:00:00.000Z'

function storedData(seeds: Seed[]): string {
  const records = seeds.map((seed) => ({
    dishType: null,
    createdAt: OLD_TIMESTAMP,
    updatedAt: OLD_TIMESTAMP,
    ...seed,
  }))
  return JSON.stringify({ version: 1, records })
}

type StoredRecord = Seed & { updatedAt: string }

async function storedRecords(page: Page): Promise<StoredRecord[]> {
  const raw = await page.evaluate<string | null>(`window.localStorage.getItem('meal-log:meals')`)
  return (JSON.parse(raw ?? '{"records":[]}') as { records: StoredRecord[] }).records
}

function section(page: Page, name: string) {
  return page.getByRole('region', { name, exact: true })
}

function day(page: Page, name: string) {
  return page.getByRole('table').getByRole('button', { name, exact: true })
}

async function addItem(page: Page, sectionName: string, name: string) {
  const target = section(page, sectionName)
  await target.getByRole('textbox', { name: '新しい品名' }).fill(name)
  await target.getByRole('button', { name: '追加', exact: true }).click()
  await expect(target.getByRole('button', { name: new RegExp(name) })).toBeVisible()
}

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate<number>(
    'document.documentElement.scrollWidth - document.documentElement.clientWidth',
  )
  expect(overflow).toBeLessThanOrEqual(0)
}

async function openWith(page: Page, seeds: Seed[], hash = '') {
  await page.clock.setFixedTime(NOW)
  await page.goto('/')
  await page.evaluate(`window.localStorage.setItem('meal-log:meals', ${JSON.stringify(storedData(seeds))})`)
  await page.goto(`/${hash}`)
  await page.reload()
}

test('今日に追加した品は「予定」になり、1回のタップで「食べた」と切り替えられる', async ({ page }) => {
  await openWith(page, [])
  await addItem(page, '朝', 'ごはん')
  const morning = section(page, '朝')
  const item = morning.getByRole('button', { name: /ごはん/ })
  await expect(item).toContainText('予定')
  await expectNoHorizontalScroll(page)

  await morning.getByRole('button', { name: '食べたにする' }).click()
  await expect(item).toContainText('食べた')
  await expect(item).not.toContainText('予定')
  await expect(morning.getByRole('button', { name: '予定に戻す' })).toBeVisible()

  await page.reload()
  await expect(section(page, '朝').getByRole('button', { name: /ごはん/ })).toContainText('食べた')
  await section(page, '朝').getByRole('button', { name: '予定に戻す' }).click()
  await expect(section(page, '朝').getByRole('button', { name: /ごはん/ })).toContainText('予定')
  expect((await storedRecords(page)).map((record) => record.status)).toEqual(['planned'])
})

test('過去の日に追加した品は「食べた」になり、切り替えのボタンがない', async ({ page }) => {
  await openWith(page, [], '#/day/2026-11-10')
  await addItem(page, '昼', 'うどん')
  const lunch = section(page, '昼')
  await expect(lunch.getByRole('button', { name: /うどん/ })).toContainText('食べた')
  await expect(lunch.getByRole('button', { name: '食べたにする' })).toHaveCount(0)
  await expect(lunch.getByRole('button', { name: '予定に戻す' })).toHaveCount(0)
})

test('カレンダーで明日以降の日を選び、予定を追加・変更・削除でき、予定の印が付く', async ({ page }) => {
  await openWith(page, [], '#/calendar/2026-11')
  await page.getByRole('button', { name: '次の月' }).click()
  await day(page, '12月24日').click()
  await expect(page.getByRole('region', { name: '選んだ日の品' })).toContainText('記録はありません')
  await page.getByRole('button', { name: 'この日の記録を開く' }).click()
  await expect(page).toHaveURL(/#\/day\/2026-12-24$/)
  await expect(page.getByText('2026年12月24日（木）')).toBeVisible()

  // 追加
  const dinner = section(page, '夜')
  await dinner.getByRole('group', { name: 'ジャンル' }).getByRole('button', { name: '洋' }).click()
  await addItem(page, '夜', 'チキン')
  await expect(dinner.getByRole('button', { name: /チキン/ })).toContainText('予定')
  await expect(dinner.getByRole('button', { name: '食べたにする' })).toHaveCount(0)
  await addItem(page, '夜', 'ケーキ')
  await expectNoHorizontalScroll(page)

  // 変更
  await dinner.getByRole('button', { name: /チキン/ }).click()
  const editForm = dinner.getByRole('form', { name: '品の変更' })
  await editForm.getByRole('textbox', { name: '品名' }).fill('ローストチキン')
  await expectNoHorizontalScroll(page)
  await editForm.getByRole('button', { name: '保存' }).click()
  await expect(dinner.getByRole('button', { name: /ローストチキン/ })).toContainText('予定')

  // 削除
  await dinner.getByRole('button', { name: /ケーキ/ }).click()
  page.once('dialog', (dialog) => dialog.accept())
  await dinner.getByRole('button', { name: '削除' }).click()
  await expect(dinner.getByText('ケーキ')).toHaveCount(0)

  // カレンダーには、ジャンルの点ではなく予定の印が付く
  await page.goBack()
  await expect(page.getByRole('heading', { name: '2026年12月', exact: true })).toBeVisible()
  const marked = day(page, '12月24日 予定あり')
  await expect(marked).toBeVisible()
  await expect(marked).toHaveText('24')
  await expect(marked.locator('.planned-mark')).toBeVisible()
  // 一覧には予定の品も出る
  await expect(page.getByRole('region', { name: '選んだ日の品' }).getByRole('listitem')).toHaveText(['○予定ローストチキン洋'])
  await expectNoHorizontalScroll(page)
})

test('今日の予定は予定の印だけで、「食べた」にするとジャンルの点に変わる', async ({ page }) => {
  await openWith(page, [
    { id: 'a', date: '2026-11-18', mealType: 'dinner', name: '麻婆豆腐', genre: 'chinese', status: 'planned' },
  ])
  await page.getByRole('button', { name: 'カレンダー' }).click()
  await expect(day(page, '11月18日 予定あり')).toHaveText('18')

  await day(page, '11月18日 予定あり').click()
  await section(page, '夜').getByRole('button', { name: '食べたにする' }).click()
  await expect(section(page, '夜').getByRole('button', { name: /麻婆豆腐/ })).toContainText('食べた')
  await page.getByRole('button', { name: 'カレンダー' }).click()
  await expect(day(page, '11月18日 中')).toHaveText('18中')
})

test('品の日付を変えると、未来の日では「予定」、過去の日では「食べた」になる', async ({ page }) => {
  await openWith(page, [
    { id: 'a', date: '2026-11-18', mealType: 'lunch', name: 'うどん', genre: 'japanese', status: 'eaten' },
    { id: 'b', date: '2026-11-18', mealType: 'dinner', name: 'カレー', genre: null, status: 'planned' },
  ])

  // 今日の「食べた」を、明日に延期する
  const lunch = section(page, '昼')
  await lunch.getByRole('button', { name: /うどん/ }).click()
  await lunch.getByRole('form', { name: '品の変更' }).getByLabel('日付').fill('2026-11-19')
  await lunch.getByRole('form', { name: '品の変更' }).getByRole('button', { name: '保存' }).click()
  await expect(lunch.getByText('うどん')).toHaveCount(0)

  // 今日の「予定」を、過去の日に直す
  const dinner = section(page, '夜')
  await dinner.getByRole('button', { name: /カレー/ }).click()
  await dinner.getByRole('form', { name: '品の変更' }).getByLabel('日付').fill('2026-11-15')
  await dinner.getByRole('form', { name: '品の変更' }).getByRole('button', { name: '保存' }).click()
  await expect(dinner.getByText('カレー')).toHaveCount(0)

  await page.goto('/#/day/2026-11-19')
  await expect(section(page, '昼').getByRole('button', { name: /うどん/ })).toContainText('予定')
  await page.goto('/#/day/2026-11-15')
  await expect(section(page, '夜').getByRole('button', { name: /カレー/ })).toContainText('食べた')

  await page.goto('/#/calendar/2026-11')
  await expect(day(page, '11月19日 予定あり')).toBeVisible()
  await expect(day(page, '11月15日 未設定')).toBeVisible()
})

test('アプリを開いたとき、保存されている過去の日の「予定」が「食べた」になる（更新日時も変わる）', async ({ page }) => {
  await openWith(page, [
    { id: 'past', date: '2026-11-17', mealType: 'dinner', name: '焼き魚', genre: 'japanese', status: 'planned' },
    { id: 'today', date: '2026-11-18', mealType: 'breakfast', name: 'パン', genre: 'western', status: 'planned' },
  ])
  await expect(page.getByText('2026年11月18日（水）')).toBeVisible()
  await expect.poll(async () => (await storedRecords(page)).find((record) => record.id === 'past')?.status).toBe('eaten')

  const byId = new Map((await storedRecords(page)).map((record) => [record.id, record]))
  expect(byId.get('past')?.updatedAt).not.toBe(OLD_TIMESTAMP)
  expect(byId.get('today')).toMatchObject({ status: 'planned', updatedAt: OLD_TIMESTAMP })

  await page.getByRole('button', { name: 'カレンダー' }).click()
  await expect(day(page, '11月17日 和')).toHaveText('17和')
  await expect(day(page, '11月18日 予定あり')).toBeVisible()
})

test('パソコンの画面の大きさでも、予定の品と編集の画面が崩れない', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await openWith(page, [
    { id: 'a', date: '2026-11-18', mealType: 'lunch', name: 'うどん', genre: 'japanese', status: 'planned' },
  ])
  await expect(section(page, '昼').getByRole('button', { name: '食べたにする' })).toBeVisible()
  await section(page, '昼').getByRole('button', { name: /うどん/ }).click()
  await expect(section(page, '昼').getByLabel('日付')).toBeVisible()
  await expectNoHorizontalScroll(page)
})
