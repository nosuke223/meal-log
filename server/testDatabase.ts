// テスト用の D1。wrangler（Miniflare）で手元に再現し、保存せずメモリーの中だけで使う

import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { getPlatformProxy } from 'wrangler'
import type { D1Database } from './d1'

const CONFIG_PATH = fileURLToPath(new URL('../wrangler.dev.jsonc', import.meta.url))
const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations/', import.meta.url))

export type TestDatabase = {
  db: D1Database
  /** 記録をすべて消す（テストごとに呼ぶ） */
  reset(): Promise<void>
  dispose(): Promise<void>
}

/** 手元の D1 を起動し、マイグレーションを適用する */
export async function startTestDatabase(): Promise<TestDatabase> {
  const proxy = await getPlatformProxy<{ DB: D1Database }>({ configPath: CONFIG_PATH, persist: false })
  const db = proxy.env.DB
  for (const statement of migrationStatements()) {
    await db.prepare(statement).run()
  }
  return {
    db,
    async reset() {
      await db.prepare('DELETE FROM meals').run()
    },
    dispose: () => proxy.dispose(),
  }
}

/** マイグレーションのファイルを、名前の順に、文ごとに分けて返す（コメントの行は除く） */
function migrationStatements(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.sql'))
    .sort()
    .flatMap((file) =>
      readFileSync(`${MIGRATIONS_DIR}${file}`, 'utf8')
        .split('\n')
        .filter((line) => !line.trim().startsWith('--'))
        .join('\n')
        .split(';')
        .map((statement) => statement.trim())
        .filter((statement) => statement !== ''),
    )
}
