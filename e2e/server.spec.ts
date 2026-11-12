import type { Browser, Page } from '@playwright/test'
import { createMember, expect, MealApi, MEMBER_PASSWORD, NO_COOKIES, signInMember, test, type Member } from './fixtures'

// 記録はサーバーに保存されるので、同じ会員なら、別のブラウザ（別の端末）でログインしても同じ記録が見える

test.use({ viewport: { width: 375, height: 667 } })

function section(page: Page, name: string) {
  return page.getByRole('region', { name, exact: true })
}

/** 別のブラウザ（cookie や localStorage を共有しない、新しいブラウザのコンテキスト）で、この会員としてアプリを開く */
async function openInAnotherBrowser(browser: Browser, baseURL: string | undefined, member: Member): Promise<Page> {
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 375, height: 667 },
    storageState: member.storageState,
  })
  const page = await context.newPage()
  await page.goto('/')
  return page
}

test('別のブラウザで開いても、同じ記録が見え、変更も反映される。別の会員には見えない', async ({
  page,
  browser,
  baseURL,
  playwright,
  member,
  api,
}) => {
  await page.goto('/')
  const morning = section(page, '朝')
  await morning.getByRole('textbox', { name: '新しい品名' }).fill('ごはん')
  await morning.getByRole('button', { name: '追加', exact: true }).click()
  await expect(morning.getByRole('button', { name: /ごはん/ })).toBeVisible()

  // 別の端末でログインした、別のセッション
  const otherSession = await signInMember(playwright, baseURL, member.email)
  const other = await openInAnotherBrowser(browser, baseURL, otherSession)
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
    await otherSession.request.dispose()
  }

  const strangerMember = await createMember(playwright, baseURL)
  const stranger = await openInAnotherBrowser(browser, baseURL, strangerMember)
  try {
    await expect(section(stranger, '朝')).toBeVisible()
    await expect(section(stranger, '朝').getByText('おにぎり')).toHaveCount(0)
    // 記録の ID を知っていても、別の会員の記録は取得も更新も削除もできない（404）
    const [record] = await api.records()
    for (const response of [
      await strangerMember.request.get(`/api/meal?id=${encodeURIComponent(record.id)}`),
      await strangerMember.request.patch(`/api/meal?id=${encodeURIComponent(record.id)}`, { data: { name: '書き換え' } }),
      await strangerMember.request.delete(`/api/meal?id=${encodeURIComponent(record.id)}`),
    ]) {
      expect(response.status()).toBe(404)
    }
    expect((await api.records()).map((stored) => stored.name)).toEqual(['おにぎり'])
    // 別の会員の窓口からは、記録が1件も見えない
    expect(await new MealApi(strangerMember.request).records()).toEqual([])
  } finally {
    await stranger.context().close()
    await strangerMember.request.dispose()
  }
})

