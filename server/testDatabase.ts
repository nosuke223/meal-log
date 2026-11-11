// テスト用の D1。wrangler（Miniflare）で手元に再現し、保存せずメモリーの中だけで使う

import { fileURLToPath } from 'node:url'
import { getPlatformProxy } from 'wrangler'
import type { D1Database } from './d1'
import { applyMigrations } from './migrate'

const CONFIG_PATH = fileURLToPath(new URL('../wrangler.dev.jsonc', import.meta.url))

export type TestDatabase = {
  db: D1Database
  /** 記録をすべて消す（テストごとに呼ぶ） */
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
      await db.prepare('DELETE FROM meals').run()
    },
    dispose: () => proxy.dispose(),
  }
}

/** 表をすべて消し、空の D1 に戻す（D1 が中で使う表は残す） */
export async function dropAllTables(db: D1Database): Promise<void> {
  const { results } = await db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'")
    .all<{ name: string }>()
  for (const { name } of results) {
    await db.prepare(`DROP TABLE "${name}"`).run()
  }
}
