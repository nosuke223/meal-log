# Cloudflare への公開と Access の設定手順

作った画面と API を Cloudflare Pages（画面と Pages Functions）と D1（データベース）に公開し、Cloudflare Access で所有者だけが開けるようにする手順です。上から順に行ってください。main にマージすると、Cloudflare が自動で本番にデプロイします（Cloudflare Pages を GitHub の `nosuke223/meal-log` につないであります）。表の変更（マイグレーション）は、アプリ（API）が、公開された後の最初のリクエストで、自分のつながっている D1 に当てます（手で当てる手順2は、緊急のときの予備です。「更新するとき」）。

`<…>` の部分は、自分の値に置き換えます。値（ID、チーム名、AUD タグなど）はリポジトリに書かず、Cloudflare の画面と手元のメモにだけ残してください。

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
| `DB` | D1 のバインディング | 手順3（Pages の設定） |
| `ACCESS_TEAM_NAME` | Access のチーム名 | 手順5 |
| `ACCESS_AUD` | Access のアプリケーションの AUD タグ | 手順5 |
| `DEV_USER_EMAIL` | 手元の開発専用。**本番には設定しない** | 設定しない（手順6） |
| `BETTER_AUTH_SECRET` | 会員のログイン（Better Auth）の秘密の値。本番とプレビューで別の値 | 手順9（本番は公開の直前でよい） |

## 事前の準備

- Cloudflare のアカウントがある
- Zero Trust（Access）が使える。初めて Zero Trust を開くと、アプリケーションの一覧ではなく「Finish your account setup」と出ます。次の順で進めます
  1. チーム名を決める画面が出たら、チーム名を決める（後で `ACCESS_TEAM_NAME` の確認に使うので、場所は手順4で説明します）
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

表のスキーマは `migrations/` の下のファイル（今は `0001_create_meals.sql`）で管理しています。本番の D1 に適用するための設定ファイルを、リポジトリのルートに `wrangler.migrate.jsonc` という名前で作ります（`.gitignore` に入れてあるので、コミットされません）。

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

適用してよいか聞かれたら「y」と答えます。成功すると、`meals` の表ができています。確かめるには:

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

> **注意**: 手元の `npm run dev` と `npm run dev:api` が使う `DEV_USER_EMAIL` は、`dist/` にも `functions/` にも入っていません。Cloudflare の環境変数にも入れないでください（手順6）。

つなぐと、最初のデプロイが走ります。以降は、main にマージするたびに、自動で本番にデプロイされます。ブランチごとのプレビューのデプロイも、PR のブランチ（`issue-…`）で自動で作られます（アドレスは `https://<ハッシュ>.<サブドメイン>.pages.dev`。ダッシュボードの「Deployments」の一覧に出ます）。

実際の本番のホスト名（`<本番のホスト名>`）は、ダッシュボードの「Workers & Pages」→ `meal-log` で確かめて、控えます。

この時点では D1 の接続と環境変数がないので、API は 500（`DatabaseNotConfigured`。D1 をつないだ後は `AuthConfigurationError`）を返します。手順3-3から5で設定した後に、再デプロイします（再デプロイの方法は手順5）。

### 3-3. D1 をつなぐ（バインディング）

ダッシュボードの「Workers & Pages」→ `meal-log` →「Settings」→「Bindings」→「Add」→「D1 database」を選び、次のように設定して保存します。

- Variable name: `DB`（この名前は変えない。コードが `env.DB` を読む）
- D1 database: 手順1で作った `meal-log`

「Production」の環境にだけ設定します。「Preview」には設定しません（Preview に同じデータベースを指すと、プレビューのデプロイが本番の記録を読み書きしてしまうため）。そのため、プレビューのデプロイには `DB` の接続も手順5の環境変数もなく、Access も掛かっていないので、記録は読み書きできません（API は 401 か 500 になります。手順7-4）。

### 3-4. 環境変数

環境変数は手順5で設定します。

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
3. Session Duration: 好みの長さ（ログインの期限。切れると画面にエラーが出るので、読み込み直してログインし直す）
4. 「Policies」を確認する。自動で作られたポリシーが、所有者だけを許可しているものにする
   - Action: `Allow`
   - Include: 「Emails」→ `<自分のメールアドレス>`（所有者のメールアドレスだけ。「Everyone」や「Emails ending in」にしない。自動で入った他の許可は削除する）
5. 保存する
6. AUD タグを控える（手順5で使う）。アプリケーションの編集画面（Zero Trust →「Access controls」→「Applications」→ アプリケーション名）の **Additional settings** のタブにある **Application Audience (AUD) Tag** です（「Details」のボタンの先には、名前とセッションの長さしかありません）。手順5の `ACCESS_AUD` には、この編集したアプリケーションの AUD タグを使う

> **注意（失敗しやすい所）: Access で `/api` も守ること。** Path を空にしてサイト全体を守れば、`/api` も同じアプリケーションに入ります。「`/` だけ」「画面のパスだけ」のように Path を決めると、`/api` が守られず、Access を通らない API の呼び出しになります（API も JWT を検証するので 401 になりますが、守りは二重にしておく）。別のアプリケーションに分けるときは、`/api` にも同じ許可の Policy を付けてください。

