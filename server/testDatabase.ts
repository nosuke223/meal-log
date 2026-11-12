// テスト用の D1。wrangler（Miniflare）で手元に再現し、保存せずメモリーの中だけで使う

import { fileURLToPath } from 'node:url'
import { getPlatformProxy } from 'wrangler'
import type { D1Database } from './d1'
import { applyMigrations } from './migrate'

const CONFIG_PATH = fileURLToPath(new URL('../wrangler.dev.jsonc', import.meta.url))

export type TestDatabase = {
  db: D1Database
  /** 記録と会員をすべて消す（テストごとに呼ぶ） */
  reset(): Promise<void>
  dispose(): Promise<void>
}

export type TestDatabaseOptions = {
  /** マイグレーションを当てる（既定は当てる）。false なら空の D1 のまま返す */
  migrate?: boolean
  /** 保存先。wrangler の --persist-to に渡した場所の下の v3。省くと保存しない */
  persistPath?: string
}

/** 手元の D1 を起動し、マイグレーションを適用する（アプリが自分で当てるときと同じ処理で当てる） */
export async function startTestDatabase(options: TestDatabaseOptions = {}): Promise<TestDatabase> {
  const proxy = await getPlatformProxy<{ DB: D1Database }>({
    configPath: CONFIG_PATH,
    persist: options.persistPath === undefined ? false : { path: options.persistPath },
  })
  const db = proxy.env.DB
  if (options.migrate !== false) await applyMigrations(db)
  return {
    db,
    async reset() {
      // 会員の表は、会員（user）を参照する表から消す
      for (const table of ['member_meals', 'meals', 'session', 'account', 'verification', 'rateLimit', 'user']) {
        await db.prepare(`DELETE FROM "${table}"`).run()
      }
    },
    dispose: () => proxy.dispose(),
  }
}

/**
 * 一部の操作を差し替えた D1（割り込みや失敗を起こすテスト用）。差し替えない操作は、本物の D1 のものを使う。
 * ログインの仕組み（Better Auth）は exec のあるものを D1 と見分けるので、exec も本物のものを渡す
 */
export function overrideDatabase(db: D1Database, overrides: Partial<D1Database>): D1Database {
  const real = db as D1Database & { exec(query: string): Promise<unknown> }
  const database = {
    prepare: (query: string) => real.prepare(query),
    batch: <T>(statements: Parameters<D1Database['batch']>[0]) => real.batch<T>(statements),
    exec: (query: string) => real.exec(query),
    ...overrides,
  }
  return database as D1Database
}

/** 表をすべて消し、空の D1 に戻す（D1 が中で使う表は残す）。ほかの表から参照される表は後に消すよう、作った順の逆に消す */
export async function dropAllTables(db: D1Database): Promise<void> {
  const { results } = await db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY rowid DESC",
    )
    .all<{ name: string }>()
  for (const { name } of results) {
    await db.prepare(`DROP TABLE "${name}"`).run()
  }
}
