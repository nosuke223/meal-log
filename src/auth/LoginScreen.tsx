import { AUTH_MESSAGES, type AuthClient, type LoginNotice, type Member } from './authClient'
import { CredentialsForm } from './CredentialsForm'
import { ResendVerificationForm } from './ResendVerification'

type Props = {
  authClient: AuthClient
  /** 確認のメールのリンクを開いた結果か、パスワードを再設定した結果。なければ null */
  notice?: LoginNotice | null
  /** ログインできたとき */
  onSignedIn: (member: Member) => void
  onOpenSignup: () => void
  onOpenForgot: () => void
  onBack: () => void
}

/** 結果の説明と、確認のメールの送り直しのフォームを出すか */
const NOTICES: Record<LoginNotice, { message: string; failed: boolean; resend: boolean }> = {
  'password-reset': { message: AUTH_MESSAGES.passwordReset, failed: false, resend: false },
  verified: { message: AUTH_MESSAGES.emailVerified, failed: false, resend: false },
  'link-used': { message: AUTH_MESSAGES.linkUsed, failed: true, resend: true },
  'link-expired': { message: AUTH_MESSAGES.linkExpired, failed: true, resend: true },
  'link-invalid': { message: AUTH_MESSAGES.linkInvalid, failed: true, resend: true },
  'link-error': { message: AUTH_MESSAGES.linkError, failed: true, resend: false },
  'session-expired': { message: AUTH_MESSAGES.sessionExpired, failed: true, resend: false },
}

/** ログインの画面 */
export function LoginScreen({ authClient, notice: result = null, onSignedIn, onOpenSignup, onOpenForgot, onBack }: Props) {
  const notice = result === null ? null : NOTICES[result]
  return (
    <main className="screen">
      <header className="screen-header">
        <h1>ログイン</h1>
        <button type="button" onClick={onBack}>
          記録の画面へ
        </button>
      </header>
      {notice && (
        <section className="section" aria-label="お知らせ">
          <p role={notice.failed ? 'alert' : 'status'} className={notice.failed ? 'error' : 'description'}>
            {notice.message}
          </p>
          {notice.resend && <ResendVerificationForm authClient={authClient} />}
        </section>
      )}
      <section className="section">
        <CredentialsForm
          label="ログイン"
          mode="signIn"
          submitLabel="ログイン"
          resendClient={authClient}
          onSubmit={async (email, password) => {
            onSignedIn(await authClient.signIn(email, password))
          }}
        />
      </section>
      <section className="section">
        <button type="button" onClick={onOpenForgot}>
          パスワードを忘れた
        </button>
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
