import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import App from '../App'
import { createLocalStorageMealRepository } from '../meals/localStorageMealRepository'
import { LoginExpiredError } from '../meals/mealRepository'
import { createMemoryPlanClient } from '../plan/memoryPlanClient'
import { renderApp } from '../renderApp'
import { AUTH_MESSAGES, AuthError } from './authClient'
import { createMemoryAuthClient, MEMORY_MEMBER_PASSWORD } from './memoryAuthClient'

const TODAY = '2026-11-06'
const PASSWORD = 'password-123'

function open(hash: string) {
  window.history.replaceState(null, '', hash)
}

function form(name: string) {
  return within(screen.getByRole('form', { name }))
}

function fill(formName: string, email: string, password: string) {
  const target = form(formName)
  fireEvent.change(target.getByLabelText('メールアドレス'), { target: { value: email } })
  fireEvent.change(target.getByLabelText('パスワード'), { target: { value: password } })
}

async function submit(formName: string, email: string, password: string, button: string) {
  fill(formName, email, password)
  fireEvent.click(form(formName).getByRole('button', { name: button }))
}

function signUp(email: string, password = PASSWORD) {
  return submit('会員登録', email, password, '登録する')
}

function signIn(email: string, password = PASSWORD) {
  return submit('ログイン', email, password, 'ログイン')
}

/** 今日の記録の画面が出るのを待つ */
async function expectTodayScreen() {
  expect(await screen.findByRole('heading', { name: 'meal-log' })).toBeInTheDocument()
  expect(window.location.hash).toBe('#/')
}

test('記録の画面のヘッダーの「アカウント」で、アカウントの画面を開く', async () => {
  await renderApp(<App today={TODAY} authClient={createMemoryAuthClient({ signedInAs: 'alice@example.com' })} />)
  fireEvent.click(screen.getByRole('button', { name: 'アカウント' }))

  expect(window.location.hash).toBe('#/account')
  expect(await screen.findByText('alice@example.com')).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'アカウント' })).toBeInTheDocument()
})

test('ログインしていなければ、アカウントの画面はログインの画面を出す', async () => {
  open('#/account')
  render(<App today={TODAY} authClient={createMemoryAuthClient()} />)

  expect(window.location.hash).toBe('#/account')
  expect(await screen.findByRole('heading', { name: 'ログイン' })).toBeInTheDocument()
  expect(screen.getByRole('form', { name: 'ログイン' })).toBeInTheDocument()
})

test('会員登録すると、確認のメールを送ったことを出し、ログインした状態にはならない', async () => {
  const authClient = createMemoryAuthClient()
  open('#/signup')
  render(<App today={TODAY} authClient={authClient} />)
  expect(screen.getByRole('heading', { name: '会員登録' })).toBeInTheDocument()

  await signUp('Alice@Example.com')
  expect(await screen.findByRole('status')).toHaveTextContent('確認のメールを送りました。メールのリンクを開いてください')
  expect(screen.queryByRole('form', { name: '会員登録' })).not.toBeInTheDocument()
  expect(window.location.hash).toBe('#/signup')
  expect(await authClient.getSession()).toBeNull()
  expect(authClient.mails).toEqual([{ to: 'alice@example.com', kind: 'verification' }])
})

test('確認した後にログインすると、今日の記録の画面に移り、アカウントの画面にメールアドレスとログアウトが出る', async () => {
  const authClient = createMemoryAuthClient()
  await authClient.signUp('alice@example.com', PASSWORD)
  authClient.verify('alice@example.com')
  open('#/login/verified')
  render(<App today={TODAY} authClient={authClient} />)

  await signIn('alice@example.com')
  await expectTodayScreen()

  fireEvent.click(screen.getByRole('button', { name: 'アカウント' }))
  expect(await screen.findByText('alice@example.com')).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'アカウント' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'ログアウト' })).toBeInTheDocument()
})

test('確認前にログインしようとすると、「メールアドレスの確認が済んでいません」と出し、確認のメールを送り直せる', async () => {
  const authClient = createMemoryAuthClient()
  await authClient.signUp('alice@example.com', PASSWORD)
  open('#/login')
  render(<App today={TODAY} authClient={authClient} />)

  await signIn('Alice@example.com')
  expect(await form('ログイン').findByRole('alert')).toHaveTextContent('メールアドレスの確認が済んでいません')
  expect(window.location.hash).toBe('#/login')
  expect(await authClient.getSession()).toBeNull()

  fireEvent.click(form('ログイン').getByRole('button', { name: '確認のメールをもう一度送る' }))
  expect(await form('ログイン').findByRole('status')).toHaveTextContent('確認のメールを送りました。メールのリンクを開いてください')
  expect(authClient.mails).toHaveLength(2)
  expect(authClient.mails[1]).toEqual({ to: 'alice@example.com', kind: 'verification' })
})

