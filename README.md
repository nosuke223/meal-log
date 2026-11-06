# meal-log

その日食べたものを記録し、カレンダーから過去の分も確認できる食事記録の Web アプリです。食べる予定のものも入力できます。

現在は土台（開発・テスト・ビルドの環境）だけで、画面には見出し「meal-log」が表示されます。

## 必要な環境

- Node.js（LTS）と npm

## 使い方

```sh
npm ci
```

| コマンド | 内容 |
| --- | --- |
| `npm run dev` | 開発サーバーを起動する（<http://localhost:5173>） |
| `npm run lint` | ESLint で静的検査する |
| `npm run test` | Vitest を1回実行して終わる |
| `npm run build` | 型検査とビルドを行う（出力は `dist/`） |
| `npm run e2e` | Playwright（Chromium）で画面を操作するテストを実行する。開発サーバーは自動で起動する |

`npm run e2e` を初めて実行する前に、ブラウザを入れてください。

```sh
npx playwright install chromium
```
