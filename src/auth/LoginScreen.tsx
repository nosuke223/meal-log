import type { AuthClient } from './authClient'
import { CredentialsForm } from './CredentialsForm'

type Props = {
  authClient: AuthClient
  /** ログインできたとき */
  onSignedIn: () => void
  onOpenSignup: () => void
  onBack: () => void
}

/** ログインの画面 */
export function LoginScreen({ authClient, onSignedIn, onOpenSignup, onBack }: Props) {
  return (
    <main className="screen">
      <header className="screen-header">
        <h1>ログイン</h1>
        <button type="button" onClick={onBack}>
          記録の画面へ
        </button>
      </header>
      <section className="section">
        <CredentialsForm
          label="ログイン"
          mode="signIn"
          submitLabel="ログイン"
          onSubmit={async (email, password) => {
            await authClient.signIn(email, password)
            onSignedIn()
          }}
        />
      </section>
      <section className="section">
        <p className="description">はじめて使うときは、会員登録をしてください。</p>
        <button type="button" onClick={onOpenSignup}>
          会員登録へ
        </button>
      </section>
    </main>
  )
}
