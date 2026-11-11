import type { AuthClient } from './authClient'
import { CredentialsForm } from './CredentialsForm'

type Props = {
  authClient: AuthClient
  /** 登録できたとき（そのままログインした状態になっている） */
  onSignedUp: () => void
  onOpenLogin: () => void
  onBack: () => void
}

/** 会員登録の画面 */
export function SignupScreen({ authClient, onSignedUp, onOpenLogin, onBack }: Props) {
  return (
    <main className="screen">
      <header className="screen-header">
        <h1>会員登録</h1>
        <button type="button" onClick={onBack}>
          記録の画面へ
        </button>
      </header>
      <section className="section">
        <CredentialsForm
          label="会員登録"
          mode="signUp"
          submitLabel="登録する"
          onSubmit={async (email, password) => {
            await authClient.signUp(email, password)
            onSignedUp()
          }}
        />
      </section>
      <section className="section">
        <p className="description">登録したことがあるときは、ログインしてください。</p>
        <button type="button" onClick={onOpenLogin}>
          ログインへ
        </button>
      </section>
    </main>
  )
}
