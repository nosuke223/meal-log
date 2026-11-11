import { useState } from 'react'
import { AUTH_MESSAGES, type AuthClient } from './authClient'
import { CredentialsForm } from './CredentialsForm'

type Props = {
  authClient: AuthClient
  onOpenLogin: () => void
  onBack: () => void
}

/**
 * 会員登録の画面。送ると、確認のメールを送ったことを出す（ログインした状態にはならない）。
 * すでに登録されているメールアドレスでも、同じ表示にする（登録の有無を外から探られないようにする）
 */
export function SignupScreen({ authClient, onOpenLogin, onBack }: Props) {
  const [sent, setSent] = useState(false)
  return (
    <main className="screen">
      <header className="screen-header">
        <h1>会員登録</h1>
        <button type="button" onClick={onBack}>
          記録の画面へ
        </button>
      </header>
      <section className="section">
        {sent ? (
          <p role="status" className="description">
            {AUTH_MESSAGES.verificationSent}
          </p>
        ) : (
          <CredentialsForm
            label="会員登録"
            mode="signUp"
            submitLabel="登録する"
            onSubmit={async (email, password) => {
              await authClient.signUp(email, password)
              setSent(true)
            }}
          />
        )}
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
