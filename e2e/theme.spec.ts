import type { Locator, Page } from '@playwright/test'
import { expect, test, type StoredRecord } from './fixtures'

// スマホの縦画面の大きさ。端末はライトモードにしておき、それでも黒に近い画面になることを確かめる。今日を 2026年11月18日（水）に固定する
test.use({ viewport: { width: 375, height: 667 }, timezoneId: 'Asia/Tokyo', colorScheme: 'light' })

const NOW = new Date('2026-11-18T10:00:00+09:00')

const GENRES = [
  { genre: 'japanese', name: 'ごはん', label: '和', mark: '和' },
  { genre: 'western', name: 'パン', label: '洋', mark: '洋' },
  { genre: 'chinese', name: '餃子', label: '中', mark: '中' },
  { genre: 'other', name: 'カレー', label: 'その他', mark: '他' },
]

const RECORDS: StoredRecord[] = GENRES.map(({ genre, name }, index) => ({
  id: `theme-${index}`,
  date: '2026-11-17',
  mealType: 'dinner',
  name,
  genre,
  dishType: 'main',
  status: 'eaten',
  createdAt: `2026-11-01T00:00:0${index}.000Z`,
  updatedAt: `2026-11-01T00:00:0${index}.000Z`,
}))

type Rgb = [number, number, number]

