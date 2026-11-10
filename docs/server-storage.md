# サーバーに保存するときの手引き

> この手引きは、agent-env（`template-types/web/docs/`）の写しです。このファイルは直さないでください。実際の作りやサービスの画面と食い違う所、足りない所に気づいたら、実装エージェントは PR 本文の「気づいたこと」に「手引きへの指摘: …」と書き、相談役は所有者に agent-env で直すよう伝えます。agent-env で直した後、各プロジェクトの写しを差し替えます。

記録などをブラウザの中ではなくサーバーに保存したくなったときに読む手引きです。Cloudflare Pages Functions（API）と D1（データベース）と Access（ログイン）を使います。相談役は Issue を書くときに、実装エージェントは作るときに、この手引きに従います。

meal-log（食べたものの記録。nosuke223/meal-log）で実際に作ったときの決まりと、つまずいた所をまとめたものです。コードの例は meal-log の PR #35（API）、PR #36（画面の保存先の切り替え）、`docs/deploy.md`（公開の手順書）にあります。meal-log だけの事情（記録の項目、1人で使う前提の決まり）は、ここには書いていません。

## 1. 先に決めること（相談役が所有者に聞く）

| 決めること | おすすめ | 理由 |
| --- | --- | --- |
| 誰が使うか | 所有者だけ（Access でメールアドレスを1つだけ許可する） | ログインの画面や会員の管理を作らずに済む。人を増やすときは Access の許可を足すだけ |
| データを誰のものとして持つか | ログインした人のメールアドレスごとに分ける（すべての表に `user_email` の列） | 後から人が増えても、他の人のデータが見えない |
| 今あるデータ（ブラウザの中）をどうするか | 書き出しと読み込みの機能で移す（なければ先に作る） | 自動で移すと、失敗したときに戻せない |
| プレビューで保存を試すか | 試さない（プレビューには D1 をつながない） | プレビューに本番の D1 をつなぐと、本番のデータを読み書きする。試すなら、プレビュー用の D1 を別に作り、プレビューにも Access を掛ける |
| 分け方 | API（画面はまだ切り替えない）→ 画面の保存先の切り替え → 公開の手順書、の3つの Issue | 1つにすると大きすぎ、Codex の指摘の往復が上限に達しやすい |

## 2. 作りの決まり（実装エージェントが従う）

### ファイルの置き場所

| 場所 | 中身 |
| --- | --- |
| `functions/api/[[path]].ts` | `/api/` 以下のすべてのリクエストを受ける入口。処理は `server/` に書き、ここは呼ぶだけにする |
| `server/` | API の処理、認証、D1 への保存。単体テスト（`server/**/*.test.ts`）もここに置く |
| `migrations/0001_<内容>.sql` | 表の作り方。番号順に適用される。一度適用したファイルは変えず、変えるときは新しい番号のファイルを足す |
| `wrangler.dev.jsonc` | 手元とテスト専用の wrangler の設定（手元の D1 の名前とマイグレーションの場所だけ） |
| `tsconfig.server.json` | `functions/` と `server/` の型検査。`npm run build` の型検査に含める |

### wrangler の設定ファイルの名前

`wrangler.toml`、`wrangler.json`、`wrangler.jsonc` は作らない。Pages はこの名前のファイルを本番の設定として読み、ダッシュボードで D1 のバインディングや環境変数を設定できなくなる。手元用は `wrangler.dev.jsonc` のように別の名前にし、本番の D1 の ID は書かない（本番の設定は所有者が Cloudflare の画面で行う）。

### 認証（Access）

- Access を通ったリクエストには、ヘッダー `Cf-Access-Jwt-Assertion` に JWT が付く。API は、毎回これを検証して、ログインした人のメールアドレスを得る（Access で守っていても、API でも確かめる。守りを二重にする）
- 検証すること: 署名（RS256。公開鍵は `https://<チーム名>.cloudflareaccess.com/cdn-cgi/access/certs`。1時間ほど使い回し、知らない `kid` が来たら取り直す）、`iss`（`https://<チーム名>.cloudflareaccess.com`）、`aud`（AUD タグを含む）、`exp`、`nbf`、`email`。メールアドレスは小文字にそろえる
- 依存を増やさず Web Crypto（`crypto.subtle`）で書ける（meal-log の `server/auth.ts`）
- 環境変数: `ACCESS_TEAM_NAME`（チーム名。英数字とハイフンだけ受け付ける）、`ACCESS_AUD`（AUD タグ）。足りないときは 500 にし、ログインの失敗（401）と見分けられるようにする
- 手元の開発とテストでは認証を省きたい。専用の環境変数（例: `DEV_USER_EMAIL`）が設定されているときだけ省き、それ以外では必ず検証する。この変数は本番に設定しないと README と公開の手順書に書く

### データの読み書き

- すべての読み書きを、ログインした人のメールアドレスで絞る。他の人のデータを取得・更新・削除・取り込みできないことをテストで確かめる
- エラーは、状態コードと、種類のわかる本文（例: `{ "error": { "type": "NotFound", "message": "…" } }`）で返す。画面はこの種類で表示を分ける
- 画面の保存の窓口を、ブラウザ内のものとサーバーのものとで同じ形にする（すべての操作を非同期にしておく）。値の検査は両方で共有する
- 同時に書いたときの決まり（後の書き込みが先の変更を消さない、など）は、Codex がよく指摘する。どこまで守るかを Issue に書いておく（1人で使うなら「楽観ロックで割り込みを見つけたら読み直す」程度で足りる）
- 記録の ID をアドレスに入れるとき、`.` や `..` のような ID は URL の正規化で消える。ID の形を決めるか、受け付けない（meal-log PR #35 の Codex の指摘）

