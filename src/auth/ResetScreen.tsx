import { useId, useState, type FormEvent } from 'react'
import { AUTH_MESSAGES, AuthError, checkNewPassword, MIN_PASSWORD_LENGTH, ResetLinkError, type AuthClient } from './authClient'

type Props = {
  authClient: AuthClient
  /** メールのリンクのトークン（画面の中にだけ持つ）。なければ null（読み込み直してなくなった） */
  token: string | null
  /** 変更できたとき */
  onReset: () => void
  onOpenForgot: () => void
  /** 「記録の画面へ」。省略すると、ボタンを出さない（ログインしていないときは、行き先がないため） */
  onBack?: () => void
}

function messageOf(error: unknown): string {
  if (error instanceof AuthError) return error.message
  return `エラーが起きました: ${error instanceof Error ? error.message : String(error)}`
}

/** 新しいパスワードを決める画面（再設定のメールのリンクから開く）。変更できても、ログインした状態にはならない */
export function ResetScreen({ authClient, token, onReset, onOpenForgot, onBack }: Props) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  // 期限切れ、使用済み、正しくないリンク
  const [linkUnusable, setLinkUnusable] = useState(false)
  const [busy, setBusy] = useState(false)
  const id = useId()
  const passwordId = `${id}-password`
  const hintId = `${id}-hint`

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || token === null) return
    const problem = checkNewPassword(password)
    if (problem !== null) {
      setError(problem)
      return
    }
    setError(null)
    setBusy(true)
    try {
      await authClient.resetPassword(token, password)
      onReset()
    } catch (cause) {
      if (cause instanceof ResetLinkError) setLinkUnusable(true)
      else setError(messageOf(cause))
      setBusy(false)
    }
  }

  let body
  if (token === null) {
    body = (
      <p role="alert" className="error">
        {AUTH_MESSAGES.resetLinkMissing}
      </p>
    )
  } else if (linkUnusable) {
    body = (
      <>
        <p role="alert" className="error">
          {AUTH_MESSAGES.resetLinkUnusable}
        </p>
        <button type="button" onClick={onOpenForgot}>
          再設定のメールを送る
        </button>
      </>
    )
  } else {
    body = (
      <form className="credentials-form" aria-label="新しいパスワード" noValidate onSubmit={submit}>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <div className="field">
          <label htmlFor={passwordId} className="field-label">
            新しいパスワード
          </label>
          <input
            id={passwordId}
            className="text-input"
            type="password"
            name="password"
            autoComplete="new-password"
            aria-describedby={hintId}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <span id={hintId} className="field-hint">
            {MIN_PASSWORD_LENGTH}文字以上
          </span>
        </div>
        <button type="submit" className="primary" disabled={busy}>
          パスワードを変更する
        </button>
      </form>
    )
  }

  return (
    <main className="screen">
      <header className="screen-header">
        <h1>新しいパスワード</h1>
        {onBack && (
          <button type="button" onClick={onBack}>
            記録の画面へ
          </button>
        )}
      </header>
      <section className="section">{body}</section>
    </main>
  )
}
