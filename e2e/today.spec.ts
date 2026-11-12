import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'

// スマホの縦画面の大きさ
test.use({ viewport: { width: 375, height: 667 } })

function section(page: Page, name: string) {
  return page.getByRole('region', { name, exact: true })
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

// 記録は、テストごとに別の人（fixtures.ts）のものなので、空の状態から始まる
test.beforeEach(async ({ page }) => {
  await page.goto('/')
})

test('今日の日付と4つの欄が表示される', async ({ page }) => {
  await expect(page.locator('time')).toBeVisible()
  for (const name of ['朝', '昼', '夜', '間食']) {
    await expect(section(page, name)).toBeVisible()
  }
})

test('品を追加でき、読み込み直しても残り、空白だけでは追加できない', async ({ page }) => {
  const morning = section(page, '朝')
  const add = morning.getByRole('button', { name: '追加', exact: true })
  await expect(add).toBeDisabled()
  await morning.getByRole('textbox', { name: '新しい品名' }).fill('   ')
  await expect(add).toBeDisabled()

  await addItem(page, '朝', 'ごはん')
  await expect(morning.getByRole('textbox', { name: '新しい品名' })).toHaveValue('')
  await expectNoHorizontalScroll(page)

  await page.reload()
  await expect(section(page, '朝').getByRole('button', { name: /ごはん/ })).toBeVisible()
})

test('ジャンルは同じ区分の次の品に引き継がれ、別の区分には引き継がれない', async ({ page }) => {
  const morning = section(page, '朝')
  const genre = morning.getByRole('group', { name: 'ジャンル' })
  const dish = morning.getByRole('group', { name: '料理の分類' })

  await genre.getByRole('button', { name: '和' }).click()
  await expect(genre.getByRole('button', { name: '和' })).toHaveAttribute('aria-pressed', 'true')
  await genre.getByRole('button', { name: '和' }).click()
  await expect(genre.getByRole('button', { name: '和' })).toHaveAttribute('aria-pressed', 'false')

  await genre.getByRole('button', { name: '和' }).click()
  await dish.getByRole('button', { name: '主食' }).click()
  await addItem(page, '朝', 'ごはん')

  await expect(genre.getByRole('button', { name: '和' })).toHaveAttribute('aria-pressed', 'true')
  await expect(dish.getByRole('button', { name: '主食' })).toHaveAttribute('aria-pressed', 'false')
  const lunchGenre = section(page, '昼').getByRole('group', { name: 'ジャンル' })
  await expect(lunchGenre.getByRole('button', { name: '和' })).toHaveAttribute('aria-pressed', 'false')
})

test('料理の分類は選んで解除でき、既存の品の分類も変更できる', async ({ page }) => {
  const morning = section(page, '朝')
  const dish = morning.getByRole('group', { name: '料理の分類' })
  await dish.getByRole('button', { name: '主食' }).click()
  await expect(dish.getByRole('button', { name: '主食' })).toHaveAttribute('aria-pressed', 'true')
  await dish.getByRole('button', { name: '主食' }).click()
  await expect(dish.getByRole('button', { name: '主食' })).toHaveAttribute('aria-pressed', 'false')

  await dish.getByRole('button', { name: '主食' }).click()
  await addItem(page, '朝', 'ごはん')
  const item = morning.getByRole('button', { name: /ごはん/ })
  await expect(item).toContainText('主食')

  await item.click()
  const editForm = morning.getByRole('form', { name: '品の変更' })
  const editDish = editForm.getByRole('group', { name: '料理の分類' })
  await expect(editDish.getByRole('button', { name: '主食' })).toHaveAttribute('aria-pressed', 'true')
  await editDish.getByRole('button', { name: '主食' }).click()
  await editDish.getByRole('button', { name: '主菜' }).click()
  await editForm.getByRole('button', { name: '保存' }).click()
  await expect(item).toContainText('主菜')
  await expect(item).not.toContainText('主食')

  await page.reload()
  const reloaded = section(page, '朝').getByRole('button', { name: /ごはん/ })
  await expect(reloaded).toContainText('主菜')

  await reloaded.click()
  const reloadedDish = section(page, '朝').getByRole('form', { name: '品の変更' }).getByRole('group', { name: '料理の分類' })
  await reloadedDish.getByRole('button', { name: '主菜' }).click()
  await section(page, '朝').getByRole('form', { name: '品の変更' }).getByRole('button', { name: '保存' }).click()
  await expect(section(page, '朝').getByRole('button', { name: /ごはん/ })).not.toContainText('主菜')
})

test('品を変更すると変更先の欄に移り、削除は確認で取り消せる', async ({ page }) => {
  await addItem(page, '朝', 'ごはん')
  const morning = section(page, '朝')
  await morning.getByRole('button', { name: /ごはん/ }).click()
  const editForm = morning.getByRole('form', { name: '品の変更' })
  await editForm.getByRole('textbox', { name: '品名' }).fill('おにぎり')
  await editForm.getByRole('group', { name: 'ジャンル' }).getByRole('button', { name: '和' }).click()
  await editForm.getByRole('combobox', { name: '区分' }).selectOption('lunch')
  await editForm.getByRole('button', { name: '保存' }).click()

  const moved = section(page, '昼').getByRole('button', { name: /おにぎり/ })
  await expect(moved).toBeVisible()
  await expect(moved).toContainText('和')
  await expect(morning.getByRole('button', { name: /おにぎり/ })).toHaveCount(0)
  await expectNoHorizontalScroll(page)

  await moved.click()
  const lunch = section(page, '昼')
  page.once('dialog', (dialog) => dialog.dismiss())
  await lunch.getByRole('button', { name: '削除' }).click()
  await expect(lunch.getByRole('textbox', { name: '品名', exact: true })).toHaveValue('おにぎり')

  page.once('dialog', (dialog) => dialog.accept())
  await lunch.getByRole('button', { name: '削除' }).click()
  await expect(lunch.getByRole('textbox', { name: '品名', exact: true })).toHaveCount(0)
  await expect(lunch.getByText('おにぎり')).toHaveCount(0)
})

test('通信に失敗したとき、エラーが表示され、記録は消えない', async ({ page, api }) => {
  await addItem(page, '朝', 'ごはん')
  const saved = await api.records()

  // 記録の API への通信を失敗させる（ログインの API は通す。開き直したときのログインの確かめは、下で別に試す）
  const recordApi = (url: URL) => url.pathname.startsWith('/api/') && !url.pathname.startsWith('/api/auth/')
  await page.route(recordApi, (route) => route.abort('internetdisconnected'))
  const morning = section(page, '朝')
  await morning.getByRole('textbox', { name: '新しい品名' }).fill('パン')
  await morning.getByRole('button', { name: '追加', exact: true }).click()
  await expect(page.getByRole('alert').filter({ hasText: '保存できませんでした' })).toContainText(
    'サーバーに接続できませんでした',
  )
  // 入力した品名は残る
  await expect(morning.getByRole('textbox', { name: '新しい品名' })).toHaveValue('パン')

  await page.reload()
  await expect(page.getByRole('alert').filter({ hasText: '記録を読み込めませんでした' })).toContainText(
    'サーバーに接続できませんでした',
  )
  await page.unroute(recordApi)

  // ログインの API にもつながらないときは、開き直すと、ログインの状態を確かめられなかったことが出る
  await page.route('**/api/**', (route) => route.abort('internetdisconnected'))
  await page.reload()
  await expect(page.getByRole('alert').filter({ hasText: 'ログインの状態を確かめられませんでした' })).toContainText(
    'サーバーに接続できませんでした',
  )

  await page.unroute('**/api/**')
  await page.reload()
  await expect(section(page, '朝').getByRole('button', { name: /ごはん/ })).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
  expect(await api.records()).toEqual(saved)
})

test('ログインの期限が切れたとき（401、ログイン画面への転送）、ログインの画面に移って期限切れの文言が出て、記録は消えない', async ({
  page,
  api,
}) => {
  await addItem(page, '朝', 'ごはん')
  const saved = await api.records()

  const expired = [
    { status: 401, contentType: 'application/json', body: JSON.stringify({ error: { type: 'Unauthorized', message: '' } }) },
    // 公開の前は、サイト全体を Cloudflare Access が守っている。Access は、ログインの期限が切れると、ログイン画面（別のオリジン）へ転送する
    { status: 302, headers: { Location: 'https://meal-log.cloudflareaccess.com/cdn-cgi/access/login/meal-log' } },
  ]
  for (const response of expired) {
    await page.route('**/api/**', (route) => route.fulfill(response))
    const morning = section(page, '朝')
    await morning.getByRole('button', { name: /ごはん/ }).click()
    await morning.getByRole('form', { name: '品の変更' }).getByRole('textbox', { name: '品名' }).fill('おにぎり')
    await morning.getByRole('form', { name: '品の変更' }).getByRole('button', { name: '保存' }).click()
    await expect(page).toHaveURL(/#\/login\/session-expired$/)
    await expect(page.getByRole('alert')).toHaveText('ログインの期限が切れました。ログインし直してください')

    // ここではセッションはまだ使えるので、開き直すと、記録の画面が出る
    await page.unroute('**/api/**')
    await page.goto('about:blank')
    await page.goto('/')
    await expect(section(page, '朝').getByRole('button', { name: /ごはん/ })).toBeVisible()
    expect(await api.records()).toEqual(saved)
  }
})
