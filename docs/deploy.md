# Cloudflare への公開と Access の設定手順

作った画面と API を Cloudflare Pages（画面と Pages Functions）と D1（データベース）に公開し、Cloudflare Access で所有者だけが開けるようにする手順です。上から順に行ってください。main にマージすると、Cloudflare が自動で本番にデプロイします（Cloudflare Pages を GitHub の `nosuke223/meal-log` につないであります）。表の変更（マイグレーション）は、アプリ（API）が、公開された後の最初のリクエストで、自分のつながっている D1 に当てます（手で当てる手順2は、緊急のときの予備です。「更新するとき」）。

記録の API は、会員のログイン（Better Auth のセッションの cookie）で本人を確かめ、会員ごとに記録を分けます（README の「認証」）。API は Access のログインの情報（JWT）を見ません。Access は、公開の準備（Access を外す Issue）までの間、ホスト全体を所有者だけが開けるように守るものとして残ります。

`<…>` の部分は、自分の値に置き換えます。値（ID、秘密の値など）はリポジトリに書かず、Cloudflare の画面と手元のメモにだけ残してください。

## 全体像と、決めておく値

| 名前 | 内容 | この文書での例 |
| --- | --- | --- |
| D1 のデータベース名 | 記録を入れるデータベース | `meal-log` |
| Pages のプロジェクト名 | 公開するサイト | `meal-log` |
| 実際の本番のアドレス | 手順3-2の最初のデプロイ後に確かめる。`<プロジェクト名>.pages.dev` とは限らない（下の注意） | `<本番のホスト名>`（例: `meal-log-oqi.pages.dev`） |
| 所有者のメールアドレス | Access で許可する人 | `<自分のメールアドレス>` |

> **注意**: 「meal-log」の名前がすでに他で使われていると、アドレスに文字が付きます（例: `meal-log-oqi.pages.dev`）。実際の本番のアドレスは、ダッシュボードの「Workers & Pages」→ `meal-log` で確かめます。手順4（Access で守るホスト名）と手順7では、この `<本番のホスト名>` を使います。

アプリが読む環境変数とバインディングは次のとおりです（詳しくは README の「環境変数」）。

| 名前 | 内容 | 設定する場所 |
| --- | --- | --- |
| `DB` | D1 のバインディング。本番とプレビューで別の D1 | 手順3（本番）、手順9-1（プレビュー） |
| `BETTER_AUTH_SECRET` | 会員のログイン（Better Auth）の秘密の値。本番とプレビューで別の値。**本番で必須**（ないと記録の API も 500） | 手順5（本番）、手順9-2（プレビュー） |
| `RESEND_API_KEY` | メールを送る Resend の API キー（秘密の値）。**本番で必須**（ないと会員登録できない） | 手順5（本番）、手順10（プレビュー） |
| `MAIL_FROM` | メールの送信元のアドレス。**本番で必須** | 手順5（本番）、手順10（プレビュー） |
| `MAIL_ALLOWED_TO` | プレビュー専用。このアドレスにしかメールを送らない。**本番には設定しない** | 手順10（プレビューだけ）。本番にないことを手順6で確かめる |
| `FREE_PLAN_RECORD_LIMIT` | プレビュー専用（任意）。無料のプランで保存できる記録の数（ないときは 300 品）。上限を手早く試すためのもの。**本番には設定しない** | 手順11-3（プレビューだけ）。本番にないことを手順6で確かめる |

開発用の値（名前が `DEV_` で始まるもの）は、手元の `npm run dev` と `npm run dev:api` が起動するときだけ使います。本番にもプレビューにも設定しません（手順6）。

## 事前の準備

- Cloudflare のアカウントがある
- Zero Trust（Access）が使える。初めて Zero Trust を開くと、アプリケーションの一覧ではなく「Finish your account setup」と出ます。次の順で進めます
  1. チーム名を決める画面が出たら、チーム名を決める（Access のログイン画面のアドレス `<チーム名>.cloudflareaccess.com` に使われる）
  2. **Choose a plan** でプランを選ぶ（Free でよい）
- このリポジトリを手元に clone し、`npm ci` で依存を入れてある
- wrangler にログインしてある

```sh
npx wrangler login
```

> **注意**: `wrangler login` は、ブラウザが開ける環境で行います。リモートの端末（SSH）では、ログイン後のブラウザの戻り先（`localhost:8976`）が届かないことがあります。そのときは、手元のマシンで行うか、ポートを転送します（`ssh -L 8976:localhost:8976 …`）。

## 1. D1 のデータベースを作る

```sh
npx wrangler d1 create meal-log
```

出力に `database_id`（UUID）が出ます。手順2で使うので控えます。

