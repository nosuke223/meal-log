import { useEffect, useState } from 'react'
import { AuthError, type AuthClient, type Member } from './authClient'
import { LoginScreen } from './LoginScreen'

type Props = {
  authClient: AuthClient
  /** ログインしていなくて出したログインの画面で、ログインできたとき */
  onSignedIn: (member: Member) => void
  /** ログアウトしたとき */
  onSignedOut: () => void
  onOpenSignup: () => void
  onOpenForgot: () => void
  onBack: () => void
}

type State =
  | { kind: 'loading' }
  | { kind: 'signedIn'; member: Member }
  | { kind: 'signedOut' }
  | { kind: 'error'; message: string }

function messageOf(error: unknown): string {
  if (error instanceof AuthError) return error.message
  return error instanceof Error ? error.message : String(error)
}

/** アカウントの画面。ログイン中のメールアドレスと「ログアウト」を出す。ログインしていなければ、ログインの画面を出す */
export function AccountScreen({ authClient, onSignedIn, onSignedOut, onOpenSignup, onOpenForgot, onBack }: Props) {
  const [state, setState] = useState<State>({ kind: 'loading' })
  const [signOutError, setSignOutError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    authClient
      .getSession()
      .then((member) => {
        if (!cancelled) setState(member === null ? { kind: 'signedOut' } : { kind: 'signedIn', member })
      })
      .catch((cause: unknown) => {
        if (!cancelled) setState({ kind: 'error', message: `ログインの状態を読み込めませんでした: ${messageOf(cause)}` })
      })
    return () => {
      cancelled = true
    }
  }, [authClient])

  async function signOut() {
    setBusy(true)
    setSignOutError(null)
    try {
      await authClient.signOut()
      setState({ kind: 'signedOut' })
      onSignedOut()
    } catch (cause) {
      setSignOutError(`ログアウトできませんでした: ${messageOf(cause)}`)
    } finally {
      setBusy(false)
    }
  }

  if (state.kind === 'signedOut') {
    return (
      <LoginScreen
        authClient={authClient}
        onSignedIn={onSignedIn}
        onOpenSignup={onOpenSignup}
        onOpenForgot={onOpenForgot}
        onBack={onBack}
      />
    )
  }

  return (
    <main className="screen">
      <header className="screen-header">
        <h1>アカウント</h1>
        <button type="button" onClick={onBack}>
          記録の画面へ
        </button>
      </header>
      {state.kind === 'loading' && (
        <p role="status" className="description">
          読み込み中…
        </p>
      )}
      {state.kind === 'error' && (
        <p role="alert" className="error">
          {state.message}
        </p>
      )}
      {state.kind === 'signedIn' && (
        <section className="section" aria-labelledby="account-heading">
          <h2 id="account-heading">ログイン中</h2>
          <p className="account-email">{state.member.email}</p>
          {signOutError && (
            <p role="alert" className="error">
              {signOutError}
            </p>
          )}
          <button type="button" onClick={signOut} disabled={busy}>
            ログアウト
          </button>
        </section>
      )}
    </main>
  )
}
