import { randomUUID } from 'node:crypto'
import { test as base, expect, type APIRequestContext } from '@playwright/test'
import { DEV_USER_HEADER } from '../server/devApi.ts'

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

/** テストの準備と確かめに使う、サーバーの API を直接呼ぶ窓口（テストの人の記録だけを扱う） */
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
function randomTestIp(): string {
  const byte = () => Math.floor(Math.random() * 256)
  return `198.${18 + Math.floor(Math.random() * 2)}.${byte()}.${byte()}`
}

type Fixtures = {
  /** テストの人のメールアドレス。テストごとに別の人にして、記録が混ざらないようにする */
  userEmail: string
  /** テストの人の記録を扱う、サーバーの API の窓口 */
  api: MealApi
}

/**
 * 画面を操作するテストの test。開発サーバーの API（server/devApi.ts）は、ヘッダー DEV_USER_HEADER の人として扱うので、
 * ブラウザの送るすべてのリクエストにテストの人のヘッダーを付ける
 */
// 第2引数（Playwright の use）は、React のフックと取り違えられないよう provide と呼ぶ
export const test = base.extend<Fixtures>({
  // eslint-disable-next-line no-empty-pattern
  userEmail: async ({}, provide) => {
    await provide(`e2e-${randomUUID()}@example.com`)
  },
  extraHTTPHeaders: async ({ userEmail }, provide) => {
    // 会員のログインの試す回数の上限は、IP アドレスごとに数える。テストごとに別の IP アドレスにして、混ざらないようにする
    // （開発サーバーは、このヘッダーがあればそのまま使う。server/devApi.ts）
    await provide({ [DEV_USER_HEADER]: userEmail, 'CF-Connecting-IP': randomTestIp() })
  },
  api: async ({ playwright, baseURL, userEmail }, provide) => {
    const request = await playwright.request.newContext({
      baseURL,
      extraHTTPHeaders: { [DEV_USER_HEADER]: userEmail, 'Content-Type': 'application/json' },
    })
    await provide(new MealApi(request))
    await request.dispose()
  },
})
