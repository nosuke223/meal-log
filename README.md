# meal-log

その日食べたものを記録し、カレンダーから過去の分も確認できる食事記録の Web アプリです。食べる予定のものも入力できます。

現在は、今日の食事を記録する画面があります。カレンダー、予定の入力はまだありません。

## 画面でできること

スマホの縦画面を優先した1画面です。端末の現地の今日の日付と、朝・昼・夜・間食の4つの欄が表示されます（記録がなくても欄は表示されます）。

- 品の追加: 欄ごとに品名を入力して「追加」を押す。「食べた」状態で保存され、欄の中は作成した順に並ぶ。品名が空（空白だけ）のときは押せない
- ジャンル（和・洋・中・その他）と料理の分類（主食・主菜・副菜・汁物・その他）: ボタンで選ぶ。選んだボタンをもう一度押すと未設定に戻る
  - 追加するとき、ジャンルは同じ区分の直前の品のものが最初から選ばれる（押して外せる）。料理の分類は引き継がない
- 品の変更・削除: 追加済みの品をタップすると、品名、ジャンル、料理の分類、区分を変更できる。区分を変えると、変更先の欄に移る。「削除」は確認の後に行う
- エラー: 保存データが壊れているなど、読み込みや保存に失敗したときは画面にエラーを表示する。保存データは上書きしない
- 保存先は、ブラウザ内（localStorage）。画面の部品は「保存の窓口」だけを使う

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

## 記録の形

記録は1件が1品です。形は `src/meals/mealRecord.ts` の `MealRecord` にあります。

| 項目 | 内容 | 値 |
| --- | --- | --- |
| `id` | 他の記録と重ならない ID | UUID の文字列（窓口が付ける） |
| `date` | 食べた日／食べる予定の日 | `YYYY-MM-DD`（端末の現地の日付。`toLocalDateString` で作れる） |
| `mealType` | 区分 | `breakfast`（朝）、`lunch`（昼）、`dinner`（夜）、`snack`（間食） |
| `name` | 品名 | 必須。空白だけは不可。前後の空白は取り除いて保存する |
| `genre` | ジャンル | `japanese`（和）、`western`（洋）、`chinese`（中）、`other`（その他）、`null`（未設定） |
| `dishType` | 料理の分類 | `staple`（主食）、`main`（主菜）、`side`（副菜）、`soup`（汁物）、`other`（その他）、`null`（未設定） |
| `status` | 状態 | `planned`（予定）、`eaten`（食べた） |
| `createdAt` / `updatedAt` | 作成・更新の日時 | ISO 8601 の文字列（UTC。窓口が付ける） |

## 保存の窓口

画面からは、保存の窓口 `MealRepository`（`src/meals/mealRepository.ts`）だけを使います。localStorage を直接使わないでください。
保存先をサーバーに差し替えても同じ使い方ができるよう、すべての操作は非同期（`Promise` を返す）です。

| 操作 | 内容 |
| --- | --- |
| `listByDate(date)` | 指定した日の記録を取得する |
| `listByDateRange(from, to)` | `from` から `to` まで（両端の日を含む）の記録を取得する（カレンダー用） |
| `get(id)` | 1件取得する。なければ `null` |
| `create(input)` | 作成する。`genre` と `dishType` は省略すると未設定（`null`） |
| `update(id, changes)` | 渡した項目だけを更新する。`updatedAt` は変わり、`createdAt` は変わらない |
| `delete(id)` | 削除する |

取得した記録は、日付 → 区分（朝・昼・夜・間食の順）→ 作成日時の順に並びます。

エラーになる場合:

- 不正な値（品名が空、日付の書式が違う・実在しない日、区分・ジャンル・料理の分類・状態が決まった値でない、期間の始まりが終わりより後）: `MealValidationError`
- 存在しない ID の更新・削除: `MealNotFoundError`
- 保存データが壊れている、または対応していないバージョン: `MealStorageError`（保存データは上書きしない）

### ブラウザ内の保存

`createLocalStorageMealRepository()`（`src/meals/localStorageMealRepository.ts`）は、localStorage に保存する窓口を作ります。

- キー `meal-log:meals` に、`{ "version": 1, "records": [...] }` の形の JSON で保存する
- `version` は保存データの形のバージョン番号。形を変えたら上げる
