import { useEffect, useState } from 'react'
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
  onOpenCalendar: () => void
}

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土']

function formatDate(date: string): string {
  const [year, month, day] = date.split('-').map(Number)
  const weekday = WEEKDAYS[new Date(year, month - 1, day).getDay()]
  return `${year}年${month}月${day}日（${weekday}）`
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** 1日分の記録の画面。追加・変更・削除ができる */
export function DayScreen({ repository, date, today, revision, onOpenCalendar }: Props) {
  const [records, setRecords] = useState<MealRecord[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    repository
      .listByDate(date)
      .then((list) => {
        if (cancelled) return
        setRecords(list)
        setError(null)
      })
      .catch((cause: unknown) => {
        if (cancelled) return
        setRecords([])
        setError(`記録を読み込めませんでした: ${messageOf(cause)}`)
      })
    return () => {
      cancelled = true
    }
  }, [repository, date, revision])

  /** 保存の操作を行い、一覧を読み直す。成功したら true */
  async function run(action: () => Promise<unknown>): Promise<boolean> {
    try {
      await action()
      setRecords(await repository.listByDate(date))
      setError(null)
      return true
    } catch (cause) {
      setError(`保存できませんでした: ${messageOf(cause)}`)
      return false
    }
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
        <button type="button" onClick={onOpenCalendar}>
          カレンダー
        </button>
      </header>
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