> **注意: `pages.dev` のサブドメイン（`<ハッシュ>.<サブドメイン>.pages.dev`）は、別のホスト名です。** 4-2 でワイルドカードを外すと、プレビューのアドレスには Access が掛からなくなります。手順7の「Access を通っていないときに 401 が返る」の確認では、この掛かっていないアドレスを使います。プレビューにも記録の API が公開されるのを避けるため、手順3-3 のとおり「Preview」に `DB` のバインディングと手順5の環境変数を設定しないでおきます。そうすれば、プレビューの API は記録を読み書きできません（401 か 500 になります）。

Zero Trust の **チーム名** は、Zero Trust の **Overview** の「Account details」にある **Team domain**（`<チーム名>.cloudflareaccess.com`）の `<チーム名>` の部分です。控えます。その下の「Team name」は表示名なので、環境変数には使いません。

## 5. Access のチーム名と AUD タグを、Pages の環境変数に設定する

ダッシュボードの「Variables and secrets」に追加しても、再デプロイしても、API が 500（「環境変数 ACCESS_TEAM_NAME と ACCESS_AUD を設定してください」）のままだったことがあります。環境変数は、次のコマンドで入れます（Production）。

```sh
npx wrangler pages secret put ACCESS_TEAM_NAME --project-name meal-log
npx wrangler pages secret put ACCESS_AUD --project-name meal-log
```

値は、聞かれたときに貼ります（上のコマンドは1つずつ実行します）。

| 名前 | 値 |
| --- | --- |
| `ACCESS_TEAM_NAME` | `<チーム名>`（`<チーム名>.cloudflareaccess.com` の前の部分だけ。`https://` や `.cloudflareaccess.com` は付けない。英数字とハイフン） |
| `ACCESS_AUD` | 手順4-2 で控えた AUD タグ（編集したアプリケーションのもの） |

入ったことは、次のコマンドで確かめます（名前だけが表示されます）。

```sh
npx wrangler pages secret list --project-name meal-log
```

> **注意**: ダッシュボードの「Variables and secrets」に同じ名前の変数がすでにあるときは、先に削除してからコマンドで入れてください。

> **注意**: 環境変数の変更は、次のデプロイから効きます。設定したら、再デプロイしてください。再デプロイの操作（ダッシュボードの Deployments からの再実行など）は、実機で確かめていません（未確認）。確かめられるまでは、main への次のマージで本番に出る、と考えてください。また、GitHub 連携のプロジェクトに `wrangler pages secret put` で入れた値が本番に効くかも、未確認です（効かないときは、ダッシュボードの「Settings」→「Variables and secrets」の「Production」に入れます）。

## 6. 認証を省く設定（開発用）が本番に入っていないことを確かめる

`DEV_USER_EMAIL` を設定すると、API は JWT を検証せず、誰でもその人として記録を読み書きできます。本番とプレビューの環境のどちらにも、設定されていないことを確かめます。

1. `DEV_USER_EMAIL` が設定されていない。あれば削除して、再デプロイする（手順5。方法は未確認）
   - ダッシュボードの「Settings」→「Variables and secrets」に、`DEV_USER_EMAIL` がない（「Production」と「Preview」の両方）
   - `npx wrangler pages secret list --project-name meal-log` の出力に、`DEV_USER_EMAIL` が出ない
2. 手元のリポジトリの設定ファイルに書かれていない

```sh
grep -rn DEV_USER_EMAIL wrangler.dev.jsonc wrangler.migrate.jsonc dist
```

何も表示されなければ問題ありません（`wrangler.migrate.jsonc` がないときは、そのエラーは無視してよい）。

3. 公開したサイトで実際に確かめる（手順7の「Access を通っていないときの 401」が、そのまま確認になります。`DEV_USER_EMAIL` が入っていると、401 ではなく 200 が返ります）

> **注意**: `npm run dev:api` のコマンドには `--binding DEV_USER_EMAIL=dev@example.com` が入っています。これは手元の確認用です。Cloudflare のビルドの設定（Build command など）には付けず、`wrangler pages secret put` などでも設定しないでください。

## 7. 動作確認

1. **開く**: ブラウザで `https://<本番のホスト名>` を開く。Access のログイン画面が出る。手順4-2 で許可したメールアドレスでログインすると、今日の記録の画面が開く
   - 許可していないメールアドレスでは、入れない（Access に拒否される）
2. **記録する**: 昼の欄に品を追加する。読み込み直しても残っている
3. **別の端末で見える**: 別の端末（またはシークレットウィンドウ）で同じアドレスを開き、同じメールアドレスでログインする。2. の記録が見える
4. **Access を通っていないリクエストは API が 401 を返す**: Access が掛かっていないアドレス（プレビューのデプロイの `https://<ハッシュ>.<サブドメイン>.pages.dev`。ダッシュボードの「Deployments」の一覧にある。手順4-2 のとおり、ワイルドカードを外したので Access が掛かっていないもの）に、ログインなしで API を呼ぶ。プレビューには `DB` の接続と環境変数がない（手順3-3）ので、ここで確かめられるのは「Access なしで記録が読み書きできない」ことです

