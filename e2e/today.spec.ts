import { expect, test, type Page } from '@playwright/test'

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

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.evaluate('window.localStorage.clear()')
  await page.reload()
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
  await expect(lunch.getByRole('textbox', { name: '品名' })).toHaveValue('おにぎり')

  page.once('dialog', (dialog) => dialog.accept())
  await lunch.getByRole('button', { name: '削除' }).click()
  await expect(lunch.getByRole('textbox', { name: '品名' })).toHaveCount(0)
  await expect(lunch.getByText('おにぎり')).toHaveCount(0)
})

test('保存データが壊れているとき、エラーが表示され、データは上書きされない', async ({ page }) => {
  await page.evaluate(`window.localStorage.setItem('meal-log:meals', '{broken')`)
  await page.reload()
  await expect(page.getByRole('alert')).toContainText('保存データが壊れています')

  const morning = section(page, '朝')
  await morning.getByRole('textbox', { name: '新しい品名' }).fill('ごはん')
  await morning.getByRole('button', { name: '追加', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('保存できませんでした')
  expect(await page.evaluate(`window.localStorage.getItem('meal-log:meals')`)).toBe('{broken')
})
