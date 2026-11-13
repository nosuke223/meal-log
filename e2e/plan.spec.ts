import type { Page } from '@playwright/test'
import { expect, test, type StoredRecord } from './fixtures'

// 無料のプランの記録の上限。開発サーバーには環境変数 FREE_PLAN_RECORD_LIMIT を渡さないので、上限は 300 品

test.use({ viewport: { width: 375, height: 667 } })

const LIMIT = 300
const LIMIT_MESSAGE = `無料のプランで保存できる記録は${LIMIT}品までです。有料のプランにすると、上限がなくなります（有料のプランは準備中です）`

function section(page: Page, name: string) {
  return page.getByRole('region', { name, exact: true })
}

/** 上限ちょうどの数の記録（過去の日の、食べた記録） */
function fullRecords(): StoredRecord[] {
  return Array.from({ length: LIMIT }, (_, index) => ({
    id: `limit-${String(index).padStart(3, '0')}`,
    date: '2026-01-01',
    mealType: 'dinner',
    name: `品${index}`,
    genre: null,
    dishType: null,
    status: 'eaten',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }))
}

test('上限ちょうどの記録があると、追加できず上限のメッセージが出る。アカウントの画面に記録の数と上限が出る', async ({
  page,
  api,
  member,
}) => {
  // 記録がないときの表示
  await page.goto('/#/account')
  await expect(page.getByText('プラン: 無料（記録 0 / 300 品）')).toBeVisible()

  await api.seed(fullRecords())
  await page.goto('/')
  const lunch = section(page, '昼')
  await lunch.getByRole('textbox', { name: '新しい品名' }).fill('うどん')
  await lunch.getByRole('button', { name: '追加', exact: true }).click()
  await expect(page.getByRole('alert').filter({ hasText: '保存できませんでした' })).toContainText(LIMIT_MESSAGE)
  // 入力した品名は残り、記録は増えない
  await expect(lunch.getByRole('textbox', { name: '新しい品名' })).toHaveValue('うどん')
  expect(await api.records()).toHaveLength(LIMIT)

  await page.getByRole('button', { name: 'アカウント' }).click()
  await expect(page.getByText('プラン: 無料（記録 300 / 300 品）')).toBeVisible()
  await expect(page.getByText(member.email, { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'ログアウト' })).toBeVisible()

  // 書き出しはできる
  await page.goto('/#/data')
  await page.getByRole('button', { name: '書き出す' }).click()
  await expect(page.getByRole('status')).toHaveText(`${LIMIT}件の記録を書き出しました`)

  // 1件消すと、また追加できる
  const removed = await member.request.delete(`/api/meal?id=${encodeURIComponent('limit-000')}`)
  expect(removed.status()).toBe(204)
  await page.goto('/')
  await lunch.getByRole('textbox', { name: '新しい品名' }).fill('そば')
  await lunch.getByRole('button', { name: '追加', exact: true }).click()
  await expect(lunch.getByRole('button', { name: /そば/ })).toBeVisible()
  expect(await api.records()).toHaveLength(LIMIT)
})

test('データ画面で、上限を超える取り込みは、エラーを出して何も取り込まない', async ({ page, api }) => {
  const records = fullRecords()
  await api.seed(records.slice(0, LIMIT - 1))
  await page.goto('/#/data')

  // 今ない ID の記録を3件取り込むと、299 + 3 = 302 品になる
  const added = records.slice(0, 3).map((record) => ({ ...record, id: `new-${record.id}` }))
  const file = { version: 1, exportedAt: '2026-11-06T00:00:00.000Z', records: added }
  await page.getByLabel('読み込むファイル').setInputFiles({
    name: 'meal-log.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(file)),
  })
  const confirm = page.getByRole('group', { name: '取り込みの確認' })
  await confirm.getByRole('button', { name: '取り込む' }).click()
  await expect(page.getByRole('alert')).toContainText(
    `取り込むと、無料のプランの上限（${LIMIT}品）を超えます。取り込みは行われませんでした`,
  )
  expect(await api.records()).toHaveLength(LIMIT - 1)
})
