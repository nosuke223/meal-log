import type { Browser, Page } from '@playwright/test'
import { DEV_USER_HEADER } from '../server/devApi.ts'
import { expect, test } from './fixtures'

// 記録はサーバーに保存されるので、同じ人なら、別のブラウザ（別の端末）で開いても同じ記録が見える

test.use({ viewport: { width: 375, height: 667 } })

function section(page: Page, name: string) {
  return page.getByRole('region', { name, exact: true })
}

/** 別のブラウザ（cookie や localStorage を共有しない、新しいブラウザのコンテキスト）で、この人としてアプリを開く */
async function openInAnotherBrowser(browser: Browser, baseURL: string | undefined, email: string): Promise<Page> {
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 375, height: 667 },
    extraHTTPHeaders: { [DEV_USER_HEADER]: email },
  })
  const page = await context.newPage()
  await page.goto('/')
  return page
}

test('別のブラウザで開いても、同じ記録が見え、変更も反映される。別の人には見えない', async ({
  page,
  browser,
  baseURL,
  userEmail,
}) => {
  await page.goto('/')
  const morning = section(page, '朝')
  await morning.getByRole('textbox', { name: '新しい品名' }).fill('ごはん')
  await morning.getByRole('button', { name: '追加', exact: true }).click()
  await expect(morning.getByRole('button', { name: /ごはん/ })).toBeVisible()

  const other = await openInAnotherBrowser(browser, baseURL, userEmail)
  try {
    const otherMorning = section(other, '朝')
    await expect(otherMorning.getByRole('button', { name: /ごはん/ })).toBeVisible()

    // 別のブラウザで変えると、元のブラウザでも読み込み直すと変わっている
    await otherMorning.getByRole('button', { name: /ごはん/ }).click()
    await otherMorning.getByRole('form', { name: '品の変更' }).getByRole('textbox', { name: '品名' }).fill('おにぎり')
    await otherMorning.getByRole('form', { name: '品の変更' }).getByRole('button', { name: '保存' }).click()
    await expect(otherMorning.getByRole('button', { name: /おにぎり/ })).toBeVisible()

    await page.reload()
    await expect(section(page, '朝').getByRole('button', { name: /おにぎり/ })).toBeVisible()
    await expect(section(page, '朝').getByText('ごはん')).toHaveCount(0)
  } finally {
    await other.context().close()
  }

  const stranger = await openInAnotherBrowser(browser, baseURL, `other-${userEmail}`)
  try {
    await expect(section(stranger, '朝')).toBeVisible()
    await expect(section(stranger, '朝').getByText('おにぎり')).toHaveCount(0)
  } finally {
    await stranger.context().close()
  }
})

/** タブや画面に戻ってきたときにブラウザが送るイベントを、画面に送る */
async function returnToTab(page: Page, event: 'focus' | 'visibilitychange') {
  await page.evaluate((name) => {
    if (name === 'focus') window.dispatchEvent(new Event('focus'))
    else document.dispatchEvent(new Event('visibilitychange'))
  }, event)
}

test('開いたままの画面は、別のブラウザで変えた記録を、タブに戻ったときに読み込み直さずに表示する', async ({
  page,
  browser,
  baseURL,
  userEmail,
}) => {
  await page.goto('/')
  const lunch = section(page, '昼')
  await expect(lunch).toBeVisible()
  // 入力の途中
  await lunch.getByRole('textbox', { name: '新しい品名' }).fill('おにぎり')
  await lunch.getByRole('group', { name: 'ジャンル' }).getByRole('button', { name: '和' }).click()

  const other = await openInAnotherBrowser(browser, baseURL, userEmail)
  try {
    const otherLunch = section(other, '昼')
    await otherLunch.getByRole('textbox', { name: '新しい品名' }).fill('そば')
    await otherLunch.getByRole('button', { name: '追加', exact: true }).click()
    await expect(otherLunch.getByRole('button', { name: /そば/ })).toBeVisible()

    await returnToTab(page, 'visibilitychange')
    await expect(lunch.getByRole('button', { name: /そば/ })).toBeVisible()
    await expect(lunch.getByRole('textbox', { name: '新しい品名' })).toHaveValue('おにぎり')
    await expect(lunch.getByRole('group', { name: 'ジャンル' }).getByRole('button', { name: '和' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )

    // カレンダーでも、別のブラウザで消した品は、タブに戻ると一覧から消える
    await page.getByRole('button', { name: 'カレンダー' }).click()
    const preview = page.getByRole('region', { name: '選んだ日の品' })
    await expect(preview.getByText('そば')).toBeVisible()

    await otherLunch.getByRole('button', { name: /そば/ }).click()
    other.once('dialog', (dialog) => dialog.accept())
    await otherLunch.getByRole('form', { name: '品の変更' }).getByRole('button', { name: '削除' }).click()
    await expect(otherLunch.getByText('そば')).toHaveCount(0)

    await returnToTab(page, 'focus')
    await expect(preview.getByText('記録はありません')).toBeVisible()
    await expect(preview.getByText('そば')).toHaveCount(0)
  } finally {
    await other.context().close()
  }
})
