// 表の変更（マイグレーション）を、アプリが自分のつながっている D1 に当てる。
// 当てたものは wrangler と同じ表 d1_migrations に記録するので、wrangler d1 migrations apply で当てた D1 とも食い違わない

import type { D1Database } from './d1'
import { MIGRATIONS } from './migrations.generated'

/** 1つのマイグレーション。name は migrations/ のファイル名（例: 0001_create_meals.sql） */
export type Migration = {
  name: string
  sql: string
}

// wrangler（d1 migrations apply）が作る表と同じ形
const CREATE_MIGRATIONS_TABLE = `CREATE TABLE IF NOT EXISTS d1_migrations(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE,
  applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
)`

/**
 * まだ当てていないマイグレーションを、名前の順（番号順）に当てる。
 * 1つのマイグレーションの SQL と記録は、1つの batch（トランザクション）で書くので、失敗したらどちらも残らない
 */
export async function applyMigrations(db: D1Database, migrations: readonly Migration[] = MIGRATIONS): Promise<void> {
  await db.prepare(CREATE_MIGRATIONS_TABLE).run()
  let applied = new Set(await appliedMigrationNames(db))
  for (const migration of [...migrations].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    if (applied.has(migration.name)) continue
    try {
      await db.batch([
        // 記録を先に書く。同時に別のリクエストが同じものを当てていたら、ここで名前が重なり、SQL を実行する前に batch ごと取り消される
        db.prepare('INSERT INTO d1_migrations (name) VALUES (?)').bind(migration.name),
        ...splitStatements(migration.sql).map((statement) => db.prepare(statement)),
      ])
    } catch (error) {
      // 別のリクエストが先に当てていたなら、記録を読み直して次に進む（二重に当てない）
      applied = new Set(await appliedMigrationNames(db))
      if (!applied.has(migration.name)) {
        throw new Error(`マイグレーション ${migration.name} を当てられませんでした`, { cause: error })
      }
    }
  }
}

/** d1_migrations に記録された名前を、名前の順（番号順）に返す */
export async function appliedMigrationNames(db: D1Database): Promise<string[]> {
  const { results } = await db.prepare('SELECT name FROM d1_migrations ORDER BY name').all<{ name: string }>()
  return results.map((row) => row.name)
}

/** SQL を文ごとに分ける（コメントの行は除く） */
export function splitStatements(sql: string): string[] {
  return sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .split(';')
    .map((statement) => statement.trim())
    .filter((statement) => statement !== '')
}