test('確認のメールを送り直せなかったときは、日本語のエラーを出す', async () => {
  const authClient = createMemoryAuthClient()
  await authClient.signUp('alice@example.com', PASSWORD)
  open('#/login')
  render(<App today={TODAY} authClient={authClient} />)
  await signIn('alice@example.com')
  const button = await form('ログイン').findByRole('button', { name: '確認のメールをもう一度送る' })

  authClient.failNext(new AuthError(AUTH_MESSAGES.tooManyMails))
  fireEvent.click(button)
  expect(await screen.findByText(AUTH_MESSAGES.tooManyMails)).toBeInTheDocument()
  expect(authClient.mails).toHaveLength(1)
})

test('パスワードが違うときは、確認の前でも、送り直しのボタンを出さない', async () => {
  const authClient = createMemoryAuthClient()
  await authClient.signUp('alice@example.com', PASSWORD)
  open('#/login')
  render(<App today={TODAY} authClient={authClient} />)

  await signIn('alice@example.com', 'wrong-password')
  expect(await screen.findByRole('alert')).toHaveTextContent(AUTH_MESSAGES.wrongCredentials)
  expect(screen.queryByRole('button', { name: '確認のメールをもう一度送る' })).not.toBeInTheDocument()
})

test('確認のメールのリンクで確認できたときは、ログインの画面に「メールアドレスを確認できました。ログインしてください」と出す', () => {
  open('#/login/verified')
  render(<App today={TODAY} authClient={createMemoryAuthClient()} />)

  expect(screen.getByRole('heading', { name: 'ログイン' })).toBeInTheDocument()
  expect(screen.getByRole('status')).toHaveTextContent('メールアドレスを確認できました。ログインしてください')
  expect(screen.getByRole('form', { name: 'ログイン' })).toBeInTheDocument()
  expect(screen.queryByRole('form', { name: '確認のメールの送り直し' })).not.toBeInTheDocument()
})

test.each([
  ['#/login/link-expired', AUTH_MESSAGES.linkExpired],
  ['#/login/link-used', AUTH_MESSAGES.linkUsed],
  ['#/login/link-invalid', AUTH_MESSAGES.linkInvalid],
])('%s のときは、その旨を出し、メールアドレスを入れて確認のメールを送り直せる', async (hash, message) => {
  const authClient = createMemoryAuthClient()
  await authClient.signUp('alice@example.com', PASSWORD)
  open(hash)
  render(<App today={TODAY} authClient={authClient} />)

  expect(screen.getByRole('alert')).toHaveTextContent(message)
  const resendForm = form('確認のメールの送り直し')
  fireEvent.click(resendForm.getByRole('button', { name: '確認のメールをもう一度送る' }))
  expect(await resendForm.findByRole('alert')).toHaveTextContent(AUTH_MESSAGES.emptyEmail)

  fireEvent.change(resendForm.getByLabelText('メールアドレス'), { target: { value: 'alice@example.com' } })
  fireEvent.click(resendForm.getByRole('button', { name: '確認のメールをもう一度送る' }))
  expect(await resendForm.findByRole('status')).toHaveTextContent('確認のメールを送りました。メールのリンクを開いてください')
  expect(authClient.mails).toHaveLength(2)
})

test('ログアウトすると、ログインの画面になり、もう一度ログインすると今日の記録の画面に移る', async () => {
  const authClient = createMemoryAuthClient()
  await authClient.signUp('alice@example.com', PASSWORD)
  authClient.verify('alice@example.com')
  await authClient.signIn('alice@example.com', PASSWORD)
  open('#/account')
  render(<App today={TODAY} authClient={authClient} />)

  fireEvent.click(await screen.findByRole('button', { name: 'ログアウト' }))
  expect(await screen.findByRole('form', { name: 'ログイン' })).toBeInTheDocument()
  expect(await authClient.getSession()).toBeNull()

  // メールアドレスは大文字と小文字を区別しない
  await signIn('ALICE@example.com')
  await expectTodayScreen()
  expect(await authClient.getSession()).toEqual({ email: 'alice@example.com' })
})

