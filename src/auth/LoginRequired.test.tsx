import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import App from '../App'
import { LOGIN_EXPIRED_MESSAGE } from '../meals/apiMealRepository'
import { createLocalStorageMealRepository } from '../meals/localStorageMealRepository'
import { LoginExpiredError, type MealRepository } from '../meals/mealRepository'
import { renderApp } from '../renderApp'
import { AUTH_MESSAGES, AuthError, type AuthClient } from './authClient'
import { createMemoryAuthClient, MEMORY_MEMBER_PASSWORD } from './memoryAuthClient'

// 記録、カレンダー、データの画面は、ログインしていないと開けない（ログインの画面に移る）

const TODAY = '2026-11-06'

function open(hash: string) {
  window.history.replaceState(null, '', hash)
}

function loginForm() {
  return within(screen.getByRole('form', { name: 'ログイン' }))
}

function signIn(email: string, password = MEMORY_MEMBER_PASSWORD) {
  const form = loginForm()
  fireEvent.change(form.getByLabelText('メールアドレス'), { target: { value: email } })
  fireEvent.change(form.getByLabelText('パスワード'), { target: { value: password } })
  fireEvent.click(form.getByRole('button', { name: 'ログイン' }))
}

async function addItem(sectionName: string, name: string) {
  const target = within(screen.getByRole('region', { name: sectionName }))
  fireEvent.change(target.getByRole('textbox', { name: '新しい品名' }), { target: { value: name } })
  fireEvent.click(target.getByRole('button', { name: '追加' }))
  await target.findByRole('button', { name: new RegExp(name) })
}

