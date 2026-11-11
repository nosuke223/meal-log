import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApiHandler, type ApiEnv } from './api'
import type { D1Database, D1PreparedStatement } from './d1'
import { applyMigrations, appliedMigrationNames, type Migration } from './migrate'
import { MIGRATIONS } from './migrations.generated'
import { dropAllTables, startTestDatabase, type TestDatabase } from './testDatabase'

// 空の D1 から始める（マイグレーションは、テストの中で当てる）
let database: TestDatabase

beforeAll(async () => {
  database = await startTestDatabase({ migrate: false })
})

afterAll(async () => {
  await database?.dispose()
})

beforeEach(async () => {
  await dropAllTables(database.db)
  vi.restoreAllMocks()
})

async function tableNames(): Promise<string[]> {
  const { results } = await database.db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name")
    .all<{ name: string }>()
  return results.map((row) => row.name)
}

async function countRows(table: string): Promise<number> {
  const row = await database.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).first<{ count: number }>()
  return row?.count ?? 0
}

/** 当てるたびに counter の行が1つ増えるマイグレーション（二重に当てたら分かる） */
const counted: Migration = {
  name: '0001_counter.sql',
  sql: '-- 数える表\nCREATE TABLE IF NOT EXISTS counter (x INTEGER);\nINSERT INTO counter VALUES (1);\n',
}

/** prerequisite の表がないと失敗するマイグレーション。途中までの書き込み（extra の表）が残らないかを見る */
const needsPrerequisite: Migration = {
  name: '0002_needs_prerequisite.sql',
  sql: 'CREATE TABLE extra (x INTEGER);\nINSERT INTO prerequisite VALUES (1);\n',
}

type DbHooks = {
  /** d1_migrations の記録を読んだ直後に呼ぶ */
  afterRead?: () => Promise<unknown>
  /** d1_migrations にかかわる文を作るたびに呼ぶ */
  onMigrationQuery?: (query: string) => void
  /** batch のたびに呼ぶ */
  onBatch?: () => void
}

/** 記録の読み書きを見張る D1。batch には D1 の文のまま渡す必要があるので、記録を読む文だけを包む */
function watchedDb(hooks: DbHooks): D1Database {
  const db = database.db
  return {
    prepare(query) {
      const statement = db.prepare(query)
      if (query.includes('d1_migrations')) hooks.onMigrationQuery?.(query)
      if (!query.startsWith('SELECT name FROM d1_migrations')) return statement
      const wrapped: D1PreparedStatement = {
        bind: (...values) => statement.bind(...values),
        first: <T>() => statement.first<T>(),
        run: <T>() => statement.run<T>(),
        all: async <T>() => {
          const result = await statement.all<T>()
          await hooks.afterRead?.()
          return result
        },
      }
      return wrapped
    },
    batch(statements) {
      hooks.onBatch?.()
      return db.batch(statements)
    },
  }
}

describe('マイグレーションを当てる処理', () => {
  it('空の D1 に全部を当てられ、meals の表ができて、記録が残る', async () => {
    await applyMigrations(database.db)

    expect(await tableNames()).toContain('meals')
    expect(await appliedMigrationNames(database.db)).toEqual(MIGRATIONS.map((migration) => migration.name))
    expect(MIGRATIONS.map((migration) => migration.name)).toContain('0001_create_meals.sql')
  })

  it('番号順に当てる（渡した順によらない）', async () => {
    const second: Migration = { name: '0002_add.sql', sql: 'ALTER TABLE counter ADD COLUMN y INTEGER;' }
    await applyMigrations(database.db, [second, counted])

    expect(await appliedMigrationNames(database.db)).toEqual(['0001_counter.sql', '0002_add.sql'])
  })

  it('2回目は何も当てない', async () => {
    await applyMigrations(database.db, [counted])
    let batches = 0
    await applyMigrations(watchedDb({ onBatch: () => batches++ }), [counted])

    expect(batches).toBe(0)
    expect(await countRows('counter')).toBe(1)
  })

  it('記録を読んでから当てるまでの間に、別の処理が同じものを当てても、1回だけ当たる', async () => {
    let interrupted = false
    const db = watchedDb({
      afterRead: async () => {
        if (interrupted) return
        interrupted = true
        await applyMigrations(database.db, [counted])
      },
    })

    await applyMigrations(db, [counted])
    expect(interrupted).toBe(true)
    expect(await countRows('counter')).toBe(1)
    expect(await appliedMigrationNames(database.db)).toEqual(['0001_counter.sql'])
  })

  it('同時に2つ動いても、1回だけ当たる', async () => {
    await Promise.all([applyMigrations(database.db, [counted]), applyMigrations(database.db, [counted])])

    expect(await countRows('counter')).toBe(1)
    expect(await appliedMigrationNames(database.db)).toEqual(['0001_counter.sql'])
  })

  it('途中で失敗したら、その SQL も記録も残らず、やり直せる', async () => {
    await expect(applyMigrations(database.db, [counted, needsPrerequisite])).rejects.toThrow(
      '0002_needs_prerequisite.sql',
    )
    expect(await tableNames()).not.toContain('extra')
    expect(await appliedMigrationNames(database.db)).toEqual(['0001_counter.sql'])

    await database.db.prepare('CREATE TABLE prerequisite (x INTEGER)').run()
    await applyMigrations(database.db, [counted, needsPrerequisite])
    expect(await tableNames()).toContain('extra')
    expect(await countRows('counter')).toBe(1)
    expect(await appliedMigrationNames(database.db)).toEqual(['0001_counter.sql', '0002_needs_prerequisite.sql'])
  })
})

