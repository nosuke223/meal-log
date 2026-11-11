// migrations/*.sql を、アプリに含める TypeScript のファイル（server/migrations.generated.ts）に書き出す。
// package.json の prebuild、pretest などから、ビルドやテストの前に動かす。書き出したファイルはコミットしない

import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations/', import.meta.url))
const OUTPUT = fileURLToPath(new URL('../server/migrations.generated.ts', import.meta.url))

// 名前の順（番号順）。wrangler の migrations apply と同じ順にする
const migrations = readdirSync(MIGRATIONS_DIR)
  .filter((file) => file.endsWith('.sql'))
  .sort()
  .map((name) => ({ name, sql: readFileSync(`${MIGRATIONS_DIR}${name}`, 'utf8') }))

const content = `// scripts/bundle-migrations.mjs が migrations/*.sql から作るファイル。直さない（コミットもしない）

import type { Migration } from './migrate'

export const MIGRATIONS: readonly Migration[] = ${JSON.stringify(migrations, null, 2)}
`

writeFileSync(OUTPUT, content)
