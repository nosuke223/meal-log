import { expect, test, type Page } from '@playwright/test'

// スマホの縦画面の大きさ。今日を 2026年11月18日（水）に固定する
test.use({ viewport: { width: 375, height: 667 }, timezoneId: 'Asia/Tokyo' })

const NOW = new Date('2026-11-18T10:00:00+09:00')

type Seed = { date: string; mealType: string; name: string; genre: string | null; status: string }

const SEEDS: Seed[] = [
  { date: '2026-11-03', mealType: 'breakfast', name: 'ごはん', genre: 'japanese', status: 'eaten' },
  { date: '2026-11-03', mealType: 'lunch', name: 'ラーメン', genre: 'chinese', status: 'eaten' },
  { date: '2026-11-03', mealType: 'dinner', name: '餃子', genre: 'chinese', status: 'eaten' },
  { date: '2026-11-05', mealType: 'dinner', name: 'パスタ', genre: 'western', status: 'planned' },
  { date: '2026-11-10', mealType: 'dinner', name: 'カレー', genre: null, status: 'eaten' },
  { date: '2026-10-31', mealType: 'lunch', name: 'ピザ', genre: 'western', status: 'eaten' },
]

function storedData(seeds: Seed[]): string {
  const records = seeds.map((seed, index) => ({
    id: `seed-${index}`,
    dishType: null,
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    ...seed,
  }))
  return JSON.stringify({ version: 1, records })
}

function calendar(page: Page) {
  return page.getByRole('table')
}

function day(page: Page, name: string) {
  return calendar(page).getByRole('button', { name, exact: true })
}

function section(page: Page, name: string) {
  return page.getByRole('region', { name, exact: true })
}

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate<number>(
    'document.documentElement.scrollWidth - document.documentElement.clientWidth',
  )
  expect(overflow).toBeLessThanOrEqual(0)
}

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(NOW)
  await page.goto('/')
  await page.evaluate(`window.localStorage.setItem('meal-log:meals', ${JSON.stringify(storedData(SEEDS))})`)
  await page.reload()
})

test('最初は今日の記録の画面で、ボタンでカレンダーを開き、月を移れる', async ({ page }) => {
  await expect(page.getByText('2026年11月18日（水）')).toBeVisible()
  await page.getByRole('button', { name: 'カレンダー' }).click()

  await expect(page.getByRole('heading', { name: '2026年11月' })).toBeVisible()
  await expect(day(page, '11月18日')).toHaveAttribute('aria-current', 'date')
  await expectNoHorizontalScroll(page)

  await page.getByRole('button', { name: '前の月' }).click()
  await expect(page.getByRole('heading', { name: '2026年10月' })).toBeVisible()
  await page.getByRole('button', { name: '次の月' }).click()
  await page.getByRole('button', { name: '次の月' }).click()
  await expect(page.getByRole('heading', { name: '2026年12月' })).toBeVisible()
  await page.getByRole('button', { name: '今月' }).click()
  await expect(page.getByRole('heading', { name: '2026年11月' })).toBeVisible()
})

test('記録がある日にジャンルの点が1つずつ付き、予定は数えず、凡例があり、未来の日は選べない', async ({ page }) => {
  await page.goto('/#/calendar/2026-11')
  const marked = day(page, '11月3日 和・中')
  await expect(marked).toBeVisible()
  await expect(marked).toContainText('和中')
  await expect(day(page, '11月10日 未設定')).toContainText('未')
  // 予定だけの日と記録のない日には点がない
  await expect(day(page, '11月5日')).toHaveText('5')
  await expect(day(page, '11月4日')).toHaveText('4')

  const legend = page.getByRole('region', { name: '点の凡例' })
  // 点の文字と名前
  await expect(legend.getByRole('listitem')).toHaveText(['和和', '洋洋', '中中', '他その他', '未未設定'])

  await expect(day(page, '11月19日')).toBeDisabled()
  await expect(day(page, '11月18日')).toBeEnabled()
  await expectNoHorizontalScroll(page)
})

test('過去の日を開いて品を追加・変更・削除でき、読み込み直しても同じ日が開き、「戻る」で点が更新されたカレンダーに戻る', async ({ page }) => {
  await page.goto('/#/calendar/2026-11')
  await day(page, '11月3日 和・中').click()

  await expect(page).toHaveURL(/#\/day\/2026-11-03$/)
  await expect(page.getByText('2026年11月3日（火）')).toBeVisible()
  await expect(section(page, '昼').getByRole('button', { name: /ラーメン/ })).toBeVisible()

  await page.reload()
  await expect(page.getByText('2026年11月3日（火）')).toBeVisible()

  // 追加（ジャンルは洋）
  const snack = section(page, '間食')
  await snack.getByRole('group', { name: 'ジャンル' }).getByRole('button', { name: '洋' }).click()
  await snack.getByRole('textbox', { name: '新しい品名' }).fill('ケーキ')
  await snack.getByRole('button', { name: '追加', exact: true }).click()
  await expect(snack.getByRole('button', { name: /ケーキ/ })).toContainText('洋')

  // 変更（朝のごはんを未設定にする）
  const morning = section(page, '朝')
  await morning.getByRole('button', { name: /ごはん/ }).click()
  const editForm = morning.getByRole('form', { name: '品の変更' })
  await editForm.getByRole('group', { name: 'ジャンル' }).getByRole('button', { name: '和' }).click()
  await editForm.getByRole('button', { name: '保存' }).click()
  await expect(morning.getByRole('button', { name: /ごはん/ })).not.toContainText('和')

  // 削除（中華を2品とも消す）
  for (const [sectionName, name] of [['昼', 'ラーメン'], ['夜', '餃子']]) {
    const target = section(page, sectionName)
    await target.getByRole('button', { name: new RegExp(name) }).click()
    page.once('dialog', (dialog) => dialog.accept())
    await target.getByRole('button', { name: '削除' }).click()
    await expect(target.getByText(name)).toHaveCount(0)
  }
  await expectNoHorizontalScroll(page)

  await page.goBack()
  await expect(page.getByRole('heading', { name: '2026年11月' })).toBeVisible()
  await expect(day(page, '11月3日 洋・未設定')).toBeVisible()
})

test('前の月の日を開いて「戻る」と、その月のカレンダーに戻る', async ({ page }) => {
  await page.getByRole('button', { name: 'カレンダー' }).click()
  await page.getByRole('button', { name: '前の月' }).click()
  await day(page, '10月31日 洋').click()
  await expect(section(page, '昼').getByRole('button', { name: /ピザ/ })).toBeVisible()

  await page.goBack()
  await expect(page.getByRole('heading', { name: '2026年10月' })).toBeVisible()
})

test('アドレスの日付が不正なときや未来の日のときは、今日の記録の画面が開く', async ({ page }) => {
  for (const hash of ['#/day/2026-02-30', '#/day/abc', '#/day/2026-11-19']) {
    await page.goto(`/${hash}`)
    await page.reload()
    await expect(page.getByText('2026年11月18日（水）')).toBeVisible()
  }
})

test('パソコンの画面の大きさでも、カレンダーが崩れない', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/#/calendar/2026-11')
  await expect(day(page, '11月3日 和・中')).toBeVisible()
  await expectNoHorizontalScroll(page)
})