test('ログイン中は、ログインの画面と会員登録の画面を、互いに行き来でき、「記録の画面へ」で今日の記録の画面に戻る', async () => {
  open('#/login')
  render(<App today={TODAY} />)

  fireEvent.click(screen.getByRole('button', { name: '会員登録へ' }))
  expect(window.location.hash).toBe('#/signup')
  expect(screen.getByRole('heading', { name: '会員登録' })).toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: 'ログインへ' }))
  expect(window.location.hash).toBe('#/login')
  expect(screen.getByRole('heading', { name: 'ログイン' })).toBeInTheDocument()

  // ログインの状態を確かめてから出る
  fireEvent.click(await screen.findByRole('button', { name: '記録の画面へ' }))
  await expectTodayScreen()
})

test.each([
  ['#/login', 'ログイン'],
  ['#/signup', '会員登録'],
  ['#/forgot', 'パスワードの再設定'],
  ['#/reset', '新しいパスワード'],
  ['#/account', 'アカウント'],
])('ログイン中は、%s の画面の「記録の画面へ」で、今日の記録の画面に移る（履歴が増える）', async (hash, heading) => {
  open(hash)
  const historyLength = window.history.length
  render(<App today={TODAY} authClient={createMemoryAuthClient({ signedInAs: 'alice@example.com' })} />)
  expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument()

  fireEvent.click(await screen.findByRole('button', { name: '記録の画面へ' }))
  await expectTodayScreen()
  expect(window.history.length).toBe(historyLength + 1)
})

const NEW_PASSWORD = 'new-password-456'

function requestReset(email: string) {
  const target = form('再設定のメール')
  fireEvent.change(target.getByLabelText('メールアドレス'), { target: { value: email } })
  fireEvent.click(target.getByRole('button', { name: '再設定のメールを送る' }))
}

function setNewPassword(password: string) {
  const target = form('新しいパスワード')
  fireEvent.change(target.getByLabelText('新しいパスワード'), { target: { value: password } })
  fireEvent.click(target.getByRole('button', { name: 'パスワードを変更する' }))
}

/** 登録・確認済みの会員 alice で、再設定のメールを送ってもらい、そのリンクのトークンを返す */
async function memberWithResetToken(authClient: ReturnType<typeof createMemoryAuthClient>): Promise<string> {
  await authClient.signUp('alice@example.com', PASSWORD)
  authClient.verify('alice@example.com')
  await authClient.requestPasswordReset('alice@example.com')
  const token = authClient.mails.at(-1)?.token
  if (token === undefined) throw new Error('再設定のメールがありません')
  return token
}

test('ログインの画面の「パスワードを忘れた」で、再設定のメールを送る画面（#/forgot）に移り、「ログインへ」で戻れる', () => {
  open('#/login')
  render(<App today={TODAY} />)

  fireEvent.click(screen.getByRole('button', { name: 'パスワードを忘れた' }))
  expect(window.location.hash).toBe('#/forgot')
  expect(screen.getByRole('heading', { name: 'パスワードの再設定' })).toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: 'ログインへ' }))
  expect(window.location.hash).toBe('#/login')
})

test('アカウントの画面から出たログインの画面にも、「パスワードを忘れた」がある', async () => {
  open('#/account')
  render(<App today={TODAY} authClient={createMemoryAuthClient()} />)

  fireEvent.click(await screen.findByRole('button', { name: 'パスワードを忘れた' }))
  expect(window.location.hash).toBe('#/forgot')
})

test('登録されているメールアドレスでも、されていないメールアドレスでも、再設定のメールを送ったときの表示は同じ。送るのは登録されているときだけ', async () => {
  const shown: string[] = []
  for (const email of ['alice@example.com', 'nobody@example.com']) {
    const authClient = createMemoryAuthClient()
    await authClient.signUp('alice@example.com', PASSWORD)
    open('#/forgot')
    const { unmount } = render(<App today={TODAY} authClient={authClient} />)

    requestReset(email)
    const status = await screen.findByRole('status')
    shown.push(status.textContent ?? '')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(authClient.mails.filter((mail) => mail.kind === 'resetPassword').map((mail) => mail.to)).toEqual(
      email === 'alice@example.com' ? ['alice@example.com'] : [],
    )
    unmount()
  }
  expect(shown).toEqual([AUTH_MESSAGES.resetRequested, AUTH_MESSAGES.resetRequested])
  expect(AUTH_MESSAGES.resetRequested).toBe('登録されているメールアドレスなら、再設定のメールを送りました。メールのリンクを開いてください')
})

