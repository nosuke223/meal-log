import { randomUUID } from 'node:crypto'
import type { Page } from '@playwright/test'
import { DEV_MAILS_PATH } from '../server/devApi.ts'
import { expect, test } from './fixtures'

// 会員登録からログアウトまで。開発サーバーの API（手元の D1）のログインの API を使う。
// メールは実際には送らず、開発サーバーにためたもの（DEV_MAILS_PATH）を読んで、リンクを開く

// 会員登録とログインそのものを試すので、ログインしていない状態から始める
test.use({ viewport: { width: 375, height: 667 }, signedIn: false })

const PASSWORD = 'e2e-password-123'
const SENT_MESSAGE = '確認のメールを送りました。メールのリンクを開いてください'

function memberEmail(): string {
  return `member-${randomUUID()}@example.com`
}

type DevMail = { from: string; to: string; subject: string; text: string; html: string }

/** 開発サーバーにためた、宛先が email のメール（古い順） */
async function mailsTo(page: Page, email: string): Promise<DevMail[]> {
  const response = await page.request.get(`${DEV_MAILS_PATH}?to=${encodeURIComponent(email)}`)
  expect(response.status()).toBe(200)
  return ((await response.json()) as { mails: DevMail[] }).mails
}

/** 宛先が email の、count 通目の確認のメールのリンク */
async function verificationLink(page: Page, email: string, count: number): Promise<string> {
  await expect.poll(async () => (await mailsTo(page, email)).length).toBe(count)
  const mail = (await mailsTo(page, email))[count - 1]
  expect(mail.subject).toBe('【meal-log】メールアドレスの確認')
  expect(mail.from).toBe('meal-log <onboarding@resend.dev>')
  const link = /http:\/\/localhost:5173\/api\/auth\/verify-email\?token=\S+/.exec(mail.text)?.[0]
  expect(link).toBeDefined()
  return link as string
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

test('会員登録 → 確認のメールのリンク → ログイン → ログアウトまで通る', async ({ page }) => {
  const email = memberEmail()

  // 登録すると、確認のメールを送ったことが出て、ログインした状態にはならない
  await signUp(page, email.toUpperCase())
  await expect(page.getByRole('status')).toHaveText(SENT_MESSAGE)
  await expect(page).toHaveURL(/#\/signup$/)
  await verificationLink(page, email, 1)
  await page.goto('/#/account')
  const loginForm = page.getByRole('form', { name: 'ログイン' })
  await expect(loginForm).toBeVisible()

  // 確認前のログインは断られ、確認のメールを送り直せる
  await signIn(page, email)
  await expect(loginForm.getByRole('alert')).toHaveText('メールアドレスの確認が済んでいません')
  await loginForm.getByRole('button', { name: '確認のメールをもう一度送る' }).click()
  await expect(loginForm.getByRole('status')).toHaveText(SENT_MESSAGE)
  const link = await verificationLink(page, email, 2)

  // リンクを開くと、確認できて、ログインの画面に移る（ログインした状態にはならない）
  await page.goto(link)
  await expect(page).toHaveURL(/#\/login\/verified$/)
  await expect(page.getByRole('status')).toHaveText('メールアドレスを確認できました。ログインしてください')
  expect((await page.context().cookies()).find((cookie) => cookie.name.endsWith('session_token'))).toBeUndefined()

  // 同じリンクをもう一度開くと、使用済みと出る
  await page.goto(link)
  await expect(page).toHaveURL(/#\/login\/link-used$/)
  await expect(page.getByRole('alert')).toContainText('すでに使われています')

  // ログインすると、今日の記録の画面に移る
  await page.goto('/#/login/verified')
  await signIn(page, email)
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

test('正しくないリンクを開くと、その旨が出て、確認のメールを送り直せる', async ({ page }) => {
  const email = memberEmail()
  await signUp(page, email)
  await verificationLink(page, email, 1)

  await page.goto('/api/auth/verify-email?token=broken-token')
  await expect(page).toHaveURL(/#\/login\/link-invalid$/)
  await expect(page.getByRole('alert')).toHaveText('確認のリンクが正しくありません。確認のメールを送り直してください')

  const resendForm = page.getByRole('form', { name: '確認のメールの送り直し' })
  await resendForm.getByLabel('メールアドレス').fill(email)
  await resendForm.getByRole('button', { name: '確認のメールをもう一度送る' }).click()
  await expect(resendForm.getByRole('status')).toHaveText(SENT_MESSAGE)
  await page.goto(await verificationLink(page, email, 2))
  await expect(page).toHaveURL(/#\/login\/verified$/)
})

test('パスワードが違う、存在しないメールアドレス、短いパスワードのときは日本語のエラーが出る。登録済みのアドレスでの登録は、登録できたときと同じ表示', async ({
  page,
}) => {
  const email = memberEmail()
  await signUp(page, email)
  await page.goto(await verificationLink(page, email, 1))
  await expect(page).toHaveURL(/#\/login\/verified$/)

  const loginForm = page.getByRole('form', { name: 'ログイン' })
  await signIn(page, email, 'wrong-password')
  await expect(loginForm.getByRole('alert')).toHaveText('メールアドレスかパスワードが違います')

  await signIn(page, memberEmail())
  await expect(loginForm.getByRole('alert')).toHaveText('メールアドレスかパスワードが違います')

  // 登録済みのアドレスでも、登録できたときと同じ表示。メールは「すでに登録されています」が届く
  await signUp(page, email)
  await expect(page.getByRole('status')).toHaveText(SENT_MESSAGE)
  await expect.poll(async () => (await mailsTo(page, email)).map((mail) => mail.subject)).toEqual([
    '【meal-log】メールアドレスの確認',
    '【meal-log】このメールアドレスはすでに登録されています',
  ])

  // 送った後の画面にはフォームがなく、同じアドレス（#/signup）へは移れないので、読み込み直して空のフォームを出す
  await page.reload()
  await signUp(page, memberEmail(), '1234567')
  await expect(page.getByRole('form', { name: '会員登録' }).getByRole('alert')).toHaveText('パスワードは8文字以上にしてください')
  await expect(page).toHaveURL(/#\/signup$/)

  // どれもログインしていない
  await page.goto('/#/account')
  await expect(page.getByRole('form', { name: 'ログイン' })).toBeVisible()
})

/** 宛先が email の、count 通目の再設定のメールのリンク */
async function resetLink(page: Page, email: string, count: number): Promise<string> {
  await expect.poll(async () => (await mailsTo(page, email)).length).toBe(count)
  const mail = (await mailsTo(page, email))[count - 1]
  expect(mail.subject).toBe('【meal-log】パスワードの再設定')
  const link = /http:\/\/localhost:5173\/#\/reset\/\S+/.exec(mail.text)?.[0]
  expect(link).toBeDefined()
  return link as string
}

test('「パスワードを忘れた」→ 再設定のメールのリンク → 新しいパスワード → ログインまで通る。同じリンクは使えない', async ({ page }) => {
  const email = memberEmail()
  const newPassword = 'e2e-new-password-456'
  await signUp(page, email)
  await page.goto(await verificationLink(page, email, 1))
  await expect(page).toHaveURL(/#\/login\/verified$/)

  // ログインの画面の「パスワードを忘れた」から、再設定のメールを送る
  await page.getByRole('button', { name: 'パスワードを忘れた' }).click()
  await expect(page).toHaveURL(/#\/forgot$/)
  const forgotForm = page.getByRole('form', { name: '再設定のメール' })
  await forgotForm.getByLabel('メールアドレス').fill(email.toUpperCase())
  await forgotForm.getByRole('button', { name: '再設定のメールを送る' }).click()
  const requested = '登録されているメールアドレスなら、再設定のメールを送りました。メールのリンクを開いてください'
  await expect(page.getByRole('status')).toHaveText(requested)
  const link = await resetLink(page, email, 2)

  // 登録されていないメールアドレスでも、同じ表示で、メールは届かない
  const stranger = memberEmail()
  // 同じアドレスへの goto は画面を作り直さない（送信済みの表示が残る）ので、読み込み直して空のフォームにする
  await page.goto('/#/forgot')
  await page.reload()
  await page.getByRole('form', { name: '再設定のメール' }).getByLabel('メールアドレス').fill(stranger)
  await page.getByRole('form', { name: '再設定のメール' }).getByRole('button', { name: '再設定のメールを送る' }).click()
  await expect(page.getByRole('status')).toHaveText(requested)
  expect(await mailsTo(page, stranger)).toEqual([])

  // リンクを開くと、アドレスからトークンが消える。8文字未満のパスワードは断られる
  await page.goto(link)
  const resetForm = page.getByRole('form', { name: '新しいパスワード' })
  await expect(resetForm).toBeVisible()
  await expect(page).toHaveURL(/#\/reset$/)
  await resetForm.getByLabel('新しいパスワード').fill('1234567')
  await resetForm.getByRole('button', { name: 'パスワードを変更する' }).click()
  await expect(resetForm.getByRole('alert')).toHaveText('パスワードは8文字以上にしてください')

  // 新しいパスワードを決めると、ログインの画面に移る（ログインした状態にはならない）
  await resetForm.getByLabel('新しいパスワード').fill(newPassword)
  await resetForm.getByRole('button', { name: 'パスワードを変更する' }).click()
  await expect(page).toHaveURL(/#\/login\/password-reset$/)
  await expect(page.getByRole('status')).toHaveText('パスワードを変更しました。ログインしてください')
  expect((await page.context().cookies()).find((cookie) => cookie.name.endsWith('session_token'))).toBeUndefined()

  // 古いパスワードでは入れず、新しいパスワードでログインできる
  const loginForm = page.getByRole('form', { name: 'ログイン' })
  await signIn(page, email, PASSWORD)
  await expect(loginForm.getByRole('alert')).toHaveText('メールアドレスかパスワードが違います')
  await signIn(page, email, newPassword)
  await expectTodayScreen(page)

  // 読み込み直してトークンがなくなったときは、リンクをもう一度開くよう出す
  await page.goto(link)
  await expect(page).toHaveURL(/#\/reset$/)
  await page.reload()
  await expect(page.getByRole('alert')).toHaveText('リンクをもう一度開いてください')

  // 同じリンクをもう一度使っても、使えない。再設定のメールを送る画面に移れる
  await page.goto(link)
  await page.getByRole('form', { name: '新しいパスワード' }).getByLabel('新しいパスワード').fill('another-password-789')
  await page.getByRole('button', { name: 'パスワードを変更する' }).click()
  await expect(page.getByRole('alert')).toHaveText(
    'このリンクは、期限が切れているか、すでに使われています。もう一度、再設定のメールを送ってください',
  )
  await page.getByRole('button', { name: '再設定のメールを送る' }).click()
  await expect(page).toHaveURL(/#\/forgot$/)
})
