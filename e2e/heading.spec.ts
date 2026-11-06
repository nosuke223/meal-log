import { expect, test } from '@playwright/test'

test('ページを開くと見出し「meal-log」が表示される', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'meal-log' })).toBeVisible()
})