### テスト

- Vitest を、画面（`jsdom`）とサーバー（`node`）の2つのプロジェクトに分ける（`vite.config.ts` の `test.projects`）。サーバーのほうは、D1 の起動に時間がかかるので、タイムアウトを長めにする
- テストの D1 は、wrangler の `getPlatformProxy`（Miniflare）で、保存せずメモリーの中に作り、マイグレーションを適用してから使う（meal-log の `server/testDatabase.ts`）
- マイグレーションが手元の D1 に適用できることも、`wrangler d1 migrations apply DB --local --config wrangler.dev.jsonc --persist-to <一時的な場所>` を実行するテストで確かめる
- 画面のテスト（e2e）は、開発サーバーで `/api/` を手元の D1 につなぐ Vite のプラグインを使うと、本番と同じ API を通して確かめられる（meal-log の `server/devApi.ts`。`apply: 'serve'` で開発サーバーだけに入れ、ビルドには入れない）
- **手元では、D1 を使うテストを動かせない。** エージェントの sandbox はポートを開けない（`listen EPERM`）。GitHub 上のテスト（ジョブ `test`）で動かし、PR 本文の「確認方法」に、手元で動かせなかったテストを書く。失敗すれば、ランナーがログを渡して直させる

### `package.json` のスクリプト

| スクリプト | 中身 |
| --- | --- |
| `db:migrate:local` | `wrangler d1 migrations apply DB --local --config wrangler.dev.jsonc` |
| `dev` | `db:migrate:local` の後に `vite`（開発サーバーの API が手元の D1 を使う） |
| `dev:api`（任意） | ビルドして `wrangler pages dev dist --d1 DB=<手元の D1 の名前> --binding DEV_USER_EMAIL=dev@example.com`。本番に近い形で手元で動かす |

`wrangler` は開発用の依存に入れる。`.gitignore` に `.wrangler/`（手元の D1）と、所有者が本番のマイグレーションに使う設定ファイル（下の `wrangler.migrate.jsonc`）を入れる。

## 3. 公開の準備（所有者の作業。Issue の「所有者にしてほしいこと」に書く）

画面の名前や場所は、Cloudflare の更新で変わることがあります。詳しい手順と画面の表記は、meal-log の `docs/deploy.md` を見てください。ここでは、順番と、つまずいた所を書きます。プロジェクトごとの手順書は、3つ目の Issue（公開の手順書）で `docs/deploy.md` として作らせます。

前提: Pages のプロジェクトは、GitHub と接続してある（型の流れでは、プレビューのために最初に接続している）。main にマージすると、ビルド（`npm run build`）して、`functions/` も含めて自動で公開される。

1. **wrangler にログインする**: `npx wrangler login`。SSH で入った端末では、ログイン後の戻り先（`localhost:8976`）が届かないことがある。手元のマシンで行うか、`ssh -L 8976:localhost:8976 …` で転送する
2. **D1 を作る**: `npx wrangler d1 create <名前>`。出力の `database_id` を控える。出力の例にある `"binding"` の名前は使わず、コードが読む名前（例: `DB`）にする
3. **本番の D1 にマイグレーションを適用する**: `database_id` を書いた設定ファイルを `wrangler.migrate.jsonc`（コミットしない）として作り、`npx wrangler d1 migrations apply DB --remote --config wrangler.migrate.jsonc`
4. **Pages に D1 をつなぐ**: ダッシュボードの Pages のプロジェクト →「Settings」→「Bindings」で、D1 を `DB` の名前で「Production」につなぐ。「Preview」は、1. で決めたとおり（試さないならつながない）
5. **Zero Trust の最初の設定**: 初めてなら「Finish your account setup」が出る。チーム名を決め、プランを選ぶ（Free でよい）
6. **Access で本番を守る**: `pages.dev` のアドレスは、普通の Access のアプリケーションの作成画面では選べない。Pages の「Settings」→「General」→ Preview access の **Restrict previews** で自動で作られるアプリケーションを編集し、ホスト名を本番のもの（`<プロジェクト名>.pages.dev` とは限らない。名前が使われていると `meal-log-oqi.pages.dev` のように文字が付く）だけにする。Path は空にする（`/api` も守る）。ポリシーは、許可するメールアドレスだけにする
7. **値を控える**: AUD タグは、アプリケーションの編集画面の **Additional settings** のタブ。チーム名は、Zero Trust の **Overview** の **Team domain**（`<チーム名>.cloudflareaccess.com`）の前の部分（「Team name」は表示名なので使わない）
8. **環境変数を入れる**: `npx wrangler pages secret put ACCESS_TEAM_NAME --project-name <プロジェクト名>` と `ACCESS_AUD`。ダッシュボードで入れても効かなかったことがあるので、コマンドで入れる。`npx wrangler pages secret list --project-name <プロジェクト名>` で確かめる。開発用の `DEV_USER_EMAIL` が入っていないことも確かめる
9. **入れ直したら公開し直す**: 環境変数は次の公開から効く。ダッシュボードで最新の本番の公開をやり直す（Retry deployment）か、次のマージを待つ
10. **確かめる**: 本番のアドレスを開くと Access のログインが出て、許可したメールアドレスで入れる。Access の掛かっていないアドレス（公開ごとの `<ハッシュ>.<サブドメイン>.pages.dev`）に、ログインなしで `curl -i .../api/<何か>` を送ると 401 になる（500 なら環境変数がない、200 なら `DEV_USER_EMAIL` が入っていて危険）

表を増やしたとき（マイグレーションを足したとき）は、マージの前に 3. のコマンドで本番の D1 に適用する。適用済みのものは飛ばされる。
