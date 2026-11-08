import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

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
async function wrangler(...args: string[]): Promise<string> {
  const { stdout } = await run(
    process.execPath,
    [WRANGLER, ...args, '--local', '--config', 'wrangler.dev.jsonc', '--persist-to', persistDir],
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
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'meals'",
    )
    const result = JSON.parse(output) as { results: { name: string }[] }[]
    expect(result[0].results).toEqual([{ name: 'meals' }])

    // 2回目は、適用済みなので何もしない（失敗しない）
    await wrangler('d1', 'migrations', 'apply', 'DB')
  })
})
