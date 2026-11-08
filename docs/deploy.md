# Cloudflare への公開と Access の設定手順

作った画面と API を Cloudflare Pages（画面と Pages Functions）と D1（データベース）に公開し、Cloudflare Access で所有者だけが開けるようにする手順です。上から順に行ってください。デプロイは手動です（GitHub からの自動デプロイは設定しません）。

`<…>` の部分は、自分の値に置き換えます。値（ID、チーム名、AUD タグなど）はリポジトリに書かず、Cloudflare の画面と手元のメモにだけ残してください。

## 全体像と、決めておく値

| 名前 | 内容 | この文書での例 |
| --- | --- | --- |
| D1 のデータベース名 | 記録を入れるデータベース | `meal-log` |
| Pages のプロジェクト名 | 公開するサイト。アドレスは `https://<プロジェクト名>.pages.dev` | `meal-log` |
| 所有者のメールアドレス | Access で許可する人 | `<自分のメールアドレス>` |

アプリが読む環境変数とバインディングは次のとおりです（詳しくは README の「環境変数」）。

| 名前 | 内容 | 設定する場所 |
| --- | --- | --- |
| `DB` | D1 のバインディング | 手順3（Pages の設定） |
| `ACCESS_TEAM_NAME` | Access のチーム名 | 手順5 |
| `ACCESS_AUD` | Access のアプリケーションの AUD タグ | 手順5 |
| `DEV_USER_EMAIL` | 手元の開発専用。**本番には設定しない** | 設定しない（手順6） |

## 事前の準備

- Cloudflare のアカウントがあり、Zero Trust（Access）が使える（無料のプランで足ります。初めて使うときは、Zero Trust のチーム名を決める画面が出ます）
- このリポジトリを手元に clone し、`npm ci` で依存を入れてある
- wrangler にログインしてある

```sh
npx wrangler login
```

## 1. D1 のデータベースを作る

```sh
npx wrangler d1 create meal-log
```

出力に `database_id`（UUID）が出ます。手順2で使うので控えます。ダッシュボードでは「Storage & Databases」→「D1 SQL Database」に作られたデータベースが見えます。

## 2. 本番の D1 にマイグレーションを適用する

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

マイグレーションを増やしたときも、同じコマンドで本番に適用します（適用済みのものは飛ばされます）。

## 3. Pages のプロジェクトを作って、最初のデプロイをする

### 3-1. プロジェクトを作る

手動のデプロイ（Direct Upload）で使うプロジェクトを作ります。

```sh
npx wrangler pages project create meal-log --production-branch main
```

### 3-2. ビルドしてデプロイする

| 項目 | 値 |
| --- | --- |
| ビルドのコマンド | `npm run build`（型検査と `vite build`） |
| 出力先 | `dist` |
| API（Pages Functions） | リポジトリ直下の `functions/`（`functions/api/[[path]].ts`）。`wrangler pages deploy` を、リポジトリのルートで実行すると、自動で含まれる |

```sh
npm run build
npx wrangler pages deploy dist --project-name meal-log --branch main
```

> **注意**: 必ずリポジトリのルートで実行してください。`functions/` はコマンドを実行した場所から探されるので、別の場所で実行すると API が入りません。

> **注意**: 手元の `npm run dev` と `npm run dev:api` が使う `DEV_USER_EMAIL` は、`dist/` にも `functions/` にも入っていません。入れないでください。

この時点では環境変数がないので、API は 500（`AuthConfigurationError`）を返します。手順3-3から5で設定した後に、もう一度デプロイします。

### 3-3. D1 をつなぐ（バインディング）

ダッシュボードの「Workers & Pages」→ `meal-log` →「Settings」→「Bindings」→「Add」→「D1 database」を選び、次のように設定して保存します。

- Variable name: `DB`（この名前は変えない。コードが `env.DB` を読む）
- D1 database: 手順1で作った `meal-log`

「Production」の環境に設定します。確認のためのプレビューの環境でも使うなら、「Preview」にも同じ設定をします（Preview は、本番と同じデータベースを指すと本番の記録を読み書きするので、使わないなら設定しなくてよい）。

### 3-4. 環境変数

環境変数は手順5で設定します。

## 4. Access のアプリケーションとポリシーを作る

ダッシュボードの「Zero Trust」→「Access」→「Applications」（名前や場所は画面の更新で変わることがあります）。

1. 「Add an application」→「Self-hosted」を選ぶ
2. Application name: `meal-log`
3. Session Duration: 好みの長さ（ログインの期限。切れると画面にエラーが出るので、読み込み直してログインし直す）
4. Public hostname（Application domain）に、サイトのアドレスを入れる
   - Domain: `<プロジェクト名>.pages.dev`
   - **Path は空にする**（サイト全体を守る。`/api` もこれで守られる）
5. Policy を作る
   - Policy name: `owner`
   - Action: `Allow`
   - Include: 「Emails」→ `<自分のメールアドレス>`（所有者のメールアドレスだけ。「Everyone」や「Emails ending in」にしない）
6. 保存する
7. 作ったアプリケーションの「Overview」にある **Application Audience (AUD) Tag** を控える（手順5で使う）

> **注意（失敗しやすい所）: Access で `/api` も守ること。** Path を空にしてサイト全体を守れば、`/api` も同じアプリケーションに入ります。「`/` だけ」「画面のパスだけ」のように Path を決めると、`/api` が守られず、Access を通らない API の呼び出しになります（API も JWT を検証するので 401 になりますが、守りは二重にしておく）。別のアプリケーションに分けるときは、`/api` にも同じ許可の Policy を付けてください。

