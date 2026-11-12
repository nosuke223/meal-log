import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { applyMigrations, appliedMigrationNames } from './migrate'
import { MIGRATIONS } from './migrations.generated'
import { startTestDatabase } from './testDatabase'

const run = promisify(execFile)
const ROOT = fileURLToPath(new URL('..', import.meta.url))
const WRANGLER = join(ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js')

let persistDir: string

beforeAll(async () => {
  persistDir = await mkdtemp(join(tmpdir(), 'meal-log-d1-'))
})

afterAll(async () => {
  if (persistDir) await rm(persistDir, { recursive: true, force: true })
})

/** README に書いた手順（npm run db:migrate:local）と同じ wrangler のコマンドを、一時的な場所の D1 に対して実行する */
function wrangler(...args: string[]): Promise<string> {
  return wranglerAt(persistDir, ...args)
}

/** wrangler のコマンドを、dir に保存した D1 に対して実行する */
async function wranglerAt(dir: string, ...args: string[]): Promise<string> {
  const { stdout } = await run(
    process.execPath,
    [WRANGLER, ...args, '--local', '--config', 'wrangler.dev.jsonc', '--persist-to', dir],
    { cwd: ROOT, env: { ...process.env, CI: 'true', WRANGLER_SEND_METRICS: 'false' } },
  )
  return stdout
}

describe('D1 のマイグレーション', () => {
  it('手元の D1 に適用でき、記録の表ができる', async () => {
    await wrangler('d1', 'migrations', 'apply', 'DB')

    const output = await wrangler(
      'd1',
      'execute',
      'DB',
      '--json',
      '--command',
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'member_meals'",
    )
    const result = JSON.parse(output) as { results: { name: string }[] }[]
    expect(result[0].results).toEqual([{ name: 'member_meals' }])

    // 2回目は、適用済みなので何もしない（失敗しない）
    await wrangler('d1', 'migrations', 'apply', 'DB')
  })

  it('wrangler で当てた D1 を、アプリが当てる処理も適用済みと認め、二重に当てない', async () => {
    await wrangler('d1', 'migrations', 'apply', 'DB')
    // wrangler の --persist-to <場所> は、<場所>/v3 の下に保存する
    const database = await startTestDatabase({ migrate: false, persistPath: join(persistDir, 'v3') })
    try {
      const before = await appliedMigrationNames(database.db)
      expect(before).toEqual(MIGRATIONS.map((migration) => migration.name))

      let batches = 0
      await applyMigrations({
        prepare: (query) => database.db.prepare(query),
        batch: (statements) => {
          batches++
          return database.db.batch(statements)
        },
      })
      expect(batches).toBe(0)
      expect(await appliedMigrationNames(database.db)).toEqual(before)
    } finally {
      await database.dispose()
    }

    // アプリが当てた後でも、wrangler は適用済みと認める（失敗しない）
    await wrangler('d1', 'migrations', 'apply', 'DB')
  })

  it('アプリが当てた D1 を、wrangler も適用済みと認める', async () => {
    const appDir = await mkdtemp(join(tmpdir(), 'meal-log-d1-app-'))
    try {
      const database = await startTestDatabase({ persistPath: join(appDir, 'v3') })
      await database.dispose()

      const output = await wranglerAt(appDir, 'd1', 'migrations', 'list', 'DB')
      expect(output).toMatch(/No migrations to apply/)
    } finally {
      await rm(appDir, { recursive: true, force: true })
    }
  })
})