test('メールアドレスの確認が済んでいない会員にも、再設定のメールを送る', async () => {
  const authClient = createMemoryAuthClient()
  await authClient.signUp('alice@example.com', PASSWORD)
  open('#/forgot')
  render(<App today={TODAY} authClient={authClient} />)

  requestReset('Alice@Example.com')
  expect(await screen.findByRole('status')).toHaveTextContent(AUTH_MESSAGES.resetRequested)
  expect(authClient.mails.at(-1)).toMatchObject({ to: 'alice@example.com', kind: 'resetPassword' })
})

test.each([
  ['空', '', AUTH_MESSAGES.emptyEmail],
  ['形が正しくない', 'alice.example.com', AUTH_MESSAGES.invalidEmail],
])('再設定のメールで、メールアドレスが%sときは、日本語のエラーを出し、送らない', async (_, email, message) => {
  const authClient = createMemoryAuthClient()
  open('#/forgot')
  render(<App today={TODAY} authClient={authClient} />)

  requestReset(email)
  expect(await screen.findByRole('alert')).toHaveTextContent(message)
  expect(authClient.mails).toHaveLength(0)
})

test('再設定のメールを送る回数の上限を超えたときは、日本語のエラーを出す', async () => {
  const authClient = createMemoryAuthClient()
  open('#/forgot')
  render(<App today={TODAY} authClient={authClient} />)

  authClient.failNext(new AuthError(AUTH_MESSAGES.tooManyMails))
  requestReset('alice@example.com')
  expect(await screen.findByRole('alert')).toHaveTextContent(AUTH_MESSAGES.tooManyMails)
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
})

test('メールのリンク（#/reset/<トークン>）を開くと、トークンをアドレスから消し（履歴は増やさない）、新しいパスワードを決められる。決めた後は、ログインの画面に移り、ログインした状態にはならない', async () => {
  const authClient = createMemoryAuthClient()
  const token = await memberWithResetToken(authClient)
  const historyLength = window.history.length
  open(`#/reset/${token}`)
  render(<App today={TODAY} authClient={authClient} />)

  // トークンはアドレスに残らない
  await screen.findByRole('form', { name: '新しいパスワード' })
  expect(window.location.hash).toBe('#/reset')
  expect(window.history.length).toBe(historyLength)

  setNewPassword(NEW_PASSWORD)
  expect(await screen.findByRole('status')).toHaveTextContent('パスワードを変更しました。ログインしてください')
  expect(window.location.hash).toBe('#/login/password-reset')
  expect(await authClient.getSession()).toBeNull()

  // 新しいパスワードでログインでき、古いパスワードではログインできない
  await signIn('alice@example.com', PASSWORD)
  expect(await form('ログイン').findByRole('alert')).toHaveTextContent(AUTH_MESSAGES.wrongCredentials)
  await signIn('alice@example.com', NEW_PASSWORD)
  await expectTodayScreen()
})

test('同じリンクをもう一度使うと、使えない旨を出し、再設定のメールを送る画面に移れる', async () => {
  const authClient = createMemoryAuthClient()
  const token = await memberWithResetToken(authClient)
  await authClient.resetPassword(token, NEW_PASSWORD)
  open(`#/reset/${token}`)
  render(<App today={TODAY} authClient={authClient} />)

  setNewPassword('another-password-789')
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'このリンクは、期限が切れているか、すでに使われています。もう一度、再設定のメールを送ってください',
  )
  expect(screen.queryByRole('form', { name: '新しいパスワード' })).not.toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: '再設定のメールを送る' }))
  expect(window.location.hash).toBe('#/forgot')
})

test('使えないリンクを開いた後、同じタブで別の有効なリンクを開くと、フォームが出て再設定できる', async () => {
  const authClient = createMemoryAuthClient()
  const token = await memberWithResetToken(authClient)
  open('#/reset/broken-token')
  render(<App today={TODAY} authClient={authClient} />)
  setNewPassword(NEW_PASSWORD)
  expect(await screen.findByRole('alert')).toHaveTextContent(AUTH_MESSAGES.resetLinkUnusable)

  window.location.hash = `#/reset/${token}`
  expect(await screen.findByRole('form', { name: '新しいパスワード' })).toBeInTheDocument()
  // 送信の前に、アドレスからトークンが消えている
  await waitFor(() => expect(window.location.hash).toBe('#/reset'))
  setNewPassword(NEW_PASSWORD)
  expect(await screen.findByRole('status')).toHaveTextContent('パスワードを変更しました。ログインしてください')
})