> **注意: `pages.dev` のサブドメイン（`<ハッシュ>.<プロジェクト名>.pages.dev`）は、別のホスト名です。** Pages の「Settings」→「General」→「Access policy」で「Enable」にすると、プレビューのアドレスにも Access が掛かります（Pages が自動で作る Access のアプリケーションです）。手順7の「Access を通っていないときに 401 が返る」の確認では、この掛かっていないアドレスを使うので、確認の後で掛けてください。

Zero Trust の **チーム名** は、「Settings」→「Custom Pages」の「Team domain」（`<チーム名>.cloudflareaccess.com`）の `<チーム名>` の部分です。控えます。

## 5. Access のチーム名と AUD タグを、Pages の環境変数に設定する

「Workers & Pages」→ `meal-log` →「Settings」→「Variables and Secrets」→「Add」で、「Production」に次の2つを「Text」で追加します。

| Variable name | 値 |
| --- | --- |
| `ACCESS_TEAM_NAME` | `<チーム名>`（`<チーム名>.cloudflareaccess.com` の前の部分だけ。`https://` や `.cloudflareaccess.com` は付けない。英数字とハイフン） |
| `ACCESS_AUD` | 手順4で控えた AUD タグ |

> **注意**: 環境変数の変更は、次のデプロイから効きます。設定したら、手順3-2のコマンドでもう一度デプロイしてください。

```sh
npm run build
npx wrangler pages deploy dist --project-name meal-log --branch main
```

## 6. 認証を省く設定（開発用）が本番に入っていないことを確かめる

`DEV_USER_EMAIL` を設定すると、API は JWT を検証せず、誰でもその人として記録を読み書きできます。本番とプレビューの環境のどちらにも、設定されていないことを確かめます。

1. ダッシュボードの「Settings」→「Variables and Secrets」に、`DEV_USER_EMAIL` がない（「Production」と「Preview」の両方）。あれば削除して、もう一度デプロイする
2. 手元のリポジトリの設定ファイルに書かれていない

```sh
grep -rn DEV_USER_EMAIL wrangler.dev.jsonc wrangler.migrate.jsonc dist
```

何も表示されなければ問題ありません（`wrangler.migrate.jsonc` がないときは、そのエラーは無視してよい）。

3. 公開したサイトで実際に確かめる（手順7の「Access を通っていないときの 401」が、そのまま確認になります。`DEV_USER_EMAIL` が入っていると、401 ではなく 200 が返ります）

> **注意**: `npm run dev:api` のコマンドには `--binding DEV_USER_EMAIL=dev@example.com` が入っています。これは手元の確認用です。本番のデプロイ（`wrangler pages deploy`）のコマンドには付けず、`wrangler pages secret put` などでも設定しないでください。

## 7. 動作確認

1. **開く**: ブラウザで `https://<プロジェクト名>.pages.dev` を開く。Access のログイン画面が出る。手順4で許可したメールアドレスでログインすると、今日の記録の画面が開く
   - 許可していないメールアドレスでは、入れない（Access に拒否される）
2. **記録する**: 昼の欄に品を追加する。読み込み直しても残っている
3. **別の端末で見える**: 別の端末（またはシークレットウィンドウ）で同じアドレスを開き、同じメールアドレスでログインする。2. の記録が見える
4. **Access を通っていないリクエストは API が 401 を返す**: Access が掛かっていないアドレス（デプロイごとに付く `https://<ハッシュ>.<プロジェクト名>.pages.dev`。デプロイしたときに wrangler が表示する。手順4の注意のとおり、Pages の Access policy を掛けていないもの）に、ログインなしで API を呼ぶ

```sh
curl -i 'https://<ハッシュ>.<プロジェクト名>.pages.dev/api/meals'
```

   - 期待する結果: `401`、本文は `{"error":{"type":"Unauthorized",…}}`
   - `500`（`AuthConfigurationError`）: 手順5の環境変数がない、または入れた後にデプロイしていない
   - `200`: **危険**。`DEV_USER_EMAIL` が設定されている。すぐに手順6で消して、もう一度デプロイする
   - 本番のアドレス（Access が掛かっている）を、ログインなしで `curl` すると、API より前に Access がログインの画面への転送（302）や 403 を返します。これも、守られている印です

   確かめたら、Pages の「Access policy」を有効にして、プレビューのアドレスも守る。

5. **ログインの期限切れ**: Session Duration が過ぎた後に操作すると、画面に「ログインの期限が切れました。ページを読み込み直してください」と出る。読み込み直すとログインの画面になる（正しい動作）

## 8. 古い版（localStorage）の記録をサーバーへ移す

以前の版（記録をブラウザ内の localStorage に保存していた版）の記録は、自動では移りません。README の「ブラウザ内の記録をサーバーへ移す」の手順で移します。

1. 以前の版を、記録を入れていたブラウザで開き、データ画面の「書き出す」でファイル（`meal-log-YYYY-MM-DD.json`）を保存する
2. 公開したサイトを開いてログインし、データ画面の「読み込む」で、1. のファイルを選び、「取り込む」を押す
3. 記録の画面やカレンダーで、記録が移ったことを確かめる

同じファイルを2回読み込んでも、記録は増えません。

> **注意**: 以前の版の記録は、書き出すまでは、そのブラウザの中にしかありません。以前の版のサイト（アドレス）のデータを消す前に、必ず書き出して、移ったことを確かめてください。

## 更新するとき

画面や API を変えたら、手順3-2のコマンド（`npm run build` と `wrangler pages deploy`）でもう一度デプロイします。マイグレーションを増やしたときは、先に手順2のコマンドで本番の D1 に適用してからデプロイします。