```sh
curl -i 'https://<ハッシュ>.<サブドメイン>.pages.dev/api/meals'
```

   - 期待する結果: `401`（本文は `{"error":{"type":"Unauthorized",…}}`）か、`500`（`AuthConfigurationError`、または、プレビューに D1 をつないでいないときは `DatabaseNotConfigured`）。プレビューには手順5の環境変数を入れていないため、`500` になることが多い。どれも、記録は読み書きされていない
   - `200`: **危険**。`DEV_USER_EMAIL` が設定されている（Preview にも入っている）。すぐに手順6で消して、再デプロイする
   - 本番に手順5の環境変数が効いているかは、この確認ではわかりません。手順7の1から3（ログインして記録できる）で確かめます。ログインしても API が `500`（`AuthConfigurationError`）のときは、本番の環境変数がない、または入れた後に再デプロイしていない
   - 本番のアドレス（Access が掛かっている）を、ログインなしで `curl` すると、API より前に Access がログインの画面への転送（302）や 403 を返します。これも、守られている印です

5. **ログインの期限切れ**: Session Duration が過ぎた後に操作すると、画面に「ログインの期限が切れました。ページを読み込み直してください」と出る。読み込み直すとログインの画面になる（正しい動作）

## 8. 古い版（localStorage）の記録をサーバーへ移す

以前の版（記録をブラウザ内の localStorage に保存していた版）の記録は、自動では移りません。README の「ブラウザ内の記録をサーバーへ移す」の手順で移します。

1. 以前の版を、記録を入れていたブラウザで開き、データ画面の「書き出す」でファイル（`meal-log-YYYY-MM-DD.json`）を保存する
2. 公開したサイトを開いてログインし、データ画面の「読み込む」で、1. のファイルを選び、「取り込む」を押す
3. 記録の画面やカレンダーで、記録が移ったことを確かめる

同じファイルを2回読み込んでも、記録は増えません。

> **注意**: 以前の版の記録は、書き出すまでは、そのブラウザの中にしかありません。以前の版のサイト（アドレス）のデータを消す前に、必ず書き出して、移ったことを確かめてください。

## 9. 会員のログインの秘密の値（`BETTER_AUTH_SECRET`）を入れる

会員の登録とログイン（`/api/auth/`。README の「ログインの API」）は、セッションなどの署名に、秘密の値 `BETTER_AUTH_SECRET` を使います。入っていないときは、`/api/auth/` だけが 500（`AuthConfigurationError`）になります。記録の API（`/api/meals` など）は、入っていなくても今までどおり動きます。

- 値は、推測されにくい長いランダムな文字列にする。本番とプレビューで**別の値**にする（プレビューの値が漏れても、本番のセッションを作れないようにする）
- 値はリポジトリやメモに平文で残さない。手元の `npm run dev` と `npm run dev:api` が使う開発専用の値（`server/devApi.ts`、`package.json`）は、本番にもプレビューにも使わない
- 一度入れた値を変えると、それまでのログイン（セッション）は使えなくなる（もう一度ログインすればよい）

値を作る:

```sh
openssl rand -base64 32
```

### 9-1. プレビュー

プレビューのデプロイで会員登録とログインを試すために、先に入れます（手順5と同じ要領。値は聞かれたときに貼る）。

```sh
npx wrangler pages secret put BETTER_AUTH_SECRET --project-name meal-log --env preview
```

### 9-2. 本番

本番の値は、**公開（Access を外す）の直前**に入れればよいです。入れなくても、今の本番（Access で守った記録の画面と API）は壊れません。

```sh
npx wrangler pages secret put BETTER_AUTH_SECRET --project-name meal-log
```

入ったことは `npx wrangler pages secret list --project-name meal-log`（プレビューは `--env preview` を付ける）で確かめます（名前だけが表示されます）。手順5の注意のとおり、次のデプロイから効きます。

### 9-3. 互換性フラグ `nodejs_compat`

Better Auth は、Node.js の `AsyncLocalStorage` を使います。ダッシュボードの「Workers & Pages」→ `meal-log` →「Settings」→「Runtime」の **Compatibility flags** に、`nodejs_compat` を「Production」と「Preview」の両方で入れます（手元は `wrangler.dev.jsonc` と `npm run dev:api` に入っています）。画面の名前や場所は、Cloudflare の更新で変わることがあります（この手順は実機で確かめていません）。

- 入れなくても、ビルドと記録の API は動きます。ログインの API が動かない（500 になる）ときは、このフラグを確かめる

### 9-4. 確かめる

プレビューのデプロイのアドレスで、`#/signup` から会員登録し、「アカウント」の画面でメールアドレスが出ること、ログアウト、ログイン、間違ったパスワードで「メールアドレスかパスワードが違います」と出ることを確かめます。

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