> **注意**: 出力には、設定の例（`"binding": "meal_log"` など）も出ます。この `"binding"` の名前は使いません。手順2のとおり `DB` にします（コードが `env.DB` を読むため）。

ダッシュボードでは「Storage & Databases」→「D1 SQL Database」に作られたデータベースが見えます。

## 2. 本番の D1 にマイグレーションを適用する（緊急のときの予備）

> **ふだんは不要です。** アプリ（API）が、公開された後の最初のリクエストで、まだ当てていないマイグレーションを自分で当てます（README の「マイグレーションは、アプリが自分で当てる」）。空の D1 でも、最初のリクエストで表ができます。この手順は、アプリが当てられないときなど、緊急のときに手で当てるための予備です。ここで当てても、アプリの記録（表 `d1_migrations`）と食い違わず、アプリは適用済みのものを飛ばします。

表のスキーマは `migrations/` の下のファイル（`0001_create_meals.sql` から番号の順）で管理しています。本番の D1 に適用するための設定ファイルを、リポジトリのルートに `wrangler.migrate.jsonc` という名前で作ります（`.gitignore` に入れてあるので、コミットされません）。

```jsonc
{
  "name": "meal-log",
  "compatibility_date": "2026-11-01",
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "meal-log",
      "database_id": "<手順1で控えた database_id>",
      "migrations_dir": "migrations"
    }
  ]
}
```

適用します。

```sh
npx wrangler d1 migrations apply DB --remote --config wrangler.migrate.jsonc
```

適用してよいか聞かれたら「y」と答えます。成功すると、記録の表 `member_meals` や会員の表 `user` などができています。確かめるには:

```sh
npx wrangler d1 execute DB --remote --config wrangler.migrate.jsonc --command "SELECT name FROM sqlite_master WHERE type = 'table'"
```

> **注意**: 設定ファイルの名前を `wrangler.toml`、`wrangler.json`、`wrangler.jsonc` にしないでください。Pages は、この名前のファイルを本番の設定として読みます。手元用の `wrangler.dev.jsonc`（手元の D1 の設定）は、手元の確認専用なので、本番のデータベース ID を書き込まないでください。

手で当てるときは、マイグレーションを増やした後も、同じコマンドで当てます（適用済みのものは飛ばされます）。

## 3. Pages のプロジェクトを GitHub につないで、最初のデプロイをする

### 3-1. プロジェクトを GitHub につなぐ

ダッシュボードの「Workers & Pages」で、Pages のプロジェクトを作り、GitHub の `nosuke223/meal-log` につなぎます（プロジェクト名は `meal-log`）。手元からのアップロードで作ったプロジェクトを、後から GitHub 連携に切り替えられるかは確かめていません（未確認）。最初から GitHub 連携で作ります。

画面の操作の細かい順序と名前は、Cloudflare の更新で変わります。つないだ後の状態は、次の 3-2 のとおりになっていることを確かめます。

### 3-2. ビルドの設定

ダッシュボードの `meal-log` →「Settings」の Build で、次の値になっていることを確かめます（所有者が実際の画面で確かめた値）。

| 項目 | 値 |
| --- | --- |
| Production branch | `main` |
| Build command | `npm run build`（型検査と `vite build`） |
| Build output | `dist` |
| Root directory | 空（リポジトリのルート） |
| Build watch paths | `*` |
| Build system version | Version 3 |
| Automatic deployments | 有効（Production） |

API（Pages Functions）は、リポジトリ直下の `functions/`（`functions/api/[[path]].ts`）が自動で含まれます。

> **注意**: Root directory は空（リポジトリのルート）のままにしてください。`functions/` はルートから探されるので、別のディレクトリにすると API が入りません。

> **注意**: 手元の `npm run dev` と `npm run dev:api` が使う開発専用の秘密の値（`server/devApi.ts` の `DEV_BETTER_AUTH_SECRET`、`package.json` の `--binding`）は、`dist/` にも `functions/` にも入っていません。Cloudflare の環境変数にも入れないでください（手順6）。

つなぐと、最初のデプロイが走ります。以降は、main にマージするたびに、自動で本番にデプロイされます。ブランチごとのプレビューのデプロイも、PR のブランチ（`issue-…`）で自動で作られます（アドレスは `https://<ハッシュ>.<サブドメイン>.pages.dev`。ダッシュボードの「Deployments」の一覧に出ます）。

実際の本番のホスト名（`<本番のホスト名>`）は、ダッシュボードの「Workers & Pages」→ `meal-log` で確かめて、控えます。

この時点では D1 の接続と環境変数がないので、API は 500（`DatabaseNotConfigured`。D1 をつないだ後は `AuthConfigurationError`）を返します。手順3-3と手順5で設定した後に、再デプロイします（再デプロイの方法は手順5）。