/** 計算後の色（rgb(…) の形）を、赤・緑・青の数にする */
function parseRgb(value: string): Rgb {
  const match = value.match(/rgba?\((\d+), (\d+), (\d+)/)
  if (!match) throw new Error(`色を読めません: ${value}`)
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

/** 色の明るさ（WCAG 2.1 の相対輝度、0〜1） */
function luminance([r, g, b]: Rgb): number {
  const [lr, lg, lb] = [r, g, b].map((c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb
}

async function style(locator: Locator, property: 'backgroundColor' | 'color' | 'colorScheme'): Promise<string> {
  return locator.evaluate((element, name) => getComputedStyle(element)[name], property)
}

async function expectDarkPage(page: Page) {
  const background = parseRgb(await style(page.locator('body'), 'backgroundColor'))
  const text = parseRgb(await style(page.locator('body'), 'color'))
  expect(luminance(background)).toBeLessThan(0.02)
  expect(luminance(text)).toBeGreaterThan(0.7)
}

function section(page: Page, name: string) {
  return page.getByRole('region', { name, exact: true })
}

test.beforeEach(async ({ page, api }) => {
  await page.clock.setFixedTime(NOW)
  await api.seed(RECORDS)
})

test('端末がライトモードでも、記録の画面、カレンダー、データ画面、ログイン、会員登録、パスワードを忘れた画面、新しいパスワードを決める画面、アカウントの画面は黒に近い背景に白に近い文字になる', async ({
  page,
}) => {
  for (const hash of ['#/', '#/day/2026-11-17', '#/calendar/2026-11-17', '#/data', '#/login', '#/signup', '#/forgot', '#/reset', '#/account']) {
    await page.goto(`/${hash}`)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expectDarkPage(page)
  }
  // 欄の枠も暗い色
  await page.goto('/#/day/2026-11-17')
  expect(luminance(parseRgb(await style(section(page, '夜'), 'backgroundColor')))).toBeLessThan(0.05)
})

test('ジャンルの札は、カレンダーの点と同じ、ジャンルごとに違う色で、文字も残る。料理の分類の札は色のない灰色', async ({ page }) => {
  // カレンダーの凡例の点の色
  await page.goto('/#/calendar/2026-11-17')
  const legend = page.getByRole('region', { name: '点の凡例' })
  const markColors = new Map<string, string>()
  for (const { genre, mark } of GENRES) {
    const dot = legend.locator('.mark').filter({ hasText: new RegExp(`^${mark}$`) })
    markColors.set(genre, await style(dot, 'backgroundColor'))
  }
  expect(new Set(markColors.values()).size).toBe(GENRES.length)

  // カレンダーの選んだ日の一覧の札
  const preview = page.getByRole('region', { name: '選んだ日の品' })
  for (const { genre, name, label } of GENRES) {
    const tag = preview.getByRole('listitem').filter({ hasText: name }).getByText(label, { exact: true })
    expect(await style(tag, 'backgroundColor')).toBe(markColors.get(genre))
  }

  // 記録の画面の品の札
  await page.goto('/#/day/2026-11-17')
  const dinner = section(page, '夜')
  for (const { genre, name, label } of GENRES) {
    const tag = dinner.getByRole('button', { name: new RegExp(name) }).getByText(label, { exact: true })
    expect(await style(tag, 'backgroundColor')).toBe(markColors.get(genre))
  }

  // 料理の分類の札は、赤・緑・青が同じ灰色で、ジャンルの札のどの色とも違う
  const dishTag = dinner.getByRole('button', { name: /ごはん/ }).getByText('主菜', { exact: true })
  const dishColor = await style(dishTag, 'backgroundColor')
  const [r, g, b] = parseRgb(dishColor)
  expect(r).toBe(g)
  expect(g).toBe(b)
  expect([...markColors.values()]).not.toContain(dishColor)
})

test('日付の入力と区分の選択は、暗い見た目で表示される', async ({ page }) => {
  await page.goto('/#/day/2026-11-17')
  await section(page, '夜').getByRole('button', { name: /ごはん/ }).click()
  const form = section(page, '夜')
  for (const control of [form.getByRole('combobox', { name: '区分' }), form.getByLabel('日付')]) {
    await expect(control).toBeVisible()
    expect(await style(control, 'colorScheme')).toBe('dark')
    expect(luminance(parseRgb(await style(control, 'backgroundColor')))).toBeLessThan(0.05)
    expect(luminance(parseRgb(await style(control, 'color')))).toBeGreaterThan(0.7)
  }
})

async function expectDarkControl(control: Locator) {
  await expect(control).toBeVisible()
  expect(await style(control, 'colorScheme')).toBe('dark')
  expect(luminance(parseRgb(await style(control, 'backgroundColor')))).toBeLessThan(0.05)
  expect(luminance(parseRgb(await style(control, 'color')))).toBeGreaterThan(0.7)
}

test('ログインの画面のメールアドレスとパスワードの入力欄は、暗い見た目で表示される', async ({ page }) => {
  await page.goto('/#/login')
  const form = page.getByRole('form', { name: 'ログイン' })
  for (const control of [form.getByLabel('メールアドレス'), form.getByLabel('パスワード')]) {
    await expectDarkControl(control)
  }
})

/** 2つの色の明るさの差（WCAG 2.1 のコントラスト比） */
function contrast(a: Rgb, b: Rgb): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (light + 0.05) / (dark + 0.05)
}

async function expectReadable(locator: Locator) {
  await expect(locator).toBeVisible()
  const text = parseRgb(await style(locator, 'color'))
  const background = parseRgb(await style(locator, 'backgroundColor'))
  expect(contrast(text, background)).toBeGreaterThanOrEqual(4.5)
}

test('アカウントの画面の退会の節は、暗い見た目で、文字と背景の明るさの差が 4.5:1 以上', async ({ page }) => {
  await page.goto('/#/account')
  const form = page.getByRole('form', { name: '退会' })
  await expectDarkControl(form.getByLabel('パスワード'))
  await expectReadable(form.getByRole('button', { name: '退会する' }))

  await form.getByLabel('パスワード').fill('any-password')
  await form.getByRole('button', { name: '退会する' }).click()
  const confirm = form.getByRole('group', { name: '退会の確認' })
  expect(luminance(parseRgb(await style(confirm, 'backgroundColor')))).toBeLessThan(0.05)
  expect(contrast(parseRgb(await style(confirm, 'color')), parseRgb(await style(confirm, 'backgroundColor')))).toBeGreaterThanOrEqual(4.5)
  await expectReadable(confirm.getByRole('button', { name: '退会を確定する' }))
  await expectReadable(confirm.getByRole('button', { name: 'やめる' }))
})

test('パスワードを忘れた画面のメールアドレスの入力欄は、暗い見た目で表示される', async ({ page }) => {
  await page.goto('/#/forgot')
  const form = page.getByRole('form', { name: '再設定のメール' })
  await expectDarkControl(form.getByLabel('メールアドレス'))
})