test('期限切れ、正しくないリンクも、区別せず同じ表示になる', async () => {
  const authClient = createMemoryAuthClient()
  const token = await memberWithResetToken(authClient)
  authClient.expireResetTokens()
  const messages: string[] = []
  for (const given of [token, 'broken-token']) {
    open(`#/reset/${given}`)
    const { unmount } = render(<App today={TODAY} authClient={authClient} />)
    setNewPassword(NEW_PASSWORD)
    messages.push((await screen.findByRole('alert')).textContent ?? '')
    unmount()
  }
  expect(messages).toEqual([AUTH_MESSAGES.resetLinkUnusable, AUTH_MESSAGES.resetLinkUnusable])
})

test('読み込み直してトークンがなくなったとき（#/reset）は、「リンクをもう一度開いてください」と出し、フォームは出さない', () => {
  open('#/reset')
  render(<App today={TODAY} authClient={createMemoryAuthClient()} />)

  expect(screen.getByRole('alert')).toHaveTextContent('リンクをもう一度開いてください')
  expect(screen.queryByRole('form', { name: '新しいパスワード' })).not.toBeInTheDocument()
})

test.each([
  ['8文字未満', '1234567', AUTH_MESSAGES.passwordTooShort],
  ['空', '', AUTH_MESSAGES.emptyPassword],
])('新しいパスワードが%sときは、日本語のエラーを出し、変更しない（リンクは使えるまま）', async (_, password, message) => {
  const authClient = createMemoryAuthClient()
  const token = await memberWithResetToken(authClient)
  open(`#/reset/${token}`)
  render(<App today={TODAY} authClient={authClient} />)

  setNewPassword(password)
  expect(await form('新しいパスワード').findByRole('alert')).toHaveTextContent(message)
  expect(window.location.hash).toBe('#/reset')

  // 変更されていないので、古いパスワードでログインでき、同じリンクで決め直せる
  await authClient.signIn('alice@example.com', PASSWORD)
  setNewPassword(NEW_PASSWORD)
  expect(await screen.findByRole('status')).toHaveTextContent(AUTH_MESSAGES.passwordReset)
})

test('パスワードを再設定しても、メールアドレスの確認が済んだことにはならない', async () => {
  const authClient = createMemoryAuthClient()
  await authClient.signUp('alice@example.com', PASSWORD)
  await authClient.requestPasswordReset('alice@example.com')
  const token = authClient.mails.at(-1)?.token ?? ''
  open(`#/reset/${token}`)
  render(<App today={TODAY} authClient={authClient} />)

  setNewPassword(NEW_PASSWORD)
  expect(await screen.findByRole('status')).toHaveTextContent(AUTH_MESSAGES.passwordReset)
  await signIn('alice@example.com', NEW_PASSWORD)
  expect(await form('ログイン').findByRole('alert')).toHaveTextContent(AUTH_MESSAGES.emailNotVerified)
})

test('新しいパスワードを送る回数の上限を超えたときは、日本語のエラーを出す', async () => {
  const authClient = createMemoryAuthClient()
  const token = await memberWithResetToken(authClient)
  open(`#/reset/${token}`)
  render(<App today={TODAY} authClient={authClient} />)

  authClient.failNext(new AuthError(AUTH_MESSAGES.tooManyRequests))
  setNewPassword(NEW_PASSWORD)
  expect(await form('新しいパスワード').findByRole('alert')).toHaveTextContent(AUTH_MESSAGES.tooManyRequests)
})

test.each([
  ['パスワードが8文字より短い', 'alice@example.com', '1234567', AUTH_MESSAGES.passwordTooShort],
  ['メールアドレスの形が正しくない', 'alice.example.com', PASSWORD, AUTH_MESSAGES.invalidEmail],
  ['メールアドレスが空', '', PASSWORD, AUTH_MESSAGES.emptyCredentials],
])('会員登録で%sときは、日本語のエラーを出し、登録しない', async (_, email, password, message) => {
  const authClient = createMemoryAuthClient()
  open('#/signup')
  render(<App today={TODAY} authClient={authClient} />)

  await signUp(email, password)
  expect(await screen.findByRole('alert')).toHaveTextContent(message)
  expect(window.location.hash).toBe('#/signup')
  expect(await authClient.getSession()).toBeNull()
})

