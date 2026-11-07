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

/** カレンダーの下の、選んだ日の品の一覧 */
function preview(page: Page) {
  return page.getByRole('region', { name: '選んだ日の品' })
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

  await expect(page.getByRole('heading', { name: '2026年11月', exact: true })).toBeVisible()
  await expect(day(page, '11月18日')).toHaveAttribute('aria-current', 'date')
  // 今日の画面から開くと、今日を選んでいる
  await expect(page).toHaveURL(/#\/calendar\/2026-11-18$/)
  await expect(day(page, '11月18日')).toHaveAttribute('aria-pressed', 'true')
  await expect(preview(page).getByRole('heading', { name: '2026年11月18日（水）' })).toBeVisible()
  await expectNoHorizontalScroll(page)

  // ほかの月は何も選ばない
  await page.getByRole('button', { name: '前の月' }).click()
  await expect(page.getByRole('heading', { name: '2026年10月', exact: true })).toBeVisible()
  await expect(page).toHaveURL(/#\/calendar\/2026-10$/)
  await expect(preview(page)).toHaveText('日付を選ぶと、その日の品が表示されます')
  await expect(calendar(page).getByRole('button', { pressed: true })).toHaveCount(0)
  await page.getByRole('button', { name: '次の月' }).click()
  await page.getByRole('button', { name: '次の月' }).click()
  await expect(page.getByRole('heading', { name: '2026年12月', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '今月' }).click()
  await expect(page.getByRole('heading', { name: '2026年11月', exact: true })).toBeVisible()
  await expect(day(page, '11月18日')).toHaveAttribute('aria-pressed', 'true')
})

test('日のマスをタップすると、画面を移らずにその日の品が区分ごとに表示され、スクロールせずに見える', async ({ page }) => {
  await page.goto('/#/calendar/2026-11')
  const length = await page.evaluate<number>('history.length')
  await day(page, '11月3日 和・中').click()

  await expect(page).toHaveURL(/#\/calendar\/2026-11-03$/)
  await expect(page.getByRole('heading', { name: '2026年11月', exact: true })).toBeVisible()
  await expect(day(page, '11月3日 和・中')).toHaveAttribute('aria-pressed', 'true')
  await expect(day(page, '11月18日')).toHaveAttribute('aria-pressed', 'false')
  // 選んだ日は、今日（青の枠と背景）とは別に、内側の枠で示す
  await expect(day(page, '11月3日 和・中')).toHaveCSS('box-shadow', /inset/)
  await expect(day(page, '11月18日')).toHaveCSS('box-shadow', 'none')

  const list = preview(page)
  await expect(list.getByRole('heading', { name: '2026年11月3日（火）' })).toBeVisible()
  await expect(list.getByRole('heading', { level: 3 })).toHaveText(['朝', '昼', '夜'])
  await expect(list.getByRole('listitem')).toHaveText(['✓食べたごはん和', '✓食べたラーメン中', '✓食べた餃子中'])
  // 3品の一覧が、スマホの縦画面で下にスクロールせずに見える
  await expect(list.getByRole('listitem').last()).toBeInViewport()
  await expect(list.getByRole('button', { name: 'この日の記録を開く' })).toBeInViewport()
  await expectNoHorizontalScroll(page)

  // 別の日を選び直しても、履歴は増えない
  await day(page, '11月4日').click()
  await expect(list.getByRole('heading', { name: '2026年11月4日（水）' })).toBeVisible()
  await expect(list.getByText('記録はありません')).toBeVisible()
  await expect(list.getByRole('listitem')).toHaveCount(0)
  expect(await page.evaluate<number>('history.length')).toBe(length)

  // 読み込み直しても、同じ日を選んでいる
  await page.reload()
  await expect(day(page, '11月4日')).toHaveAttribute('aria-pressed', 'true')
  await expect(list.getByRole('heading', { name: '2026年11月4日（水）' })).toBeVisible()
})

test('日が過ぎた予定は、一覧でも「食べた」になる。明日以降の予定は「予定」のまま', async ({ page }) => {
  await page.goto('/#/calendar/2026-11-05')
  await expect(preview(page).getByRole('listitem')).toHaveText(['✓食べたパスタ洋'])

  await page.evaluate(
    `window.localStorage.setItem('meal-log:meals', ${JSON.stringify(
      storedData([{ date: '2026-11-20', mealType: 'dinner', name: '鍋', genre: 'japanese', status: 'planned' }]),
    )})`,
  )
  await page.goto('/#/calendar/2026-11-20')
  await page.reload()
  await expect(preview(page).getByRole('listitem')).toHaveText(['○予定鍋和'])
})

test('実在しない日付のアドレスでは、今月のカレンダーが今日を選んだ状態で開く', async ({ page }) => {
  await page.goto('/#/calendar/2026-02-30')
  await page.reload()
  await expect(page.getByRole('heading', { name: '2026年11月', exact: true })).toBeVisible()
  await expect(day(page, '11月18日')).toHaveAttribute('aria-pressed', 'true')
})

test('記録の画面の「カレンダー」ボタンは、その日を選んだカレンダーを開く', async ({ page }) => {
  await page.goto('/#/day/2026-10-31')
  await page.reload()
  await page.getByRole('button', { name: 'カレンダー' }).click()
  await expect(page).toHaveURL(/#\/calendar\/2026-10-31$/)
  await expect(day(page, '10月31日 洋')).toHaveAttribute('aria-pressed', 'true')
  await expect(preview(page).getByRole('listitem')).toHaveText(['✓食べたピザ洋'])
})

test('記録がある日にジャンルの点が1つずつ付き、凡例があり、明日以降の日も選べる', async ({ page }) => {
  await page.goto('/#/calendar/2026-11')
  const marked = day(page, '11月3日 和・中')
  await expect(marked).toBeVisible()
  await expect(marked).toContainText('和中')
  await expect(day(page, '11月10日 未設定')).toContainText('未')
  // 記録のない日には点がない
  await expect(day(page, '11月4日')).toHaveText('4')

  const legend = page.getByRole('region', { name: '点の凡例' })
  // 点の文字と名前。予定の印は文字のない形だけ
  await expect(legend.getByRole('listitem')).toHaveText(['和和', '洋洋', '中中', '他その他', '未未設定', '予定あり'])

  await expect(day(page, '11月19日')).toBeEnabled()
  await expect(day(page, '11月18日')).toBeEnabled()
  await expectNoHorizontalScroll(page)
})

test('開いたとき、過去の日の予定は「食べた」になり、予定の印ではなくジャンルの点が付く', async ({ page }) => {
  await page.goto('/#/calendar/2026-11')
  // 11月5日のパスタ（洋）は予定として保存されていた
  const passed = day(page, '11月5日 洋')
  await expect(passed).toBeVisible()
  await expect(passed).toHaveText('5洋')
  await expect(passed.locator('.planned-mark')).toHaveCount(0)
})

test('一覧のボタンで過去の日を開いて品を追加・変更・削除でき、読み込み直しても同じ日が開き、「戻る」で点と一覧が更新されたカレンダーに戻る', async ({ page }) => {
  await page.goto('/#/calendar/2026-11')
  await day(page, '11月3日 和・中').click()
  await preview(page).getByRole('button', { name: 'この日の記録を開く' }).click()

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
  await expect(page).toHaveURL(/#\/calendar\/2026-11-03$/)
  await expect(page.getByRole('heading', { name: '2026年11月', exact: true })).toBeVisible()
  await expect(day(page, '11月3日 洋・未設定')).toHaveAttribute('aria-pressed', 'true')
  await expect(preview(page).getByRole('heading', { level: 3 })).toHaveText(['朝', '間食'])
  await expect(preview(page).getByRole('listitem')).toHaveText(['✓食べたごはん', '✓食べたケーキ洋'])
})

test('前の月の日を2回タップして開き、「戻る」と、その日を選んだその月のカレンダーに戻る', async ({ page }) => {
  await page.getByRole('button', { name: 'カレンダー' }).click()
  await page.getByRole('button', { name: '前の月' }).click()
  await day(page, '10月31日 洋').click()
  await expect(day(page, '10月31日 洋')).toHaveAttribute('aria-pressed', 'true')
  await day(page, '10月31日 洋').click()
  await expect(page).toHaveURL(/#\/day\/2026-10-31$/)
  await expect(section(page, '昼').getByRole('button', { name: /ピザ/ })).toBeVisible()

  await page.goBack()
  await expect(page.getByRole('heading', { name: '2026年10月', exact: true })).toBeVisible()
  await expect(day(page, '10月31日 洋')).toHaveAttribute('aria-pressed', 'true')
  await expect(preview(page).getByRole('listitem')).toHaveText(['✓食べたピザ洋'])
})

test('カレンダーのアドレスを直接開いた状態から、「今日」ボタンで今日の記録の画面に戻れる', async ({ page }) => {
  await page.goto('/#/calendar/2026-10')
  await page.reload()
  await expect(page.getByRole('heading', { name: '2026年10月', exact: true })).toBeVisible()
  await expectNoHorizontalScroll(page)

  await page.getByRole('button', { name: '今日', exact: true }).click()
  await expect(page).toHaveURL(/#\/$/)
  await expect(page.getByText('2026年11月18日（水）')).toBeVisible()
  await expectNoHorizontalScroll(page)

  // 履歴を増やすので、「戻る」でカレンダーに戻る
  await page.goBack()
  await expect(page.getByRole('heading', { name: '2026年10月', exact: true })).toBeVisible()
})

test('今日は、選んでいるマスのタップでも一覧のボタンでも、「今日」ボタンと同じ今日の記録の画面が開く', async ({ page }) => {
  // 今月を開いたときは今日を選んでいるので、1回のタップで開く
  await page.goto('/#/calendar/2026-11')
  await day(page, '11月18日').click()
  await expect(page).toHaveURL(/#\/$/)
  await expect(page.getByText('2026年11月18日（水）')).toBeVisible()

  await page.goBack()
  await day(page, '11月4日').click()
  await day(page, '11月18日').click()
  await expect(page).toHaveURL(/#\/calendar\/2026-11-18$/)
  await preview(page).getByRole('button', { name: 'この日の記録を開く' }).click()
  await expect(page).toHaveURL(/#\/$/)
  await expect(page.getByText('2026年11月18日（水）')).toBeVisible()
})

test('今日の日付のアドレスを開くと、履歴を増やさずに今日の記録の画面のアドレスに置き換わる', async ({ page }) => {
  await page.goto('/#/calendar/2026-11')
  const length = await page.evaluate<number>('history.length')
  await page.goto('/#/day/2026-11-18')
  await expect(page).toHaveURL(/#\/$/)
  await expect(page.getByText('2026年11月18日（水）')).toBeVisible()
  // アドレスの書き換えで増えた分（1つ）だけで、置き換えでは増えない
  expect(await page.evaluate<number>('history.length')).toBe(length + 1)

  await page.reload()
  await expect(page).toHaveURL(/#\/$/)
  await expect(page.getByText('2026年11月18日（水）')).toBeVisible()
})

test('アドレスの日付が不正なときは、今日の記録の画面が開き、明日以降の日はその日の画面が開く', async ({ page }) => {
  for (const hash of ['#/day/2026-02-30', '#/day/abc']) {
    await page.goto(`/${hash}`)
    await page.reload()
    await expect(page.getByText('2026年11月18日（水）')).toBeVisible()
  }
  await page.goto('/#/day/2026-11-19')
  await page.reload()
  await expect(page.getByText('2026年11月19日（木）')).toBeVisible()
})

test('パソコンの画面の大きさでも、カレンダーが崩れない', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/#/calendar/2026-11-03')
  await expect(day(page, '11月3日 和・中')).toBeVisible()
  await expect(preview(page).getByRole('listitem')).toHaveCount(3)
  await expectNoHorizontalScroll(page)
})