const TEAM = 'meal-log-team'
const AUD = 'secret-aud-tag'

/** Access の設定はあるが、JWT を付けないリクエストを送る */
function createClient(options: Parameters<typeof createApiHandler>[0] = {}) {
  const handle = createApiHandler({ fetch: () => Promise.reject(new Error('公開鍵は取りに行かない')), ...options })
  return async function call(method: string, path: string, env: Partial<ApiEnv> = {}) {
    const request = new Request(`https://meal-log.example${path}`, { method })
    const response = await handle(request, { DB: database.db, ACCESS_TEAM_NAME: TEAM, ACCESS_AUD: AUD, ...env })
    const text = await response.text()
    return { status: response.status, headers: response.headers, text, body: text === '' ? null : JSON.parse(text) }
  }
}

describe('API の入口で当てる', () => {
  it('認証なしのリクエストでも、マイグレーションが当たり、API は 401 を返す', async () => {
    const call = createClient()
    const response = await call('GET', '/api/meals')

    expect(response.status).toBe(401)
    expect(response.body.error.type).toBe('Unauthorized')
    expect(await tableNames()).toContain('meals')
    expect(await appliedMigrationNames(database.db)).toEqual(MIGRATIONS.map((migration) => migration.name))
  })

  it('確かめるのは最初のリクエストのときだけ', async () => {
    const call = createClient()
    const queries: string[] = []
    const db = watchedDb({ onMigrationQuery: (query) => queries.push(query) })

    await call('GET', '/api/meals', { DB: db })
    expect(queries.length).toBeGreaterThan(0)
    queries.length = 0
    await call('GET', '/api/meals', { DB: db })
    expect(queries).toEqual([])
  })

  it('失敗したら 500（MigrationError）で詳しい内容は出さず、次のリクエストでやり直す', async () => {
    const call = createClient({ migrations: [counted, needsPrerequisite] })
    const logError = vi.spyOn(console, 'error').mockImplementation(() => {})

    const failed = await call('GET', '/api/health')
    expect(failed.status).toBe(500)
    expect(failed.body.error.type).toBe('MigrationError')
    expect(failed.text).not.toMatch(/prerequisite|INSERT|0002/)
    expect(logError).toHaveBeenCalled()
    expect(await tableNames()).not.toContain('extra')

    await database.db.prepare('CREATE TABLE prerequisite (x INTEGER)').run()
    const retried = await call('GET', '/api/health')
    expect(retried.status).toBe(200)
    expect(retried.body).toEqual({ migrations: ['0001_counter.sql', '0002_needs_prerequisite.sql'] })
  })

  it('DB がつながっていないときは 500（DatabaseNotConfigured）', async () => {
    const call = createClient()

    for (const path of ['/api/health', '/api/meals']) {
      const response = await call('GET', path, { DB: undefined })
      expect(response.status).toBe(500)
      expect(response.body.error.type).toBe('DatabaseNotConfigured')
      expect(response.headers.get('Cache-Control')).toBe('no-store')
    }
  })
})

describe('GET /api/health', () => {
  it('認証なしで 200 と、当てたマイグレーションの名前を番号順に返し、秘密の値は出さない', async () => {
    const call = createClient()
    const response = await call('GET', '/api/health')

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ migrations: MIGRATIONS.map((migration) => migration.name) })
    expect(response.body.migrations).toContain('0001_create_meals.sql')
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(response.text).not.toContain(TEAM)
    expect(response.text).not.toContain(AUD)
  })

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('%s は 405（Allow: GET）', async (method) => {
    const call = createClient()
    const response = await call(method, '/api/health')

    expect(response.status).toBe(405)
    expect(response.body.error.type).toBe('MethodNotAllowed')
    expect(response.headers.get('Allow')).toBe('GET')
    expect(response.headers.get('Cache-Control')).toBe('no-store')
  })

  it('記録を読めないときは 500 で、詳しい内容（SQL など）は出さない', async () => {
    const call = createClient()
    expect((await call('GET', '/api/health')).status).toBe(200)
    const brokenDb: D1Database = {
      prepare: () => database.db.prepare('SELECT * FROM no_such_table'),
      batch: (statements) => database.db.batch(statements),
    }
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const response = await call('GET', '/api/health', { DB: brokenDb })
    expect(response.status).toBe(500)
    expect(response.text).not.toMatch(/no_such_table|SELECT/)
  })
})
