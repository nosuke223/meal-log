import { randomUUID } from 'node:crypto'
import {
  test as base,
  expect,
  type APIRequestContext,
  type BrowserContextOptions,
  type PlaywrightWorkerArgs,
} from '@playwright/test'
import { DEV_MAILS_PATH } from '../server/devApi.ts'

export { expect }

/** 保存されている記録（API の応答の形） */
export type StoredRecord = {
  id: string
  date: string
  mealType: string
  name: string
  genre: string | null
  dishType: string | null
  status: string
  createdAt: string
  updatedAt: string
}

/** テストの準備と確かめに使う、サーバーの API を直接呼ぶ窓口（ログインした会員の cookie で、その会員の記録だけを扱う） */
export class MealApi {
  private readonly request: APIRequestContext

  constructor(request: APIRequestContext) {
    this.request = request
  }

  /** 記録を、ID と日時を保ったまま保存する */
  async seed(records: StoredRecord[]): Promise<void> {
    if (records.length === 0) return
    const response = await this.request.post('/api/import', { data: { records } })
    expect(response.status(), await response.text()).toBe(204)
  }

  /** 保存されている記録をすべて取得する */
  async records(): Promise<StoredRecord[]> {
    const response = await this.request.get('/api/meals')
    expect(response.status(), await response.text()).toBe(200)
    return ((await response.json()) as { meals: StoredRecord[] }).meals
  }

  /** 保存されている記録をすべて削除する */
  async clear(): Promise<void> {
    for (const record of await this.records()) {
      const response = await this.request.delete(`/api/meal?id=${encodeURIComponent(record.id)}`)
      expect(response.status(), await response.text()).toBe(204)
    }
  }
}

/** テスト用の IP アドレス（198.18.0.0/15 は、試験用に取ってある範囲） */
export function randomTestIp(): string {
  const byte = () => Math.floor(Math.random() * 256)
  return `198.${18 + Math.floor(Math.random() * 2)}.${byte()}.${byte()}`
}

type Playwright = PlaywrightWorkerArgs['playwright']

/**
 * cookie のない状態。browser.newContext と playwright.request.newContext は、渡さなかった設定に、
 * テストの設定（テストの会員のログインの cookie を含む storageState）を使うので、別の会員やログインしていない状態にするときに渡す
 */
export const NO_COOKIES = { storageState: { cookies: [], origins: [] } }

/** テストの会員のパスワード */
export const MEMBER_PASSWORD = 'e2e-password-123'

/** ログインした会員 */
export type Member = {
  email: string
  /** ログインの cookie を持った、API を呼ぶ窓口 */
  request: APIRequestContext
  /** ブラウザに渡す、ログインの cookie */
  storageState: Exclude<BrowserContextOptions['storageState'], string | undefined>
}

/**
 * 会員をログインさせる（別の端末でログインしたときと同じく、新しいセッションを作る）。
 * 試す回数の上限に当たらないよう、呼ぶたびに別の接続元（CF-Connecting-IP）にする
 */
export async function signInMember(playwright: Playwright, baseURL: string | undefined, email: string): Promise<Member> {
  const request = await playwright.request.newContext({
    baseURL,
    extraHTTPHeaders: { 'Content-Type': 'application/json', 'CF-Connecting-IP': randomTestIp() },
    ...NO_COOKIES,
  })
  const response = await request.post('/api/auth/sign-in/email', {
    data: { email, password: MEMBER_PASSWORD },
    headers: { Origin: new URL(baseURL ?? '').origin },
  })
  expect(response.status(), await response.text()).toBe(200)
  return { email, request, storageState: await request.storageState() }
}

/**
 * 会員を作ってログインする。API で会員登録し、開発サーバーにためた確認のメール（DEV_MAILS_PATH）のリンクを開いて確認してから、
 * ログインする
 */
export async function createMember(playwright: Playwright, baseURL: string | undefined): Promise<Member> {
  const email = `e2e-${randomUUID()}@example.com`
  const request = await playwright.request.newContext({
    baseURL,
    extraHTTPHeaders: { 'Content-Type': 'application/json', 'CF-Connecting-IP': randomTestIp() },
    ...NO_COOKIES,
  })
  try {
    const signedUp = await request.post('/api/auth/sign-up/email', {
      data: { email, password: MEMBER_PASSWORD, name: '' },
      headers: { Origin: new URL(baseURL ?? '').origin },
    })
    expect(signedUp.status(), await signedUp.text()).toBe(200)

    let link: string | undefined
    await expect
      .poll(async () => {
        const response = await request.get(`${DEV_MAILS_PATH}?to=${encodeURIComponent(email)}`)
        const { mails } = (await response.json()) as { mails: { text: string }[] }
        link = /http:\/\/\S+\/api\/auth\/verify-email\?token=\S+/.exec(mails[0]?.text ?? '')?.[0]
        return link
      })
      .toBeDefined()
    const verified = await request.get(link as string, { maxRedirects: 0 })
    expect(verified.headers().location).toMatch(/#\/login\/verified$/)
  } finally {
    await request.dispose()
  }
  return signInMember(playwright, baseURL, email)
}

type Options = {
  /** テストを、ログインした会員の状態から始めるか（既定は始める）。会員登録やログインそのものを試すテストでは false にする */
  signedIn: boolean
}

type Fixtures = {
  /** テストごとに作った、ログインした会員。記録が混ざらないよう、テストごとに別の会員にする */
  member: Member
  /** テストの会員の記録を扱う、サーバーの API の窓口 */
  api: MealApi
}

/** signedIn のときに作った会員（ログインしないテストでは null） */
type InternalFixtures = { signedInMember: Member | null }

/**
 * 画面を操作するテストの test。テストごとに会員を作ってログインし、その cookie で、画面（ブラウザ）と
 * テストの準備・確かめ用の API の窓口（api）の両方を動かす
 */
// 第2引数（Playwright の use）は、React のフックと取り違えられないよう provide と呼ぶ
export const test = base.extend<Fixtures & Options & InternalFixtures>({
  signedIn: [true, { option: true }],
  signedInMember: async ({ signedIn, playwright, baseURL }, provide) => {
    const member = signedIn ? await createMember(playwright, baseURL) : null
    await provide(member)
    await member?.request.dispose()
  },
  member: async ({ signedInMember }, provide) => {
    if (signedInMember === null) throw new Error('ログインしないテスト（signedIn: false）では、member は使えません')
    await provide(signedInMember)
  },
  storageState: async ({ signedInMember }, provide) => {
    await provide(signedInMember?.storageState)
  },
  // eslint-disable-next-line no-empty-pattern
  extraHTTPHeaders: async ({}, provide) => {
    // 会員のログインの試す回数の上限は、IP アドレスごとに数える。テストごとに別の IP アドレスにして、混ざらないようにする
    // （開発サーバーは、このヘッダーがあればそのまま使う。server/devApi.ts）
    await provide({ 'CF-Connecting-IP': randomTestIp() })
  },
  api: async ({ member }, provide) => {
    await provide(new MealApi(member.request))
  },
})
