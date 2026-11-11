import { fireEvent, render, screen, within } from '@testing-library/react'
import { expect, test } from 'vitest'
import App from '../App'
import { AUTH_MESSAGES, AuthError } from './authClient'
import { createMemoryAuthClient } from './memoryAuthClient'

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

test('記録の画面のヘッダーの「アカウント」で、アカウントの画面を開く。ログインしていなければ、ログインの画面を出す', async () => {
  render(<App today={TODAY} />)
  fireEvent.click(screen.getByRole('button', { name: 'アカウント' }))

  expect(window.location.hash).toBe('#/account')
  expect(await screen.findByRole('heading', { name: 'ログイン' })).toBeInTheDocument()
  expect(screen.getByRole('form', { name: 'ログイン' })).toBeInTheDocument()
})

test('会員登録すると、ログインした状態で今日の記録の画面に移り、アカウントの画面にメールアドレスとログアウトが出る', async () => {
  open('#/signup')
  render(<App today={TODAY} />)
  expect(screen.getByRole('heading', { name: '会員登録' })).toBeInTheDocument()

  await signUp('Alice@Example.com')
  await expectTodayScreen()

  fireEvent.click(screen.getByRole('button', { name: 'アカウント' }))
  expect(await screen.findByText('alice@example.com')).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'アカウント' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'ログアウト' })).toBeInTheDocument()
})

test('ログアウトすると、ログインの画面になり、もう一度ログインすると今日の記録の画面に移る', async () => {
  const authClient = createMemoryAuthClient()
  await authClient.signUp('alice@example.com', PASSWORD)
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

test('ログインの画面と会員登録の画面を、互いに行き来でき、「記録の画面へ」で今日の記録の画面に戻る', async () => {
  open('#/login')
  render(<App today={TODAY} />)

  fireEvent.click(screen.getByRole('button', { name: '会員登録へ' }))
  expect(window.location.hash).toBe('#/signup')
  expect(screen.getByRole('heading', { name: '会員登録' })).toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: 'ログインへ' }))
  expect(window.location.hash).toBe('#/login')
  expect(screen.getByRole('heading', { name: 'ログイン' })).toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: '記録の画面へ' }))
  await expectTodayScreen()
})

test('「パスワードを忘れた」のリンクは出さない', () => {
  open('#/login')
  render(<App today={TODAY} />)
  expect(screen.queryByText(/忘れ/)).not.toBeInTheDocument()
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

test('すでに登録されているメールアドレスで登録しようとすると、日本語のエラーを出す', async () => {
  const authClient = createMemoryAuthClient()
  await authClient.signUp('alice@example.com', PASSWORD)
  await authClient.signOut()
  open('#/signup')
  render(<App today={TODAY} authClient={authClient} />)

  await signUp('alice@example.com', 'another-password')
  expect(await screen.findByRole('alert')).toHaveTextContent(AUTH_MESSAGES.alreadyRegistered)
  expect(window.location.hash).toBe('#/signup')
  expect(await authClient.getSession()).toBeNull()
})

test.each([
  ['パスワードが違う', 'alice@example.com', 'wrong-password'],
  ['存在しないメールアドレス', 'nobody@example.com', PASSWORD],
])('ログインで%sときは、日本語のエラーを出し、ログインしない', async (_, email, password) => {
  const authClient = createMemoryAuthClient()
  await authClient.signUp('alice@example.com', PASSWORD)
  await authClient.signOut()
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
  await authClient.signOut()
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
