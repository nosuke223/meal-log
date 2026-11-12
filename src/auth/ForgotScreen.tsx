import { useId, useState, type FormEvent } from 'react'
import { AUTH_MESSAGES, AuthError, checkEmail, type AuthClient } from './authClient'

type Props = {
  authClient: AuthClient
  onOpenLogin: () => void
  /** 「記録の画面へ」。省略すると、ボタンを出さない（ログインしていないときは、行き先がないため） */
  onBack?: () => void
}

function messageOf(error: unknown): string {
  if (error instanceof AuthError) return error.message
  return `エラーが起きました: ${error instanceof Error ? error.message : String(error)}`
}

/**
 * パスワードの再設定のメールを送る画面。登録されているかにかかわらず、同じ表示にする
 * （登録の有無を外から探られないようにする）
 */
export function ForgotScreen({ authClient, onOpenLogin, onBack }: Props) {
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const id = useId()
  const emailId = `${id}-email`

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    const problem = checkEmail(email)
    if (problem !== null) {
      setError(problem)
      return
    }
    setError(null)
    setBusy(true)
    try {
      await authClient.requestPasswordReset(email.trim())
      setSent(true)
    } catch (cause) {
      setError(messageOf(cause))
      setBusy(false)
    }
  }

  return (
    <main className="screen">
      <header className="screen-header">
        <h1>パスワードの再設定</h1>
        {onBack && (
          <button type="button" onClick={onBack}>
            記録の画面へ
          </button>
        )}
      </header>
      <section className="section">
        {sent ? (
          <p role="status" className="description">
            {AUTH_MESSAGES.resetRequested}
          </p>
        ) : (
          <form className="credentials-form" aria-label="再設定のメール" noValidate onSubmit={submit}>
            <p className="description">登録したメールアドレスを入れてください。パスワードを決め直すためのリンクを送ります。</p>
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
            <div className="field">
              <label htmlFor={emailId} className="field-label">
                メールアドレス
              </label>
              <input
                id={emailId}
                className="text-input"
                type="email"
                name="email"
                autoComplete="email"
                inputMode="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>
            <button type="submit" className="primary" disabled={busy}>
              再設定のメールを送る
            </button>
          </form>
        )}
      </section>
      <section className="section">
        <button type="button" onClick={onOpenLogin}>
          ログインへ
        </button>
      </section>
    </main>
  )
}
