import { useId, useState, type FormEvent } from 'react'
import { AuthError, checkCredentials, MIN_PASSWORD_LENGTH } from './authClient'

type Props = {
  /** フォームの名前（読み上げ用） */
  label: string
  mode: 'signIn' | 'signUp'
  submitLabel: string
  /** 送る。失敗したら AuthError（message は画面に出す日本語の説明） */
  onSubmit: (email: string, password: string) => Promise<void>
}

function messageOf(error: unknown): string {
  if (error instanceof AuthError) return error.message
  return `エラーが起きました: ${error instanceof Error ? error.message : String(error)}`
}

/** メールアドレスとパスワードを入れるフォーム（ログインと会員登録で使う） */
export function CredentialsForm({ label, mode, submitLabel, onSubmit }: Props) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const id = useId()
  const emailId = `${id}-email`
  const passwordId = `${id}-password`
  const hintId = `${id}-hint`

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    const problem = checkCredentials(email, password, mode)
    if (problem !== null) {
      setError(problem)
      return
    }
    setError(null)
    setBusy(true)
    try {
      await onSubmit(email.trim(), password)
    } catch (cause) {
      setError(messageOf(cause))
      setBusy(false)
    }
  }

  return (
    // 入力の検査は自分で行い、日本語の説明を出す（ブラウザの検査の吹き出しは使わない）
    <form className="credentials-form" aria-label={label} noValidate onSubmit={submit}>
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
          autoComplete={mode === 'signUp' ? 'email' : 'username'}
          inputMode="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor={passwordId} className="field-label">
          パスワード
        </label>
        <input
          id={passwordId}
          className="text-input"
          type="password"
          name="password"
          autoComplete={mode === 'signUp' ? 'new-password' : 'current-password'}
          aria-describedby={mode === 'signUp' ? hintId : undefined}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        {mode === 'signUp' && (
          <span id={hintId} className="field-hint">
            {MIN_PASSWORD_LENGTH}文字以上
          </span>
        )}
      </div>
      <button type="submit" className="primary" disabled={busy}>
        {submitLabel}
      </button>
    </form>
  )
}