/** メモリーの中だけの Storage（会員ごとの保存先の代わり） */
function memoryStorage(): Storage {
  const data = new Map<string, string>()
  return {
    get length() {
      return data.size
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => {
      data.delete(key)
    },
    setItem: (key, value) => {
      data.set(key, value)
    },
  }
}

/**
 * サーバーの代わり。ログイン中の会員ごとに別の保存先を使う窓口と、その会員を覚えるログインの窓口。
 * ログインしていないときに記録を読み書きすると、サーバーと同じくログインの期限切れ（401）にする
 */
function createServer(signedInAs: string) {
  const authClient = createMemoryAuthClient({ signedInAs })
  let current: string | null = signedInAs
  const storages = new Map<string, Storage>()
  const trackingAuthClient: AuthClient = {
    ...authClient,
    async signIn(email, password) {
      const member = await authClient.signIn(email, password)
      current = member.email
      return member
    },
    async signOut() {
      await authClient.signOut()
      current = null
    },
  }
  function repositoryNow(): MealRepository {
    if (current === null) throw new LoginExpiredError(LOGIN_EXPIRED_MESSAGE)
    if (!storages.has(current)) storages.set(current, memoryStorage())
    return createLocalStorageMealRepository({ storage: storages.get(current) })
  }
  const repository: MealRepository = {
    listByDate: async (date) => repositoryNow().listByDate(date),
    listByDateRange: async (from, to) => repositoryNow().listByDateRange(from, to),
    get: async (id) => repositoryNow().get(id),
    create: async (input) => repositoryNow().create(input),
    update: async (id, changes) => repositoryNow().update(id, changes),
    delete: async (id) => repositoryNow().delete(id),
    markPlannedAsEatenBefore: async (date) => repositoryNow().markPlannedAsEatenBefore(date),
    listAll: async () => repositoryNow().listAll(),
    importRecords: async (records) => repositoryNow().importRecords(records),
  }
  return {
    authClient: trackingAuthClient,
    memoryAuthClient: authClient,
    repository,
    /** ログインの期限が切れた（ほかの端末でログアウトした、など）ことにする */
    expire() {
      current = null
    },
  }
}

describe('ログインしていないとき', () => {
  test.each([
    ['今日の記録', '#/'],
    ['その日の記録', '#/day/2026-11-03'],
    ['カレンダー', '#/calendar/2026-11'],
    ['データ', '#/data'],
  ])('%s の画面（%s）は開けず、ログインの画面（#/login）に移る。期限切れの文言は出さない', async (_, hash) => {
    open(hash)
    const historyLength = window.history.length
    await renderApp(<App today={TODAY} authClient={createMemoryAuthClient()} />)

    expect(await screen.findByRole('heading', { name: 'ログイン' })).toBeInTheDocument()
    expect(window.location.hash).toBe('#/login')
    expect(window.history.length).toBe(historyLength)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByText(AUTH_MESSAGES.sessionExpired)).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: '朝' })).not.toBeInTheDocument()
  })

  test('ログインすると、元の画面ではなく、今日の記録の画面に移る', async () => {
    const authClient = createMemoryAuthClient()
    await authClient.signUp('alice@example.com', MEMORY_MEMBER_PASSWORD)
    authClient.verify('alice@example.com')
    open('#/data')
    await renderApp(<App today={TODAY} authClient={authClient} />)

    signIn('alice@example.com')
    expect(await screen.findByRole('heading', { name: 'meal-log' })).toBeInTheDocument()
    expect(window.location.hash).toBe('#/')
    expect(screen.getByText('2026年11月6日（金）')).toBeInTheDocument()
  })

  test('ログインの画面、会員登録、「パスワードを忘れた」、再設定、アカウントの画面は、ログインなしで開ける', () => {
    for (const [hash, heading] of [
      ['#/login', 'ログイン'],
      ['#/signup', '会員登録'],
      ['#/forgot', 'パスワードの再設定'],
      ['#/reset', '新しいパスワード'],
    ]) {
      open(hash)
      const view = render(<App today={TODAY} authClient={createMemoryAuthClient()} />)
      expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument()
      expect(window.location.hash).toBe(hash)
      view.unmount()
    }
  })

  test.each([
    ['#/login', 'ログイン'],
    ['#/signup', '会員登録'],
    ['#/forgot', 'パスワードの再設定'],
    ['#/reset', '新しいパスワード'],
    ['#/account', 'ログイン'],
  ])('%s の画面には、「記録の画面へ」を出さない（確かめる前も、確かめた後も）', async (hash, heading) => {
    open(hash)
    const view = render(<App today={TODAY} authClient={createMemoryAuthClient()} />)
    // まだ確かめていないとき
    expect(screen.queryByRole('button', { name: '記録の画面へ' })).not.toBeInTheDocument()

    // 確かめた後（ログインしていない）
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)))
    expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '記録の画面へ' })).not.toBeInTheDocument()
    expect(window.location.hash).toBe(hash)
    view.unmount()
  })

  test('会員登録の画面から「ログインへ」で移ったログインの画面にも、「記録の画面へ」を出さない', async () => {
    open('#/signup')
    await renderApp(<App today={TODAY} authClient={createMemoryAuthClient()} />)

    fireEvent.click(screen.getByRole('button', { name: 'ログインへ' }))
    expect(screen.getByRole('heading', { name: 'ログイン' })).toBeInTheDocument()
    expect(window.location.hash).toBe('#/login')
    expect(screen.queryByRole('button', { name: '記録の画面へ' })).not.toBeInTheDocument()
  })

  test('ログインの状態を確かめられないときは、エラーを出し、「もう一度試す」で確かめ直せる', async () => {
    const authClient = createMemoryAuthClient({ signedInAs: 'alice@example.com' })
    authClient.failNext(new AuthError(AUTH_MESSAGES.connectionFailed))
    await renderApp(<App today={TODAY} authClient={authClient} />)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      `${AUTH_MESSAGES.sessionCheckFailed}: ${AUTH_MESSAGES.connectionFailed}`,
    )
    expect(screen.queryByRole('region', { name: '朝' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'もう一度試す' }))
    expect(await screen.findByRole('region', { name: '朝' })).toBeInTheDocument()
  })
})