### 3-3. D1 をつなぐ（バインディング）

ダッシュボードの「Workers & Pages」→ `meal-log` →「Settings」→「Bindings」→「Add」→「D1 database」を選び、次のように設定して保存します。

- Variable name: `DB`（この名前は変えない。コードが `env.DB` を読む）
- D1 database: 手順1で作った `meal-log`

ここでつなぐのは「Production」の環境だけです。「Preview」には、この本番の `meal-log` をつなぎません（Preview に同じデータベースを指すと、プレビューのデプロイが本番の会員と記録を読み書きしてしまうため）。プレビューには、会員登録とログイン、記録を試すために、別に作るプレビュー用の D1 をつなぎます（手順9-1）。プレビューの会員と記録は、本番とは別のものです。

### 3-4. 環境変数

環境変数は手順5（本番）と手順9・10（プレビュー）で設定します。

## 4. Access のアプリケーションとポリシーを作る

独自ドメインを持たず `pages.dev` で公開する場合、通常の Self-hosted アプリケーションの作成画面では `pages.dev` のドメインを選べません（選べるのはアカウント内の有効な zone だけ）。そこで、Pages の Access の設定が自動で作るアプリケーションを編集して使います（Cloudflare の [Pages の既知の問題](https://developers.cloudflare.com/pages/platform/known-issues/#enable-access-on-your-pagesdev-domain)の手順）。独自ドメインを使う場合は、通常の Self-hosted アプリケーションを作ってもかまいません（Path を空にして、手順4-2 の 3 から 6 と同じ設定にする）。

画面の名前や場所は、Cloudflare の更新で変わることがあります。以下は、実際に見えた英語の表記です。

### 4-1. Pages の Preview access を制限する

1. ダッシュボードの「Workers & Pages」→ `meal-log` →「Settings」→「General」→ **Preview access** の **Restrict previews** を押す
2. 案内に従って進む。Access のアプリケーションが自動で作られる

この操作で作られるアプリケーションは、プレビュー用のワイルドカード（`*.<サブドメイン>.pages.dev`）だけを守ります。本番のホスト名（`<本番のホスト名>`）は含まれません（この操作だけでは本番は守られません）。次の手順で、このホスト名を本番のものに書き換えます。

### 4-2. 対象を本番のアドレスだけにする

1. ダッシュボードの「Zero Trust」→「Access controls」→「Applications」を開き、4-1 で作られたアプリケーション（名前は `<プロジェクト名>` など）を編集する
2. 「Application domain」（Public hostname）にある既存のホスト名（`*.<サブドメイン>.pages.dev`）を編集する。「Subdomain」の欄の `*` だけを消して、ホスト名を `<本番のホスト名>`（例: `meal-log-oqi.pages.dev`）にする（ホスト名を削除してから作り直さない）。ほかにワイルドカードのホスト名が残っていたら削除し、`<本番のホスト名>` だけにする
   - **Path は空にする**（サイト全体を守る。`/api` もこれで守られる）
3. Session Duration: 好みの長さ（Access のログインの期限。切れると、アプリはログインの画面に移るので、読み込み直して Access にログインし直す）
4. 「Policies」を確認する。自動で作られたポリシーが、所有者だけを許可しているものにする
   - Action: `Allow`
   - Include: 「Emails」→ `<自分のメールアドレス>`（所有者のメールアドレスだけ。「Everyone」や「Emails ending in」にしない。自動で入った他の許可は削除する）
5. 保存する

> **注意（失敗しやすい所）: Access で `/api` も守ること。** Path を空にしてサイト全体を守れば、`/api` も同じアプリケーションに入ります。「`/` だけ」「画面のパスだけ」のように Path を決めると、`/api` が Access で守られません（API は会員のログインを求めるので、記録は読み書きされませんが、公開の準備までは、守りは二重にしておく）。別のアプリケーションに分けるときは、`/api` にも同じ許可の Policy を付けてください。

> **注意: `pages.dev` のサブドメイン（`<ハッシュ>.<サブドメイン>.pages.dev`）は、別のホスト名です。** 4-2 でワイルドカードを外すと、プレビューのアドレスと、本番のデプロイごとのアドレスには Access が掛からなくなります。そこからは誰でも画面と会員登録を開けますが、記録の API は会員のログインを求めるので、ログインしていない人には 401 を返します（手順7-4）。プレビューは、本番とは別の D1（手順9-1）を使うので、本番の会員と記録は読み書きできません。

API は Access のチーム名と AUD タグを使いません（以前の版で入れた `ACCESS_TEAM_NAME` と `ACCESS_AUD` は、残っていても読まれません）。

## 5. 本番の環境変数（会員のログインとメール）を入れる

本番の記録の API は、会員のログインで動きます。次の3つが本番にないと、記録の画面が使えません（`BETTER_AUTH_SECRET` がないと、記録の API とログインの API が 500 の `AuthConfigurationError`。メールの値がないと、会員登録が 500 の `MailConfigurationError`）。**この版を本番に出す（main にマージする）前に入れます。**

1. Resend の画面で、本番用の API キーを作る（手順10-1と同じ要領。名前は `meal-log-production`、権限は「Sending access」）。プレビューのキーとは別にする
2. 秘密の値を作る（プレビューの `BETTER_AUTH_SECRET` とは別の値にする）

   ```sh
   openssl rand -base64 32
   ```

3. 本番に入れる（`--env preview` を付けない。値は聞かれたときに貼る。コマンドは1つずつ実行する）

   ```sh
   npx wrangler pages secret put BETTER_AUTH_SECRET --project-name meal-log
   npx wrangler pages secret put RESEND_API_KEY --project-name meal-log
   npx wrangler pages secret put MAIL_FROM --project-name meal-log
   ```

   | 名前 | 値 |
   | --- | --- |
   | `BETTER_AUTH_SECRET` | 2. で作った値 |
   | `RESEND_API_KEY` | 1. で作ったキー（`re_…`） |
   | `MAIL_FROM` | `onboarding@resend.dev`（ドメインを取った後は、そのドメインのアドレス。公開の準備の Issue） |

4. 入ったことを確かめる（名前だけが表示されます）。`BETTER_AUTH_SECRET`、`RESEND_API_KEY`、`MAIL_FROM` の3つが出て、`MAIL_ALLOWED_TO` と、`DEV_` で始まる名前が出ないこと（手順6）

   ```sh
   npx wrangler pages secret list --project-name meal-log
   ```

5. 互換性フラグ `nodejs_compat` が「Production」に入っていることを確かめる（手順9-4。ないと、ログインの仕組みが動かず、記録の API も使えない）

- Resend は、ドメインを確認するまで、Resend に登録した自分のアドレスにしか送れません。本番で会員登録するアドレスは、それにします
- 値の決まり（推測されにくい長い文字列、リポジトリやメモに平文で残さない、変えるとそれまでのログインが切れる）は、手順9と同じです

> **注意**: ダッシュボードの「Variables and secrets」に同じ名前の変数がすでにあるときは、先に削除してからコマンドで入れてください。

> **注意**: 環境変数の変更は、次のデプロイから効きます。設定したら、再デプロイしてください。再デプロイの操作（ダッシュボードの Deployments からの再実行など）は、実機で確かめていません（未確認）。確かめられるまでは、main への次のマージで本番に出る、と考えてください。また、GitHub 連携のプロジェクトに `wrangler pages secret put` で入れた値が本番に効くかも、未確認です（効かないときは、ダッシュボードの「Settings」→「Variables and secrets」の「Production」に入れます）。

## 6. 開発用・プレビュー用の値が本番に入っていないことを確かめる

本番には、次の値を設定しません。本番とプレビューの環境を取り違えて入れていないことを確かめます。

- `MAIL_ALLOWED_TO`（プレビュー専用）: 本番に入っていると、所有者以外にメールが届かず、会員登録できない
- 名前が `DEV_` で始まるもの（手元の開発専用）: 本番のコードは読まないが、取り違えの印なので入れない
- `FREE_PLAN_RECORD_LIMIT`（プレビュー専用）: 本番に入っていると、無料のプランの上限が 300 品でなくなる（例: `3` なら、会員が3品しか記録できない）

1. 設定されていない。あれば削除して、再デプロイする（手順5。方法は未確認）
   - ダッシュボードの「Settings」→「Variables and secrets」の「Production」に、`MAIL_ALLOWED_TO`、`FREE_PLAN_RECORD_LIMIT`、`DEV_` で始まる名前がない
   - `npx wrangler pages secret list --project-name meal-log`（`--env preview` を付けない）の出力に出ない
2. 開発専用の秘密の値（`server/devApi.ts` の `DEV_BETTER_AUTH_SECRET`）を、本番とプレビューの `BETTER_AUTH_SECRET` に使っていない（手順5、9-2 で `openssl rand` で作った値を使う）

> **注意**: `npm run dev:api` のコマンドには、開発専用の `--binding BETTER_AUTH_SECRET=…` が入っています。これは手元の確認用です。Cloudflare のビルドの設定（Build command など）には付けず、`wrangler pages secret put` などでも設定しないでください。

## 7. 動作確認

1. **開く**: ブラウザで `https://<本番のホスト名>` を開く。Access のログイン画面が出る。手順4-2 で許可したメールアドレスで Access にログインすると、アプリのログインの画面（`#/login`）が開く
   - 許可していないメールアドレスでは、入れない（Access に拒否される）
2. **会員登録とログイン**: 「会員登録へ」から、Resend に登録した自分のメールアドレスで会員登録する。届いた確認のメールのリンクを開き、ログインすると、今日の記録の画面が開く
3. **記録する**: 昼の欄に品を追加する。読み込み直しても残っている
4. **別の端末で見える**: 別の端末（またはシークレットウィンドウ）で同じアドレスを開き、同じ会員でログインする。3. の記録が見える
5. **ログインしていないリクエストは API が 401 を返す**: Access が掛かっていないアドレス（本番のデプロイごとのアドレス `https://<ハッシュ>.<本番のホスト名>`。ダッシュボードの「Deployments」の一覧にある。手順4-2 のとおり、ワイルドカードを外したので Access が掛かっていないもの）に、ログインなしで API を呼ぶ

```sh
curl -i 'https://<ハッシュ>.<本番のホスト名>/api/meals'
```

   - 期待する結果: `401`（本文は `{"error":{"type":"Unauthorized",…}}`）。記録は読み書きされていない
   - `500`（`AuthConfigurationError`）: 本番に `BETTER_AUTH_SECRET` がない、または入れた後に再デプロイしていない（手順5）
   - 本番のアドレス（Access が掛かっている）を、Access のログインなしで `curl` すると、API より前に Access がログインの画面への転送（302）や 403 を返します。これも、守られている印です

6. **ログインの期限切れ**: 使っている途中でログインが切れると（ほかの端末でパスワードを再設定したときなど）、アプリはログインの画面に移り、「ログインの期限が切れました。ログインし直してください」と出る。Access の Session Duration が過ぎたときも、同じ表示になる。読み込み直して、Access とアプリにログインし直す（正しい動作）

## 8. 古い版（localStorage）の記録をサーバーへ移す

以前の版（記録をブラウザ内の localStorage に保存していた版）の記録は、自動では移りません。README の「ブラウザ内の記録をサーバーへ移す」の手順で移します。

1. 以前の版を、記録を入れていたブラウザで開き、データ画面の「書き出す」でファイル（`meal-log-YYYY-MM-DD.json`）を保存する
2. 公開したサイトを開いてログインし、データ画面の「読み込む」で、1. のファイルを選び、「取り込む」を押す
3. 記録の画面やカレンダーで、記録が移ったことを確かめる

同じファイルを2回読み込んでも、記録は増えません。

> **注意**: 以前の版の記録は、書き出すまでは、そのブラウザの中にしかありません。以前の版のサイト（アドレス）のデータを消す前に、必ず書き出して、移ったことを確かめてください。

### 8-1. Access のメールアドレスごとの記録（移行済み）

Access のメールアドレスごとの記録は、書き出しと読み込みで、会員の記録に移した。古い表 `meals` は、マイグレーション `0004_drop_meals.sql` で消えた。

## 9. 会員のログインの準備（プレビュー用の D1 と、秘密の値 `BETTER_AUTH_SECRET`）

会員の登録とログイン（`/api/auth/`。README の「ログインの API」）は、セッションなどの署名に、秘密の値 `BETTER_AUTH_SECRET` を使います。入っていないときは、`/api/auth/` と記録の API（`/api/meals` など）が 500（`AuthConfigurationError`）になります。

- 値は、推測されにくい長いランダムな文字列にする。本番とプレビューで**別の値**にする（プレビューの値が漏れても、本番のセッションを作れないようにする）
- 値はリポジトリやメモに平文で残さない。手元の `npm run dev` と `npm run dev:api` が使う開発専用の値（`server/devApi.ts`、`package.json`）は、本番にもプレビューにも使わない
- 一度入れた値を変えると、それまでのログイン（セッション）は使えなくなる（もう一度ログインすればよい）

値を作る:

```sh
openssl rand -base64 32
```

### 9-1. プレビュー用の D1 をつなぐ

会員の表は D1 にあり、API は `/api/auth/` を処理する前に `DB` がつながっているかを確かめます。プレビューに `DB` がないと、秘密の値と互換性フラグを入れても、会員登録とログインは 500（`DatabaseNotConfigured`）になります。そこで、本番とは別のプレビュー用の D1 を作り、「Preview」に `DB` としてつなぎます（本番の `meal-log` はつながない。手順3-3）。

1. プレビュー用の D1 を作る（名前の例: `meal-log-preview`）

   ```sh
   npx wrangler d1 create meal-log-preview
   ```

2. ダッシュボードの「Workers & Pages」→ `meal-log` →「Settings」→「Bindings」で、「Preview」の環境に「D1 database」を足す
   - Variable name: `DB`（この名前は変えない）
   - D1 database: 1. で作った `meal-log-preview`（本番の `meal-log` を選ばない）
3. 再デプロイする（プレビューのデプロイは、PR のブランチに push すると作り直されます。手順5の注意のとおり、ダッシュボードからの再実行は未確認）

表は、アプリが最初のリクエストで自分で作ります（マイグレーションを手で当てる必要はありません。「更新するとき」）。つないだことは、プレビューのアドレスの `/api/health` が `200` と `{"migrations":[…]}` を返すことで確かめます（つないでいないときは `500` の `DatabaseNotConfigured`）。画面の名前や場所は、Cloudflare の更新で変わることがあります（この手順は実機で確かめていません）。

プレビュー用の D1 と、手順9-2 の秘密の値を入れると、プレビューでも、会員登録してログインすれば記録を読み書きできます。プレビューの会員と記録は、プレビュー用の D1 にだけ入ります（本番の D1 とは別）。

### 9-2. プレビューの秘密の値

プレビューのデプロイで会員登録とログインを試すために、先に入れます（手順5と同じ要領。値は聞かれたときに貼る）。

```sh
npx wrangler pages secret put BETTER_AUTH_SECRET --project-name meal-log --env preview
```

### 9-3. 本番の秘密の値

本番の `BETTER_AUTH_SECRET` は、手順5で、メールの値と一緒に入れます（記録の API が会員のログインで動くので、本番で必須です）。

入ったことは `npx wrangler pages secret list --project-name meal-log`（プレビューは `--env preview` を付ける）で確かめます（名前だけが表示されます）。手順5の注意のとおり、次のデプロイから効きます。

### 9-4. 互換性フラグ `nodejs_compat`

Better Auth は、Node.js の `AsyncLocalStorage` を使います。ダッシュボードの「Workers & Pages」→ `meal-log` →「Settings」→「Runtime」の **Compatibility flags** に、`nodejs_compat` を「Production」と「Preview」の両方で入れます（手元は `wrangler.dev.jsonc` と `npm run dev:api` に入っています）。画面の名前や場所は、Cloudflare の更新で変わることがあります（この手順は実機で確かめていません）。

- 記録の API も会員のログイン（Better Auth）で本人を確かめるので、このフラグがないと、ログインの API と記録の API の両方が動きません（500 になる）。本番の「Production」に入っていることを、この版を本番に出す前に確かめてください（プレビューで試しても、本番の設定の抜けは見つかりません）

### 9-5. 確かめる

手順9-1、9-2、9-4 と手順10 の後に再デプロイしたプレビューのデプロイのアドレスで、`#/signup` から会員登録し、届いた確認のメールのリンクを開いてからログインし、「アカウント」の画面でメールアドレスが出ること、ログアウト、ログイン、間違ったパスワードで「メールアドレスかパスワードが違います」と出ることを確かめます（手順10-3）。

## 10. メールの準備（Resend）

会員登録の確認のメールは、Resend（<https://resend.com>）で送ります（README の「メールの部品」）。メールの値が入っていないときは、会員登録と確認のメールの送り直しが 500（`MailConfigurationError`）になり、会員登録できません（会員がいないと、記録の画面も使えません）。

Resend は、ドメインを確認するまでは、試験用の送信元（`onboarding@resend.dev`）から、Resend のアカウントの持ち主（所有者）のアドレスにしか送れません。プレビューには、ここで入れ、所有者のアドレスに届くことを確かめます。本番の値は手順5で入れます。

### 10-1. Resend の API キーを作る（ブラウザ）

1. Resend のアカウントを作る
2. 左のメニューの「API Keys」→「Create API Key」。名前は `meal-log-preview`、権限は「Sending access」（送信だけ）にする
3. 表示されたキー（`re_…`）は、この画面を閉じると見られないので、次の手順で貼るまで開いておく

画面の名前や場所は、Resend の更新で変わることがあります。

### 10-2. プレビューに値を入れる（PC のコマンド）

`--env preview` を必ず付けます（付けないと本番に入ります）。値は聞かれたときに貼ります。

```sh
npx wrangler pages secret put RESEND_API_KEY --project-name meal-log --env preview
npx wrangler pages secret put MAIL_FROM --project-name meal-log --env preview
npx wrangler pages secret put MAIL_ALLOWED_TO --project-name meal-log --env preview
```

| 名前 | 入れる値 |
| --- | --- |
| `RESEND_API_KEY` | 10-1 で作ったキー（`re_…`） |
| `MAIL_FROM` | `onboarding@resend.dev` |
| `MAIL_ALLOWED_TO` | Resend に登録した自分のメールアドレス |

入ったことは、次のコマンドで3つの名前が出ることで確かめます（値は表示されません）。

```sh
npx wrangler pages secret list --project-name meal-log --env preview
```

- `MAIL_ALLOWED_TO` があると、そのアドレスにしかメールを送りません。ほかのアドレスで登録すると、画面は同じでもメールは届きません（送らずに、ログに「送り先が許可されていないので送らなかった」とだけ残ります）。プレビューから知らない人にメールが届かないようにするためです
- 手順5の注意のとおり、次のデプロイから効きます

### 10-3. プレビューで確かめる

PR のプレビューのデプロイのアドレスで、次を確かめます。

1. Resend に登録した自分のメールアドレスで `#/signup` から会員登録する。「確認のメールを送りました。メールのリンクを開いてください」と出る
2. 確認のメールのリンクを開く前にログインすると、「メールアドレスの確認が済んでいません」と出る。「確認のメールをもう一度送る」を押すと、もう1通届く
3. 届いたメールのリンクを開くと、ログインの画面に「メールアドレスを確認できました。ログインしてください」と出る。ログインできる
4. 別のメールアドレスで登録すると、画面は同じだが、メールは届かない（正しい動き）
5. ログインの画面の「パスワードを忘れた」から `#/forgot` を開き、自分のメールアドレスで「再設定のメールを送る」を押す。再設定のメールが届く
6. 届いたメールのリンクを開く。アドレスが `#/reset` に変わり（トークンがアドレスに残らない）、新しいパスワードを決めると、ログインの画面に「パスワードを変更しました。ログインしてください」と出る。新しいパスワードでログインでき、古いパスワードでは入れない
7. 同じリンクをもう一度開くと、「このリンクは、期限が切れているか、すでに使われています。…」と出て、使えない
8. 別のメールアドレスで 5. を試すと、画面は同じだが、メールは届かない（正しい動き）

### 10-4. 本番の値

本番の `RESEND_API_KEY` と `MAIL_FROM` は、手順5で入れます（本番用のキーと、`onboarding@resend.dev`）。ドメインを取り、Resend でドメインを確認した後（公開の準備の Issue）に、`MAIL_FROM` をそのドメインのアドレスに変えます。

- 本番の `MAIL_FROM` は、ドメインを取った後は、そのドメインのアドレス（例: `no-reply@<ドメイン>`）にする
- 本番には `MAIL_ALLOWED_TO` を**設定しない**（設定すると、所有者以外にメールが届かなくなる。手順6）

## 11. プラン（無料・有料）を手で切り替える

無料のプランで保存できる記録は 300 品までで、有料のプランは上限がありません（README の「プランと記録の上限」）。決済ができるまでは、プランを切り替える API や画面はないので、Cloudflare の画面の D1 の **Console** で SQL を実行して切り替えます。

- 本番とプレビューの D1 は別です。本番の会員は本番の D1（`meal-log`）、プレビューの会員はプレビューの D1（`meal-log-preview`。手順9-1）で切り替えます。取り違えると、切り替わりません（別の D1 には、その会員がいない）
- 会員のプランは、表 `member_plans` に入ります。行がない会員は無料です
- Cloudflare の画面の名前や場所は変わることがあります。D1 の Console の操作は、実機で確かめていません（未確認）

### 11-1. 表 `member_plans` ができていることを確かめる

表 `member_plans` は、マイグレーション `0005_create_member_plans.sql` で、そのデプロイの最初のリクエストのときに、アプリが自分で作ります（「更新するとき」）。切り替える前に、切り替えたい側（本番、またはプレビューのデプロイ）のアドレスの `/api/health` を開き、`migrations` に `0005_create_member_plans.sql` が出ることを確かめます（本番のアドレスは Access が掛かっているので、ブラウザでログインしてから開く）。

```sh
curl -i 'https://<ハッシュ>.<サブドメイン>.pages.dev/api/health'
```

出ないときは、まだ一度も開かれていません。そのアドレスの画面を一度開いてから、もう一度確かめます。

### 11-2. D1 の Console で切り替える（未確認）

1. ダッシュボードの「Storage & Databases」→「D1 SQL Database」で、切り替えたい側の D1（本番は `meal-log`、プレビューは `meal-log-preview`）を開き、「Console」を開く（未確認）
2. メールアドレスから会員を探す。会員のメールアドレスは小文字で保存されているので、`lower(…)` で小文字にして探す。出た `id` を控える

   ```sql
   SELECT id, email, emailVerified FROM "user" WHERE email = lower('<メールアドレス>');
   ```

3. 切り替える。`<会員の ID>` は 2. の `id`。行がなくても、あっても書ける形（`INSERT … ON CONFLICT … DO UPDATE`）です。`updated_at` は、ほかの表と同じ形（ISO 8601、UTC、ミリ秒まで）で入る

   無料から有料にする:

   ```sql
   INSERT INTO member_plans (user_id, plan, updated_at) VALUES ('<会員の ID>', 'paid', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) ON CONFLICT (user_id) DO UPDATE SET plan = excluded.plan, updated_at = excluded.updated_at;
   ```

   有料から無料に戻す:

   ```sql
   INSERT INTO member_plans (user_id, plan, updated_at) VALUES ('<会員の ID>', 'free', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) ON CONFLICT (user_id) DO UPDATE SET plan = excluded.plan, updated_at = excluded.updated_at;
   ```

4. 切り替わったことを確かめる。`plan` が `paid`（有料）か `free`（無料）。`NULL` は行がない（無料）

   ```sql
   SELECT u.email, p.plan, p.updated_at FROM "user" AS u LEFT JOIN member_plans AS p ON p.user_id = u.id WHERE u.email = lower('<メールアドレス>');
   ```

5. アプリの「アカウント」の画面を開き直す。有料なら「プラン: 有料（記録 N 品。上限なし）」、無料なら「プラン: 無料（記録 N / 300 品）」と出る

- `plan` には `free` と `paid` しか入りません（ほかの値は、表の決まりで失敗します）
- 有料から無料に戻しても、記録は消えません。上限を超えている会員は、見る・変える・消す・書き出すはでき、追加と取り込みだけができなくなります（削除して上限を下回れば、また追加できます）
- 会員が消えると（退会など）、その会員の `member_plans` の行も消えます

### 11-3. プレビューで上限を手早く試す（`FREE_PLAN_RECORD_LIMIT`）

プレビューで上限を試すのに300品を入れなくて済むよう、プレビューだけに、環境変数 `FREE_PLAN_RECORD_LIMIT`（無料のプランの上限）を入れられます。`--env preview` を必ず付けます（付けないと本番に入ります）。

```sh
npx wrangler pages secret put FREE_PLAN_RECORD_LIMIT --project-name meal-log --env preview
```

- `Enter a secret value:` と聞かれたら、上限の数（例: `3`）を入れる。1以上の整数だけが使われる（空、`0`、負数、小数、`1e3` などは無視して 300 品になり、記録に警告が出る）
- 入ったことは `npx wrangler pages secret list --project-name meal-log --env preview` で確かめる。次のデプロイから効く（手順5の注意）
- 効いていることは、プレビューのアカウントの画面に「記録 N / 3 品」のように、入れた数が出ることで確かめる
- 試し終わったら消す（残すと、ほかの PR のプレビューも、その数で止まる）

  ```sh
  npx wrangler pages secret delete FREE_PLAN_RECORD_LIMIT --project-name meal-log --env preview
  ```

- 本番には**設定しない**（手順6）。本番にないことは、`npx wrangler pages secret list --project-name meal-log`（`--env` なし）に `FREE_PLAN_RECORD_LIMIT` が出ないことで確かめる

## 更新するとき

### 画面や API を変える PR

main にマージすると、Cloudflare が自動で本番にデプロイします。手元でのデプロイは要りません。

### 表を変える PR（`migrations/` に新しいファイルが増えるもの）

手で当てる必要はありません。マージすると、新しいコードが本番に出て、その最初のリクエストで、アプリが本番の D1 に自分で当てます（プレビューのデプロイも、つながっているプレビューの D1 に自分で当てます）。当てた後は、`/api/health` の `migrations` に、新しいファイルの名前が出ます。

```sh
curl -i 'https://<ハッシュ>.<サブドメイン>.pages.dev/api/health'
```

   - 期待する結果: `200` と `{"migrations":["0001_create_meals.sql",…]}`。ログインなしで開ける（本番のアドレスは Access が掛かっているので、ブラウザでログインしてから開く）
   - `500`（`MigrationError`）: 当てられなかった。詳しい内容は、Cloudflare のログ（Pages の関数のログ）に出る。直すまでは、手順2のコマンドで手で当てることもできる（緊急のときの予備）

公開とマイグレーションは同時ではないので、少しの間、新しいコードと古い表、または古いコードと新しい表が並びます。どちらの組み合わせでも動くよう、表の変更は「足すだけ」を基本にします（README の「表の変更の決まり（足すだけ）」）。

- 表や列を足す。足す列は、空（`NULL`）を許すか、既定の値（`DEFAULT`）を持たせる
- 列や表を消す・名前を変えるのは、コードがそれを使わなくなってから、別の Issue（別の PR）で行う。例: 先に新しい列を足して、コードをそちらに切り替える PR をマージし、その後で古い列を消す PR を出す

### 環境変数を変えたとき

手順5の注意のとおり、次のデプロイから効きます。再デプロイの操作は未確認です。
