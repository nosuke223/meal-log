import { useEffect, useState } from 'react'
import { formatDate } from '../meals/labels'
import {
  MEAL_TYPES,
  type DishType,
  type Genre,
  type MealChanges,
  type MealRecord,
  type MealType,
} from '../meals/mealRecord'
import type { MealRepository } from '../meals/mealRepository'
import { statusForDate } from '../meals/mealStatus'
import { MealSection } from './MealSection'

type Props = {
  repository: MealRepository
  /** 表示する日（YYYY-MM-DD） */
  date: string
  /** 今日（YYYY-MM-DD）。状態（予定／食べた）の決まりに使う */
  today: string
  /** 保存データが画面の外で変わる（日が過ぎた予定の自動更新など）たびに変わる値。変わると読み直す */
  revision?: number
  /** 日が過ぎた予定の自動更新に失敗したときのエラー。あれば表示する */
  autoUpdateError?: string | null
  onOpenCalendar: () => void
  onOpenData: () => void
  onOpenAccount: () => void
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** 1日分の記録の画面。追加・変更・削除ができる */
export function DayScreen({
  repository,
  date,
  today,
  revision,
  autoUpdateError,
  onOpenCalendar,
  onOpenData,
  onOpenAccount,
}: Props) {
  // records は loaded.date の日の一覧（日を移った直後の失敗で、前の日の記録を残さないために日も持つ）
  const [loaded, setLoaded] = useState<{ date: string | null; records: MealRecord[] }>({ date: null, records: [] })
  const records = loaded.records
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    repository
      .listByDate(date)
      .then((list) => {
        if (cancelled) return
        setLoaded({ date, records: list })
        setError(null)
      })
      .catch((cause: unknown) => {
        if (cancelled) return
        // 同じ日の読み直しに失敗したときは、一覧を前の表示のままにする。日を移った最初の読み込みなら空にする
        setLoaded((previous) => (previous.date === date ? previous : { date, records: [] }))
        setError(`記録を読み込めませんでした: ${messageOf(cause)}`)
      })
    return () => {
      cancelled = true
    }
  }, [repository, date, revision])

  /**
   * 保存の操作を行い、一覧を読み直す。保存に成功したら true（読み直しの成否にかかわらない）。
   * 読み直しだけ失敗したときは、一覧は前の表示のままにし、保存はできたことがわかるエラーを表示する
   */
  async function run(action: () => Promise<unknown>): Promise<boolean> {
    try {
      await action()
    } catch (cause) {
      setError(`保存できませんでした: ${messageOf(cause)}`)
      return false
    }
    try {
      setLoaded({ date, records: await repository.listByDate(date) })
      setError(null)
    } catch (cause) {
      setError(`保存しました。一覧を読み込めませんでした: ${messageOf(cause)}`)
    }
    return true
  }

  function add(mealType: MealType, name: string, genre: Genre | null, dishType: DishType | null) {
    return run(() =>
      repository.create({ date, mealType, name, genre, dishType, status: statusForDate(date, today) }),
    )
  }

  function update(id: string, changes: MealChanges) {
    return run(() => repository.update(id, changes))
  }

  function remove(id: string) {
    return run(() => repository.delete(id))
  }

  return (
    <main className="screen">
      <header className="screen-header">
        <div>
          <h1>meal-log</h1>
          <p className="date">
            <time dateTime={date}>{formatDate(date)}</time>
          </p>
        </div>
        <div className="header-actions">
          <button type="button" onClick={onOpenCalendar}>
            カレンダー
          </button>
          <button type="button" onClick={onOpenData}>
            データ
          </button>
          <button type="button" onClick={onOpenAccount}>
            アカウント
          </button>
        </div>
      </header>
      {autoUpdateError && (
        <p role="alert" className="error">
          {autoUpdateError}
        </p>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {MEAL_TYPES.map((mealType) => (
        <MealSection
          key={mealType}
          mealType={mealType}
          records={records.filter((record) => record.mealType === mealType)}
          today={today}
          onAdd={add}
          onUpdate={update}
          onDelete={remove}
        />
      ))}
    </main>
  )
}
