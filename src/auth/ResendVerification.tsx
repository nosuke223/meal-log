import { useId, useState, type FormEvent } from 'react'
import { AUTH_MESSAGES, AuthError, checkEmail, type AuthClient } from './authClient'

function messageOf(error: unknown): string {
  if (error instanceof AuthError) return error.message
  return `エラーが起きました: ${error instanceof Error ? error.message : String(error)}`
}

type ResendState = { kind: 'idle' } | { kind: 'busy' } | { kind: 'sent' } | { kind: 'error'; message: string }

/** 確認のメールを送り直す処理と、その状態 */
function useResend(authClient: AuthClient) {
  const [state, setState] = useState<ResendState>({ kind: 'idle' })

  async function resend(email: string) {
    if (state.kind === 'busy') return
    setState({ kind: 'busy' })
    try {
      await authClient.sendVerificationEmail(email)
      setState({ kind: 'sent' })
    } catch (cause) {
      setState({ kind: 'error', message: messageOf(cause) })
    }
  }

  function fail(message: string) {
    setState({ kind: 'error', message })
  }

  return { state, resend, fail }
}

function ResendResult({ state }: { state: ResendState }) {
  if (state.kind === 'sent') {
    return (
      <p role="status" className="description">
        {AUTH_MESSAGES.verificationSent}
      </p>
    )
  }
  if (state.kind === 'error') {
    return (
      <p role="alert" className="error">
        {state.message}
      </p>
    )
  }
  return null
}

const RESEND_LABEL = '確認のメールをもう一度送る'

/** 「確認のメールをもう一度送る」ボタン（宛先は、ログインのフォームに入れたメールアドレス） */
export function ResendVerificationButton({ authClient, email }: { authClient: AuthClient; email: string }) {
  const { state, resend } = useResend(authClient)
  return (
    <div className="resend-verification">
      <button type="button" onClick={() => void resend(email)} disabled={state.kind === 'busy'}>
        {RESEND_LABEL}
      </button>
      <ResendResult state={state} />
    </div>
  )
}

/** メールアドレスを入れて、確認のメールを送り直すフォーム（期限切れや使用済みのリンクを開いたとき） */
export function ResendVerificationForm({ authClient }: { authClient: AuthClient }) {
  const { state, resend, fail } = useResend(authClient)
  const [email, setEmail] = useState('')
  const id = useId()
  const emailId = `${id}-email`

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const problem = checkEmail(email)
    if (problem !== null) {
      fail(problem)
      return
    }
    void resend(email.trim())
  }

  return (
    <form className="credentials-form" aria-label="確認のメールの送り直し" noValidate onSubmit={submit}>
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
      <button type="submit" disabled={state.kind === 'busy'}>
        {RESEND_LABEL}
      </button>
      <ResendResult state={state} />
    </form>
  )
}
