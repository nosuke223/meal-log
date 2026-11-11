import { randomUUID } from 'node:crypto'
import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'

// 会員登録からログアウトまで。開発サーバーの API（手元の D1）のログインの API を使う

test.use({ viewport: { width: 375, height: 667 } })

const PASSWORD = 'e2e-password-123'

function memberEmail(): string {
  return `member-${randomUUID()}@example.com`
}

async function fillCredentials(page: Page, formName: string, email: string, password: string) {
  const form = page.getByRole('form', { name: formName })
  await form.getByLabel('メールアドレス').fill(email)
  await form.getByLabel('パスワード').fill(password)
}

async function signUp(page: Page, email: string, password = PASSWORD) {
  await page.goto('/#/signup')
  await fillCredentials(page, '会員登録', email, password)
  await page.getByRole('form', { name: '会員登録' }).getByRole('button', { name: '登録する' }).click()
}

async function signIn(page: Page, email: string, password = PASSWORD) {
  await fillCredentials(page, 'ログイン', email, password)
  await page.getByRole('form', { name: 'ログイン' }).getByRole('button', { name: 'ログイン' }).click()
}

async function expectTodayScreen(page: Page) {
  await expect(page.getByRole('heading', { name: 'meal-log' })).toBeVisible()
  await expect(page).toHaveURL(/#\/$/)
}

test('会員登録すると、そのままログインした状態になり、ログアウトして、もう一度ログインできる', async ({ page }) => {
  const email = memberEmail()

  await signUp(page, email.toUpperCase())
  await expectTodayScreen(page)

  // 記録の画面のヘッダーの「アカウント」で、ログイン中のメールアドレス（小文字）が出る
  await page.getByRole('button', { name: 'アカウント' }).click()
  await expect(page).toHaveURL(/#\/account$/)
  await expect(page.getByRole('heading', { name: 'アカウント' })).toBeVisible()
  await expect(page.getByText(email, { exact: true })).toBeVisible()

  // セッションの cookie は、画面の JavaScript から読めない（HttpOnly）。手元の http では Secure を付けない
  const cookies = await page.context().cookies()
  const session = cookies.find((cookie) => cookie.name.endsWith('session_token'))
  expect(session).toBeDefined()
  expect(session?.httpOnly).toBe(true)
  expect(session?.sameSite).toBe('Lax')
  expect(await page.evaluate(() => document.cookie)).not.toContain('session_token')

  // ログアウトすると、アカウントの画面はログインの画面になり、読み込み直してもログインしていない
  await page.getByRole('button', { name: 'ログアウト' }).click()
  await expect(page.getByRole('form', { name: 'ログイン' })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('form', { name: 'ログイン' })).toBeVisible()

  // もう一度ログインすると、今日の記録の画面に移る
  await signIn(page, email)
  await expectTodayScreen(page)
  await page.getByRole('button', { name: 'アカウント' }).click()
  await expect(page.getByText(email, { exact: true })).toBeVisible()
})

test('パスワードが違う、存在しないメールアドレス、登録済み、短いパスワードのときは、日本語のエラーが出て、ログインしない', async ({
  page,
}) => {
  const email = memberEmail()
  await signUp(page, email)
  await expectTodayScreen(page)
  await page.getByRole('button', { name: 'アカウント' }).click()
  await page.getByRole('button', { name: 'ログアウト' }).click()

  const loginForm = page.getByRole('form', { name: 'ログイン' })
  await signIn(page, email, 'wrong-password')
  await expect(loginForm.getByRole('alert')).toHaveText('メールアドレスかパスワードが違います')

  await signIn(page, memberEmail())
  await expect(loginForm.getByRole('alert')).toHaveText('メールアドレスかパスワードが違います')
  await expect(page).toHaveURL(/#\/account$/)

  await signUp(page, email)
  const signupForm = page.getByRole('form', { name: '会員登録' })
  await expect(signupForm.getByRole('alert')).toHaveText('このメールアドレスは、すでに登録されています。ログインしてください')

  await signUp(page, memberEmail(), '1234567')
  await expect(signupForm.getByRole('alert')).toHaveText('パスワードは8文字以上にしてください')
  await expect(page).toHaveURL(/#\/signup$/)

  // どれもログインしていない
  await page.goto('/#/account')
  await expect(page.getByRole('form', { name: 'ログイン' })).toBeVisible()
})
