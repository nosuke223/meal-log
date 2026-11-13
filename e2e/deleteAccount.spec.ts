import { expect, MEMBER_PASSWORD, test } from './fixtures'

// 退会。開発サーバーの API（手元の D1）で、会員を作って記録を入れ、アカウントの画面から退会する

test.use({ viewport: { width: 375, height: 667 } })

test('アカウントの画面から退会すると、ログインの画面にお知らせが出て、同じメールアドレスとパスワードではログインできない', async ({
  page,
  member,
  api,
}) => {
  await api.seed([
    {
      id: 'e2e-delete-1',
      date: '2026-11-11',
      mealType: 'lunch',
      name: 'うどん',
      genre: null,
      dishType: null,
      status: 'eaten',
      createdAt: '2026-11-11T03:00:00.000Z',
      updatedAt: '2026-11-11T03:00:00.000Z',
    },
  ])

  await page.goto('/#/account')
  const deleteForm = page.getByRole('form', { name: '退会' })
  await expect(deleteForm).toBeVisible()
  await expect(page.getByText(member.email, { exact: true })).toBeVisible()

  // 間違ったパスワードでは断られ、アカウントの画面のまま
  await deleteForm.getByLabel('パスワード').fill('wrong-password')
  await deleteForm.getByRole('button', { name: '退会する' }).click()
  await page.getByRole('button', { name: '退会を確定する' }).click()
  await expect(deleteForm.getByRole('alert')).toHaveText('パスワードが違います')
  await expect(page).toHaveURL(/#\/account$/)
  expect(await api.records()).toHaveLength(1)

  // 正しいパスワードで、画面の中の確認を経て退会する
  await deleteForm.getByLabel('パスワード').fill(MEMBER_PASSWORD)
  await deleteForm.getByRole('button', { name: '退会する' }).click()
  await expect(page.getByRole('group', { name: '退会の確認' })).toContainText('本当に退会しますか。この操作は取り消せません')
  await page.getByRole('button', { name: '退会を確定する' }).click()

  await expect(page).toHaveURL(/#\/login\/account-deleted$/)
  await expect(page.getByRole('status')).toHaveText('退会しました。ご利用ありがとうございました')
  expect((await page.context().cookies()).find((cookie) => cookie.name.endsWith('session_token'))).toBeUndefined()

  // 記録の画面を開くと、ログインの画面に移る
  await page.goto('/#/')
  await expect(page).toHaveURL(/#\/login$/)
  await expect(page.getByRole('heading', { name: 'meal-log' })).toHaveCount(0)

  // 同じメールアドレスとパスワードではログインできない
  const loginForm = page.getByRole('form', { name: 'ログイン' })
  await loginForm.getByLabel('メールアドレス').fill(member.email)
  await loginForm.getByLabel('パスワード').fill(MEMBER_PASSWORD)
  await loginForm.getByRole('button', { name: 'ログイン' }).click()
  await expect(loginForm.getByRole('alert')).toHaveText('メールアドレスかパスワードが違います')

  // 前のログインの cookie で、記録の API は使えない
  expect((await member.request.get('/api/meals')).status()).toBe(401)
})