describe('使っている途中でログインが切れたとき', () => {
  test('ログインの画面に移り、「ログインの期限が切れました。ログインし直してください」と出す。ログインし直すと記録が見える', async () => {
    const server = createServer('alice@example.com')
    await renderApp(<App today={TODAY} authClient={server.authClient} repository={server.repository} />)
    await addItem('朝', 'ごはん')

    server.expire()
    // 画面に戻ってきたときの読み直しで、API が 401 を返す
    act(() => {
      window.dispatchEvent(new Event('focus'))
    })
    expect(await screen.findByRole('heading', { name: 'ログイン' })).toBeInTheDocument()
    expect(window.location.hash).toBe('#/login/session-expired')
    expect(screen.getByRole('alert')).toHaveTextContent('ログインの期限が切れました。ログインし直してください')
    expect(screen.queryByText('ごはん')).not.toBeInTheDocument()

    signIn('alice@example.com')
    expect(await within(await screen.findByRole('region', { name: '朝' })).findByRole('button', { name: /ごはん/ })).toBeInTheDocument()
    expect(window.location.hash).toBe('#/')
  })

  test('保存しようとしたときに切れていても、ログインの画面に移る', async () => {
    const server = createServer('alice@example.com')
    open('#/calendar/2026-11')
    await renderApp(<App today={TODAY} authClient={server.authClient} repository={server.repository} />)
    fireEvent.click(await screen.findByRole('button', { name: '今日' }))
    await screen.findByRole('region', { name: '朝' })

    server.expire()
    const target = within(screen.getByRole('region', { name: '朝' }))
    fireEvent.change(target.getByRole('textbox', { name: '新しい品名' }), { target: { value: 'パン' } })
    fireEvent.click(target.getByRole('button', { name: '追加' }))
    expect(await screen.findByText(AUTH_MESSAGES.sessionExpired)).toBeInTheDocument()
    expect(window.location.hash).toBe('#/login/session-expired')
  })

  test('期限切れの文言は1回だけ出し、もう一度記録の画面を開くと、ただのログインの画面になる', async () => {
    const server = createServer('alice@example.com')
    await renderApp(<App today={TODAY} authClient={server.authClient} repository={server.repository} />)
    server.expire()
    act(() => {
      window.dispatchEvent(new Event('focus'))
    })
    expect(await screen.findByText(AUTH_MESSAGES.sessionExpired)).toBeInTheDocument()
    // ログインしていないので、「記録の画面へ」は出さない
    expect(screen.queryByRole('button', { name: '記録の画面へ' })).not.toBeInTheDocument()

    // アドレスを書き換えて、記録の画面を開く
    act(() => {
      window.history.pushState(null, '', '#/')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    expect(await screen.findByRole('form', { name: 'ログイン' })).toBeInTheDocument()
    expect(window.location.hash).toBe('#/login')
    expect(screen.queryByText(AUTH_MESSAGES.sessionExpired)).not.toBeInTheDocument()
  })
})

describe('別のタブでログインの状態が変わったとき', () => {
  /** 取り込むファイル（1件の記録） */
  function importFile() {
    const record = {
      id: 'x',
      date: TODAY,
      mealType: 'lunch',
      name: 'アリスのために選んだうどん',
      genre: 'other',
      dishType: 'main',
      status: 'eaten',
      createdAt: '2026-11-01T00:00:00.000Z',
      updatedAt: '2026-11-01T00:00:00.000Z',
    }
    return new File([JSON.stringify({ version: 1, records: [record] })], 'meal-log-2026-11-06.json', {
      type: 'application/json',
    })
  }

  test('別の会員に変わっていたら、タブに戻ったときに、取り込む前の確認を残さず、その会員の画面にする', async () => {
    const server = createServer('alice@example.com')
    await server.memoryAuthClient.signUp('bob@example.com', MEMORY_MEMBER_PASSWORD)
    server.memoryAuthClient.verify('bob@example.com')
    open('#/data')
    await renderApp(<App today={TODAY} authClient={server.authClient} repository={server.repository} />)
    fireEvent.change(screen.getByLabelText('読み込むファイル'), { target: { files: [importFile()] } })
    expect(await screen.findByRole('group', { name: '取り込みの確認' })).toBeInTheDocument()

    // 別のタブで、ログアウトしてボブでログインする
    await server.authClient.signOut()
    await server.authClient.signIn('bob@example.com', MEMORY_MEMBER_PASSWORD)
    act(() => {
      window.dispatchEvent(new Event('focus'))
    })
    await waitFor(() => expect(screen.queryByRole('group', { name: '取り込みの確認' })).not.toBeInTheDocument())
    expect(window.location.hash).toBe('#/data')
    expect(screen.queryByRole('button', { name: '取り込む' })).not.toBeInTheDocument()

    // ボブの記録には、アリスのために選んだ記録は入っていない
    expect(await server.repository.listAll()).toEqual([])
  })

  test('ログアウトしていたら、タブに戻ったときに、ログインの画面に移り、期限切れの文言を出す', async () => {
    const server = createServer('alice@example.com')
    await renderApp(<App today={TODAY} authClient={server.authClient} repository={server.repository} />)
    await addItem('朝', 'ごはん')

    // 別のタブでログアウトする
    await server.authClient.signOut()
    act(() => {
      window.dispatchEvent(new Event('focus'))
    })
    expect(await screen.findByText(AUTH_MESSAGES.sessionExpired)).toBeInTheDocument()
    expect(window.location.hash).toBe('#/login/session-expired')
    expect(screen.queryByText('ごはん')).not.toBeInTheDocument()
  })

  test('同じ会員のままなら、タブに戻ったときに、取り込む前の確認を残す', async () => {
    const server = createServer('alice@example.com')
    open('#/data')
    await renderApp(<App today={TODAY} authClient={server.authClient} repository={server.repository} />)
    fireEvent.change(screen.getByLabelText('読み込むファイル'), { target: { files: [importFile()] } })
    await screen.findByRole('group', { name: '取り込みの確認' })

    act(() => {
      window.dispatchEvent(new Event('focus'))
    })
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)))
    expect(screen.getByRole('group', { name: '取り込みの確認' })).toBeInTheDocument()
  })
})