test('すでに登録されているメールアドレスで登録しようとしても、登録できたときと同じ表示にする', async () => {
  const authClient = createMemoryAuthClient()
  await authClient.signUp('alice@example.com', PASSWORD)
  open('#/signup')
  render(<App today={TODAY} authClient={authClient} />)

  await signUp('alice@example.com', 'another-password')
  expect(await screen.findByRole('status')).toHaveTextContent('確認のメールを送りました。メールのリンクを開いてください')
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(window.location.hash).toBe('#/signup')
  expect(await authClient.getSession()).toBeNull()
  expect(authClient.mails[1]).toEqual({ to: 'alice@example.com', kind: 'alreadyRegistered' })
})

test.each([
  ['パスワードが違う', 'alice@example.com', 'wrong-password'],
  ['存在しないメールアドレス', 'nobody@example.com', PASSWORD],
])('ログインで%sときは、日本語のエラーを出し、ログインしない', async (_, email, password) => {
  const authClient = createMemoryAuthClient()
  await authClient.signUp('alice@example.com', PASSWORD)
  authClient.verify('alice@example.com')
  open('#/login')
  render(<App today={TODAY} authClient={authClient} />)

  await signIn(email, password)
  expect(await screen.findByRole('alert')).toHaveTextContent(AUTH_MESSAGES.wrongCredentials)
  expect(window.location.hash).toBe('#/login')
  expect(await authClient.getSession()).toBeNull()
  // 入れたメールアドレスは残る
  expect(form('ログイン').getByLabelText('メールアドレス')).toHaveValue(email)
})

test('試す回数の上限を超えたときは、日本語のエラーを出す', async () => {
  const authClient = createMemoryAuthClient()
  await authClient.signUp('alice@example.com', PASSWORD)
  authClient.verify('alice@example.com')
  open('#/login')
  render(<App today={TODAY} authClient={authClient} />)

  authClient.failNext(new AuthError(AUTH_MESSAGES.tooManyRequests))
  await signIn('alice@example.com')
  expect(await screen.findByRole('alert')).toHaveTextContent('試す回数の上限を超えました')
  expect(window.location.hash).toBe('#/login')
})

test('ログアウトに失敗したときは、エラーを出し、ログイン中のまま', async () => {
  const authClient = createMemoryAuthClient()
  await authClient.signUp('alice@example.com', PASSWORD)
  authClient.verify('alice@example.com')
  await authClient.signIn('alice@example.com', PASSWORD)
  open('#/account')
  render(<App today={TODAY} authClient={authClient} />)

  const button = await screen.findByRole('button', { name: 'ログアウト' })
  authClient.failNext(new AuthError(AUTH_MESSAGES.connectionFailed))
  fireEvent.click(button)
  expect(await screen.findByRole('alert')).toHaveTextContent(`ログアウトできませんでした: ${AUTH_MESSAGES.connectionFailed}`)
  expect(screen.getByText('alice@example.com')).toBeInTheDocument()
})

test('ログインの状態を読み込めないときは、アカウントの画面にエラーを出す', async () => {
  const authClient = createMemoryAuthClient()
  authClient.failNext(new AuthError(AUTH_MESSAGES.connectionFailed))
  open('#/account')
  render(<App today={TODAY} authClient={authClient} />)

  expect(await screen.findByRole('alert')).toHaveTextContent(`ログインの状態を読み込めませんでした: ${AUTH_MESSAGES.connectionFailed}`)
  expect(screen.queryByRole('button', { name: 'ログアウト' })).not.toBeInTheDocument()
})

