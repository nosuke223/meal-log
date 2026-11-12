import { useEffect, useState } from 'react'
import { LoginExpiredError } from '../meals/mealRepository'
import type { PlanStatus } from '../meals/plan'
import type { PlanClient } from '../plan/planClient'
import { AuthError, type AuthClient, type Member } from './authClient'
import { LoginScreen } from './LoginScreen'

type Props = {
  authClient: AuthClient
  planClient: PlanClient
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

/** プランの読み込みの状態（ログインの状態とは別に持つ。プランだけが読めなくても、ログアウトは使える） */
type PlanState = { kind: 'loading' } | { kind: 'loaded'; status: PlanStatus } | { kind: 'error'; message: string }

function messageOf(error: unknown): string {
  if (error instanceof AuthError) return error.message
  return error instanceof Error ? error.message : String(error)
}

function planText(status: PlanStatus): string {
  if (status.plan === 'paid' || status.limit === null) return `プラン: 有料（記録 ${status.count} 品。上限なし）`
  return `プラン: 無料（記録 ${status.count} / ${status.limit} 品）`
}

/**
 * アカウントの画面。ログイン中のメールアドレス、プランと記録の数、「ログアウト」を出す。
 * ログインしていなければ、ログインの画面を出す
 */
export function AccountScreen({
  authClient,
  planClient,
  onSignedIn,
  onSignedOut,
  onOpenSignup,
  onOpenForgot,
  onBack,
}: Props) {
  const [state, setState] = useState<State>({ kind: 'loading' })
  const [planState, setPlanState] = useState<PlanState>({ kind: 'loading' })
  const [signOutError, setSignOutError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const signedInEmail = state.kind === 'signedIn' ? state.member.email : null

  // ログイン中と確かめられたら、プランを読む
  useEffect(() => {
    if (signedInEmail === null) return
    let cancelled = false
    planClient
      .getPlan()
      .then((status) => {
        if (!cancelled) setPlanState({ kind: 'loaded', status })
      })
      .catch((cause: unknown) => {
        if (cancelled) return
        // ログインの期限が切れていたら、ログインの画面にする
        if (cause instanceof LoginExpiredError) {
          setState({ kind: 'signedOut' })
          onSignedOut()
          return
        }
        setPlanState({ kind: 'error', message: `プランを読み込めませんでした: ${messageOf(cause)}` })
      })
    return () => {
      cancelled = true
    }
    // onSignedOut は描画ごとに変わるので、読み直しのきっかけにしない
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planClient, signedInEmail])

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

  // 「記録の画面へ」は、ログイン中のときだけ出す（記録の画面は、ログインしていないと開けない）
  if (state.kind === 'signedOut') {
    return (
      <LoginScreen authClient={authClient} onSignedIn={onSignedIn} onOpenSignup={onOpenSignup} onOpenForgot={onOpenForgot} />
    )
  }

  return (
    <main className="screen">
      <header className="screen-header">
        <h1>アカウント</h1>
        {/* ログイン中と確かめられるまでは出さない */}
        {state.kind === 'signedIn' && (
          <button type="button" onClick={onBack}>
            記録の画面へ
          </button>
        )}
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
          {planState.kind === 'loading' && (
            <p role="status" className="description">
              プランを読み込み中…
            </p>
          )}
          {planState.kind === 'loaded' && <p className="account-plan">{planText(planState.status)}</p>}
          {planState.kind === 'error' && (
            <p role="alert" className="error">
              {planState.message}
            </p>
          )}
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
