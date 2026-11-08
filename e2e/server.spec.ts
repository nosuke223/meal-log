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