describe('アカウントの画面のプラン', () => {
  function signedIn() {
    return createMemoryAuthClient({ signedInAs: 'alice@example.com' })
  }

  test('無料のプランなら、記録の数と上限（プランの窓口の limit）を出す', async () => {
    const repository = createLocalStorageMealRepository()
    await repository.create({ date: TODAY, mealType: 'lunch', name: 'うどん', status: 'eaten' })
    await repository.create({ date: TODAY, mealType: 'dinner', name: 'カレー', status: 'planned' })
    open('#/account')
    render(<App today={TODAY} authClient={signedIn()} planClient={createMemoryPlanClient({ limit: 3, repository })} />)

    expect(await screen.findByText('プラン: 無料（記録 2 / 3 品）')).toBeInTheDocument()
  })

  test('有料のプランなら、記録の数と「上限なし」を出す', async () => {
    open('#/account')
    render(<App today={TODAY} authClient={signedIn()} planClient={createMemoryPlanClient({ plan: 'paid' })} />)

    expect(await screen.findByText('プラン: 有料（記録 0 品。上限なし）')).toBeInTheDocument()
  })

  test('プランだけを読み込めなかったときは、エラーを出し、メールアドレスとログアウトは使える', async () => {
    const authClient = createMemoryAuthClient()
    await authClient.signUp('alice@example.com', PASSWORD)
    authClient.verify('alice@example.com')
    await authClient.signIn('alice@example.com', PASSWORD)
    const planClient = createMemoryPlanClient()
    planClient.failNext(new Error('サーバーでエラーが起きました（500）'))
    open('#/account')
    render(<App today={TODAY} authClient={authClient} planClient={planClient} />)

    expect(await screen.findByRole('alert')).toHaveTextContent('プランを読み込めませんでした: サーバーでエラーが起きました（500）')
    expect(screen.getByText('alice@example.com')).toBeInTheDocument()
    expect(screen.queryByText(/プラン: /)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'ログアウト' }))
    expect(await screen.findByRole('form', { name: 'ログイン' })).toBeInTheDocument()
    expect(await authClient.getSession()).toBeNull()
  })

  test('プランを読むときにログインの期限が切れていたら、ログインの画面にする', async () => {
    const planClient = createMemoryPlanClient()
    planClient.failNext(new LoginExpiredError('ログインの期限が切れました。ログインし直してください'))
    open('#/account')
    render(<App today={TODAY} authClient={signedIn()} planClient={planClient} />)

    expect(await screen.findByRole('form', { name: 'ログイン' })).toBeInTheDocument()
  })
})

