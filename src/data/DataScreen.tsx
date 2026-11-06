import { useRef, useState, type ChangeEvent } from 'react'
import type { MealRecord } from '../meals/mealRecord'
import type { MealRepository } from '../meals/mealRepository'
import { buildDataFile, dataFileName, parseDataFile, planImport, type ImportPlan } from './dataFile'

type Props = {
  repository: MealRepository
  /** 今日（YYYY-MM-DD）。取り込む記録の状態（予定／食べた）の決まりに使う */
  today: string
  onBack: () => void
}

/** 確認を待っている読み込み */
type Pending = {
  fileName: string
  records: MealRecord[]
  plan: ImportPlan
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function countsText(plan: ImportPlan): string {
  return `追加 ${plan.added.length}件、更新 ${plan.updated.length}件、変更なし ${plan.unchangedCount}件`
}

/** 文字列をファイルとしてダウンロードさせる */
function download(content: string, fileName: string) {
  const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.append(link)
  link.click()
  link.remove()
  // すぐに消すとダウンロードが始まらないブラウザがあるので、少し待ってから消す
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** データの画面。記録をファイルに書き出し、ファイルから読み込んで今あるデータと混ぜる */
export function DataScreen({ repository, today, onBack }: Props) {
  const fileInput = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [pending, setPending] = useState<Pending | null>(null)

  function start() {
    setError(null)
    setMessage(null)
    setPending(null)
  }

  async function exportRecords() {
    start()
    setBusy(true)
    try {
      const records = await repository.listAll()
      const now = new Date()
      download(buildDataFile(records, now), dataFileName(now))
      setMessage(`${records.length}件の記録を書き出しました`)
    } catch (cause) {
      setError(`書き出せませんでした: ${messageOf(cause)}`)
    } finally {
      setBusy(false)
    }
  }

  async function selectFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    // 同じファイルを選び直しても読み込めるよう、選んだファイルを外しておく
    event.target.value = ''
    if (!file) return
    start()
    setBusy(true)
    try {
      let records: MealRecord[]
      try {
        records = parseDataFile(await file.text())
      } catch (cause) {
        setError(`読み込めませんでした（何も取り込んでいません）: ${messageOf(cause)}`)
        return
      }
      try {
        const existing = await repository.listAll()
        setPending({ fileName: file.name, records, plan: planImport(existing, records, today) })
      } catch (cause) {
        setError(`今の記録を読み込めませんでした（何も取り込んでいません）: ${messageOf(cause)}`)
      }
    } finally {
      setBusy(false)
    }
  }

  async function confirmImport() {
    if (!pending) return
    setBusy(true)
    try {
      // 確認の間にデータが変わっていても規則どおりになるよう、今のデータで決め直す
      const plan = planImport(await repository.listAll(), pending.records, today)
      await repository.importRecords([...plan.added, ...plan.updated])
      setMessage(`取り込みました: ${countsText(plan)}`)
    } catch (cause) {
      setError(`取り込めませんでした（データは元のままです）: ${messageOf(cause)}`)
    } finally {
      setPending(null)
      setBusy(false)
    }
  }

  function cancelImport() {
    setPending(null)
    setMessage('取り込みを取り消しました（何も変えていません）')
  }

  return (
    <main className="screen">
      <header className="screen-header">
        <h1>データ</h1>
        <button type="button" onClick={onBack}>
          記録の画面へ
        </button>
      </header>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="notice">
          {message}
        </p>
      )}
      <section className="section" aria-labelledby="export-heading">
        <h2 id="export-heading">書き出し</h2>
        <p className="description">すべての記録を、JSON のファイル（meal-log-日付.json）としてダウンロードします。</p>
        <button type="button" className="primary" onClick={exportRecords} disabled={busy}>
          書き出す
        </button>
      </section>
      <section className="section" aria-labelledby="import-heading">
        <h2 id="import-heading">読み込み</h2>
        <p className="description">
          書き出したファイルを選ぶと、今ある記録と混ぜて取り込みます。同じ記録は更新日時が新しい方を残し、今ある記録は消しません。
        </p>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          className="visually-hidden"
          aria-label="読み込むファイル"
          tabIndex={-1}
          onChange={selectFile}
        />
        {pending ? (
          <div role="group" aria-label="取り込みの確認" className="confirm">
            <p className="confirm-file">{pending.fileName}</p>
            <p>{countsText(pending.plan)}。取り込みますか？</p>
            <div className="actions">
              <button type="button" className="primary" onClick={confirmImport} disabled={busy}>
                取り込む
              </button>
              <button type="button" onClick={cancelImport} disabled={busy}>
                取り消す
              </button>
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => fileInput.current?.click()} disabled={busy}>
            読み込む
          </button>
        )}
      </section>
    </main>
  )
}