test('ログインが切れると、ログインの画面に移り、期限切れの文言が出る。別の会員でログインしても、前の会員の記録は出ない', async ({
  page,
  api,
  playwright,
  baseURL,
}) => {
  await page.goto('/')
  const morning = section(page, '朝')
  await morning.getByRole('textbox', { name: '新しい品名' }).fill('ごはん')
  await morning.getByRole('button', { name: '追加', exact: true }).click()
  await expect(morning.getByRole('button', { name: /ごはん/ })).toBeVisible()

  // ほかの端末でパスワードを変えたときなどと同じく、このブラウザのセッションが使えなくなる
  await page.context().clearCookies()
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(page).toHaveURL(/#\/login\/session-expired$/)
  await expect(page.getByRole('alert')).toHaveText('ログインの期限が切れました。ログインし直してください')
  await expect(page.getByText('ごはん')).toHaveCount(0)

  // 別の会員でログインすると、今日の記録の画面に移り、前の会員の記録は出ない
  const other = await createMember(playwright, baseURL)
  try {
    const form = page.getByRole('form', { name: 'ログイン' })
    await form.getByLabel('メールアドレス').fill(other.email)
    await form.getByLabel('パスワード').fill(MEMBER_PASSWORD)
    await form.getByRole('button', { name: 'ログイン' }).click()
    await expect(page).toHaveURL(/#\/$/)
    await expect(section(page, '朝')).toBeVisible()
    await expect(page.getByText('ごはん')).toHaveCount(0)
    await page.getByRole('button', { name: 'カレンダー' }).click()
    await expect(page.getByRole('region', { name: '選んだ日の品' }).getByText('記録はありません')).toBeVisible()
  } finally {
    await other.request.dispose()
  }
  // 前の会員の記録は、サーバーには残っている
  expect((await api.records()).map((record) => record.name)).toEqual(['ごはん'])
})

test('ログアウトして別の会員でログインしても、前の会員の記録は出ない', async ({ page, member, playwright, baseURL }) => {
  await page.goto('/')
  const morning = section(page, '朝')
  await morning.getByRole('textbox', { name: '新しい品名' }).fill('ごはん')
  await morning.getByRole('button', { name: '追加', exact: true }).click()
  await expect(morning.getByRole('button', { name: /ごはん/ })).toBeVisible()

  await page.getByRole('button', { name: 'アカウント' }).click()
  await page.getByRole('button', { name: 'ログアウト' }).click()
  const form = page.getByRole('form', { name: 'ログイン' })
  await expect(form).toBeVisible()

  // ログアウトした後は、記録の画面を開くと、ログインの画面に移る（期限切れの文言は出ない）
  await page.goto('/#/')
  await expect(page).toHaveURL(/#\/login$/)
  await expect(page.getByRole('alert')).toHaveCount(0)

  const other = await createMember(playwright, baseURL)
  try {
    await form.getByLabel('メールアドレス').fill(other.email)
    await form.getByLabel('パスワード').fill(MEMBER_PASSWORD)
    await form.getByRole('button', { name: 'ログイン' }).click()
    await expect(page).toHaveURL(/#\/$/)
    await expect(section(page, '朝')).toBeVisible()
    await expect(page.getByText('ごはん')).toHaveCount(0)
  } finally {
    await other.request.dispose()
  }
  // ログアウトしたセッション（テストの窓口も、ブラウザと同じセッション）では、記録の API を使えない
  expect((await member.request.get('/api/meals')).status()).toBe(401)
  // 前の会員の記録は、サーバーには残っている
  const again = await signInMember(playwright, baseURL, member.email)
  try {
    expect((await new MealApi(again.request).records()).map((record) => record.name)).toEqual(['ごはん'])
  } finally {
    await again.request.dispose()
  }
})

test('ログインしていないと、記録、カレンダー、データの画面は開けず、ログインの画面に移る', async ({ browser, baseURL }) => {
  // 渡さないと、テストの会員のログインの cookie を使う（NO_COOKIES）
  const context = await browser.newContext({ baseURL, ...NO_COOKIES })
  try {
    const page = await context.newPage()
    for (const hash of ['#/', '#/day/2026-11-03', '#/calendar/2026-11', '#/data']) {
      await page.goto(`/${hash}`)
      await expect(page).toHaveURL(/#\/login$/)
      await expect(page.getByRole('form', { name: 'ログイン' })).toBeVisible()
      await expect(page.getByRole('alert')).toHaveCount(0)
    }
    // 記録の API も 401
    const response = await context.request.get('/api/meals')
    expect(response.status()).toBe(401)
  } finally {
    await context.close()
  }
})

test('ログインしていないと、ログインなどの画面に「記録の画面へ」を出さない。ログイン中は出し、今日の記録の画面に移る', async ({
  page,
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({ baseURL, ...NO_COOKIES })
  try {
    for (const [hash, heading] of [
      ['#/login', 'ログイン'],
      ['#/signup', '会員登録'],
      ['#/forgot', 'パスワードの再設定'],
      ['#/reset', '新しいパスワード'],
      ['#/account', 'ログイン'],
    ]) {
      // ログインの状態を確かめ終えてから、ボタンがないことを確かめる。
      // アドレスの # の後だけを変える goto は読み込み直さない（確かめ直さない）ので、画面ごとに新しいページで開く
      const signedOut = await context.newPage()
      const checked = signedOut.waitForResponse((response) => response.url().endsWith('/api/auth/get-session'))
      await signedOut.goto(`/${hash}`)
      await checked
      await expect(signedOut.getByRole('heading', { name: heading })).toBeVisible()
      await expect(signedOut.getByRole('button', { name: '記録の画面へ' })).toHaveCount(0)
      await expect(signedOut).toHaveURL(new RegExp(`${hash}$`))
    }
  } finally {
    await context.close()
  }

  // ログイン中（テストの会員）は、会員登録の画面にも出し、押すと今日の記録の画面に移る
  await page.goto('/#/signup')
  await page.getByRole('button', { name: '記録の画面へ' }).click()
  await expect(page).toHaveURL(/#\/$/)
  await expect(section(page, '朝')).toBeVisible()
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
  playwright,
  member,
}) => {
  await page.goto('/')
  const lunch = section(page, '昼')
  await expect(lunch).toBeVisible()
  // 入力の途中
  await lunch.getByRole('textbox', { name: '新しい品名' }).fill('おにぎり')
  await lunch.getByRole('group', { name: 'ジャンル' }).getByRole('button', { name: '和' }).click()

  const otherSession = await signInMember(playwright, baseURL, member.email)
  const other = await openInAnotherBrowser(browser, baseURL, otherSession)
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
    await otherSession.request.dispose()
  }
})