describe('退会', () => {
  async function openAccount(authClient = createMemoryAuthClient({ signedInAs: 'alice@example.com' })) {
    open('#/account')
    render(<App today={TODAY} authClient={authClient} planClient={createMemoryPlanClient()} />)
    await screen.findByRole('form', { name: '退会' })
    return authClient
  }

  function requestDelete(password: string) {
    fireEvent.change(form('退会').getByLabelText('パスワード'), { target: { value: password } })
    fireEvent.click(form('退会').getByRole('button', { name: '退会する' }))
  }

  test('ログイン中なら、ログアウトの下に退会の節と説明を出す', async () => {
    await openAccount()

    expect(screen.getByRole('heading', { name: '退会' })).toBeInTheDocument()
    expect(screen.getByText(/アカウントと、保存しているすべての記録が消え、元に戻せません/)).toBeInTheDocument()
    expect(screen.getByText(/バックアップには最長30日残ります/)).toBeInTheDocument()
    expect(screen.getByText(/先にデータ画面で記録を書き出してください/)).toBeInTheDocument()
    expect(screen.getByText(/同じメールアドレスで登録し直せますが、前の記録は戻りません/)).toBeInTheDocument()
    // ログアウトのボタンより後に出す
    const signOut = screen.getByRole('button', { name: 'ログアウト' })
    const deleteForm = screen.getByRole('form', { name: '退会' })
    expect(signOut.compareDocumentPosition(deleteForm) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  test('ログインしていなければ、退会の節は出さない', async () => {
    open('#/account')
    render(<App today={TODAY} authClient={createMemoryAuthClient()} />)

    expect(await screen.findByRole('form', { name: 'ログイン' })).toBeInTheDocument()
    expect(screen.queryByRole('form', { name: '退会' })).not.toBeInTheDocument()
  })

  test('パスワードが空なら送らず、日本語のエラーを出す', async () => {
    const authClient = await openAccount()

    requestDelete('')
    expect(await form('退会').findByRole('alert')).toHaveTextContent(AUTH_MESSAGES.emptyCurrentPassword)
    expect(screen.queryByRole('group', { name: '退会の確認' })).not.toBeInTheDocument()
    expect(await authClient.getSession()).toEqual({ email: 'alice@example.com' })
  })

  test('「退会する」を押しても、すぐには消さず、画面の中で確かめる。「やめる」で何も起きずに戻る', async () => {
    const authClient = await openAccount()

    requestDelete(MEMORY_MEMBER_PASSWORD)
    const confirm = screen.getByRole('group', { name: '退会の確認' })
    expect(confirm).toHaveTextContent('本当に退会しますか。この操作は取り消せません')
    expect(await authClient.getSession()).toEqual({ email: 'alice@example.com' })

    fireEvent.click(within(confirm).getByRole('button', { name: 'やめる' }))
    expect(screen.queryByRole('group', { name: '退会の確認' })).not.toBeInTheDocument()
    expect(form('退会').getByRole('button', { name: '退会する' })).toBeEnabled()
    expect(window.location.hash).toBe('#/account')
    expect(await authClient.getSession()).toEqual({ email: 'alice@example.com' })
    // 退会していないので、同じパスワードでログインし直せる
    await authClient.signOut()
    await expect(authClient.signIn('alice@example.com', MEMORY_MEMBER_PASSWORD)).resolves.toEqual({ email: 'alice@example.com' })
  })

  test('「退会を確定する」で退会し、ログインの画面に移って、お知らせを出す。前の会員の記録の画面は開けない', async () => {
    const authClient = await openAccount()

    requestDelete(MEMORY_MEMBER_PASSWORD)
    fireEvent.click(screen.getByRole('button', { name: '退会を確定する' }))

    expect(await screen.findByRole('status')).toHaveTextContent(AUTH_MESSAGES.accountDeleted)
    expect(window.location.hash).toBe('#/login/account-deleted')
    expect(screen.getByRole('form', { name: 'ログイン' })).toBeInTheDocument()
    // ログインしていないので、「記録の画面へ」は出さない
    expect(screen.queryByRole('button', { name: '記録の画面へ' })).not.toBeInTheDocument()
    expect(await authClient.getSession()).toBeNull()

    // 記録の画面を開くと、ログインの画面に移る
    window.location.hash = '#/'
    await waitFor(() => expect(window.location.hash).toBe('#/login'))
    expect(screen.queryByRole('heading', { name: 'meal-log' })).not.toBeInTheDocument()

    // 同じメールアドレスとパスワードではログインできない
    await signIn('alice@example.com', MEMORY_MEMBER_PASSWORD)
    expect(await form('ログイン').findByRole('alert')).toHaveTextContent(AUTH_MESSAGES.wrongCredentials)
  })

  test('処理中は、「退会を確定する」と「やめる」を押せない', async () => {
    const authClient = createMemoryAuthClient({ signedInAs: 'alice@example.com' })
    let finish: () => void = () => {}
    const original = authClient.deleteAccount.bind(authClient)
    authClient.deleteAccount = (password) =>
      new Promise<void>((resolve, reject) => {
        finish = () => original(password).then(resolve, reject)
      })
    await openAccount(authClient)

    requestDelete(MEMORY_MEMBER_PASSWORD)
    fireEvent.click(screen.getByRole('button', { name: '退会を確定する' }))
    expect(screen.getByRole('button', { name: '退会を確定する' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'やめる' })).toBeDisabled()

    finish()
    expect(await screen.findByRole('status')).toHaveTextContent(AUTH_MESSAGES.accountDeleted)
  })

  test('パスワードが違うときは、日本語のエラーを出し、アカウントの画面のまま（退会しない）', async () => {
    const authClient = await openAccount()

    requestDelete('wrong-password')
    fireEvent.click(screen.getByRole('button', { name: '退会を確定する' }))

    expect(await form('退会').findByRole('alert')).toHaveTextContent(AUTH_MESSAGES.wrongPassword)
    expect(window.location.hash).toBe('#/account')
    expect(screen.getByText('alice@example.com')).toBeInTheDocument()
    expect(form('退会').getByLabelText('パスワード')).toHaveValue('')
    expect(form('退会').getByRole('button', { name: '退会する' })).toBeEnabled()
    expect(await authClient.getSession()).toEqual({ email: 'alice@example.com' })
  })

  test.each([
    ['回数の上限を超えた', AUTH_MESSAGES.tooManyRequests],
    ['通信に失敗した', AUTH_MESSAGES.connectionFailed],
    ['サーバーでエラーが起きた', 'サーバーでエラーが起きました'],
  ])('%sときは、日本語のエラーを出し、アカウントの画面のまま', async (_, message) => {
    const authClient = await openAccount()

    requestDelete(MEMORY_MEMBER_PASSWORD)
    authClient.failNext(new AuthError(message))
    fireEvent.click(screen.getByRole('button', { name: '退会を確定する' }))

    expect(await form('退会').findByRole('alert')).toHaveTextContent(message)
    expect(window.location.hash).toBe('#/account')
    expect(await authClient.getSession()).toEqual({ email: 'alice@example.com' })
  })
})
