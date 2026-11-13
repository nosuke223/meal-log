import { useId, useState, type FormEvent } from 'react'
import { AUTH_MESSAGES, AuthError, type AuthClient } from './authClient'

type Props = {
  authClient: AuthClient
  /** 退会できたとき */
  onDeleted: () => void
}

function messageOf(error: unknown): string {
  if (error instanceof AuthError) return error.message
  return `エラーが起きました: ${error instanceof Error ? error.message : String(error)}`
}

/**
 * アカウントの画面の「退会」の節。パスワードを入れて「退会する」を押すと、画面の中で確かめてから消す
 * （ブラウザの確認ダイアログは使わない）。失敗したら、その場にエラーを出し、画面はそのまま
 */
export function DeleteAccountSection({ authClient, onDeleted }: Props) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const id = useId()
  const passwordId = `${id}-password`

  function requestDelete(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    if (password === '') {
      setError(AUTH_MESSAGES.emptyCurrentPassword)
      return
    }
    setError(null)
    setConfirming(true)
  }

  async function confirmDelete() {
    if (busy) return
    setBusy(true)
    try {
      await authClient.deleteAccount(password)
    } catch (cause) {
      setError(messageOf(cause))
      setPassword('')
      setConfirming(false)
      setBusy(false)
      return
    }
    onDeleted()
  }

  return (
    <section className="section" aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`}>退会</h2>
      <p className="description">
        退会すると、アカウントと、保存しているすべての記録が消え、元に戻せません。バックアップには最長30日残ります。
        必要なら、先にデータ画面で記録を書き出してください。同じメールアドレスで登録し直せますが、前の記録は戻りません。
      </p>
      <form className="credentials-form" aria-label="退会" noValidate onSubmit={requestDelete}>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <div className="field">
          <label htmlFor={passwordId} className="field-label">
            パスワード
          </label>
          <input
            id={passwordId}
            className="text-input"
            type="password"
            name="password"
            autoComplete="current-password"
            value={password}
            disabled={confirming}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>
        {confirming ? (
          <div role="group" aria-label="退会の確認" className="confirm">
            <p>本当に退会しますか。この操作は取り消せません。</p>
            <div className="actions">
              <button type="button" className="danger" onClick={confirmDelete} disabled={busy}>
                退会を確定する
              </button>
              <button type="button" onClick={() => setConfirming(false)} disabled={busy}>
                やめる
              </button>
            </div>
          </div>
        ) : (
          <button type="submit" className="danger">
            退会する
          </button>
        )}
      </form>
    </section>
  )
}
