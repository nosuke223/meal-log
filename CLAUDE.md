# プロジェクトのルール（AIエージェント向け）

実装エージェントの共通のルールは、agent ユーザーの `~/.claude/CLAUDE.md` にある（agent-env の `agent-user/CLAUDE.md`。直すときは agent-env で直す）。このファイルには、このプロジェクトに固有のことだけを書く。共通のルールと食い違うときは、このファイルを優先する。

## プロジェクト固有

- 概要: 食事記録アプリ。その日食べたものを記録し、カレンダーから過去の分も確認できる Web アプリ（食べる予定のものも入力できる）
- 言語・フレームワーク: TypeScript、React、Vite（Node.js と npm）
- テストコマンド: `npm run test`（Vitest、1回実行）、`npm run e2e`（Playwright、Chromium のみ。開発サーバーは自動で起動する）
- lint / format コマンド: `npm run lint`（ESLint）。型検査は `npm run build`。format 用のコマンドはない
- 読まなくてよいディレクトリ: `node_modules/`、`dist/`、`playwright-report/`、`test-results/`
- その他の注意: 依存は `npm ci` で入れる。`npm run e2e` の前に `npx playwright install chromium` が必要