describe('ログアウトしたとき', () => {
  test('別の会員でログインしても、前の会員の記録は画面に出ない', async () => {
    const server = createServer('alice@example.com')
    await server.memoryAuthClient.signUp('bob@example.com', MEMORY_MEMBER_PASSWORD)
    server.memoryAuthClient.verify('bob@example.com')
    await renderApp(<App today={TODAY} authClient={server.authClient} repository={server.repository} />)
    await addItem('朝', 'アリスのごはん')

    fireEvent.click(screen.getByRole('button', { name: 'アカウント' }))
    fireEvent.click(await screen.findByRole('button', { name: 'ログアウト' }))
    await screen.findByRole('form', { name: 'ログイン' })

    // ログアウトした後のログインの画面には、「記録の画面へ」を出さない
    expect(screen.queryByRole('button', { name: '記録の画面へ' })).not.toBeInTheDocument()

    // ログアウトした後に記録の画面を開くと、ログインの画面に移る
    act(() => {
      window.history.pushState(null, '', '#/')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    expect(await screen.findByRole('form', { name: 'ログイン' })).toBeInTheDocument()
    expect(window.location.hash).toBe('#/login')
    expect(screen.queryByText('アリスのごはん')).not.toBeInTheDocument()

    signIn('bob@example.com')
    const morning = within(await screen.findByRole('region', { name: '朝' }))
    await addItem('昼', 'ボブのうどん')
    expect(morning.queryByText('アリスのごはん')).not.toBeInTheDocument()
    expect(screen.queryByText('アリスのごはん')).not.toBeInTheDocument()

    // カレンダーにも出ない
    fireEvent.click(screen.getByRole('button', { name: 'カレンダー' }))
    expect(await within(screen.getByRole('table')).findByRole('button', { name: '11月6日 予定あり' })).toBeInTheDocument()
    expect(screen.queryByText('アリスのごはん')).not.toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: '選んだ日の品' })).getByText('ボブのうどん')).toBeInTheDocument()
  })
})
