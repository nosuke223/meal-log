import { useId, useState } from 'react'
import { DISH_TYPE_LABELS, GENRE_LABELS, MEAL_TYPE_LABELS } from '../meals/labels'
import {
  DISH_TYPES,
  GENRES,
  isValidDate,
  MEAL_TYPES,
  type DishType,
  type Genre,
  type MealChanges,
  type MealRecord,
  type MealType,
} from '../meals/mealRecord'
import { canToggleStatus, statusForDate } from '../meals/mealStatus'
import { ChoiceButtons } from './ChoiceButtons'
import { GenreTag } from './GenreTag'
import { StatusBadge } from './StatusBadge'

type Props = {
  record: MealRecord
  /** 今日（YYYY-MM-DD） */
  today: string
  onUpdate: (id: string, changes: MealChanges) => Promise<boolean>
  onDelete: (id: string) => Promise<boolean>
}

export function MealItem({ record, today, onUpdate, onDelete }: Props) {
  const nameId = useId()
  const [editing, setEditing] = useState(false)
  const [toggling, setToggling] = useState(false)

  async function toggle() {
    setToggling(true)
    await onUpdate(record.id, { status: record.status === 'planned' ? 'eaten' : 'planned' })
    setToggling(false)
  }

  if (!editing) {
    return (
      <li className={`item item-${record.status}`}>
        <button type="button" className="item-button" onClick={() => setEditing(true)}>
          <StatusBadge status={record.status} />
          <span className="item-name" id={nameId}>
            {record.name}
          </span>
          {record.genre && <GenreTag genre={record.genre} />}
          {record.dishType && <span className="tag">{DISH_TYPE_LABELS[record.dishType]}</span>}
        </button>
        {canToggleStatus(record.date, today) && (
          <button
            type="button"
            className="toggle"
            aria-describedby={nameId}
            disabled={toggling}
            onClick={() => void toggle()}
          >
            {record.status === 'planned' ? '食べたにする' : '予定に戻す'}
          </button>
        )}
      </li>
    )
  }

  return (
    <li className="item">
      <EditForm
        record={record}
        today={today}
        onUpdate={onUpdate}
        onDelete={onDelete}
        onClose={() => setEditing(false)}
      />
    </li>
  )
}

type EditFormProps = Props & { onClose: () => void }

function EditForm({ record, today, onUpdate, onDelete, onClose }: EditFormProps) {
  const [name, setName] = useState(record.name)
  const [genre, setGenre] = useState<Genre | null>(record.genre)
  const [dishType, setDishType] = useState<DishType | null>(record.dishType)
  const [mealType, setMealType] = useState<MealType>(record.mealType)
  const [date, setDate] = useState(record.date)
  const [pending, setPending] = useState(false)

  const canSave = name.trim() !== '' && isValidDate(date) && !pending

  async function save() {
    setPending(true)
    // 日付を変えたら、状態を決まりに合わせる（今日に動かしたときは、そのときの状態のまま）
    const status = statusForDate(date, today, record.status)
    const ok = await onUpdate(record.id, { name, genre, dishType, mealType, date, status })
    setPending(false)
    if (ok) onClose()
  }

  async function remove() {
    if (!window.confirm(`「${record.name}」を削除しますか？`)) return
    setPending(true)
    const ok = await onDelete(record.id)
    setPending(false)
    if (ok) onClose()
  }

  return (
    <form
      className="edit-form"
      aria-label="品の変更"
      onSubmit={(event) => {
        event.preventDefault()
        if (canSave) void save()
      }}
    >
      <input
        className="text-input"
        aria-label="品名"
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <ChoiceButtons legend="ジャンル" options={GENRES} labels={GENRE_LABELS} value={genre} onChange={setGenre} />
      <ChoiceButtons
        legend="料理の分類"
        options={DISH_TYPES}
        labels={DISH_TYPE_LABELS}
        value={dishType}
        onChange={setDishType}
      />
      <label className="select-row">
        区分
        <select value={mealType} onChange={(event) => setMealType(event.target.value as MealType)}>
          {MEAL_TYPES.map((type) => (
            <option key={type} value={type}>
              {MEAL_TYPE_LABELS[type]}
            </option>
          ))}
        </select>
      </label>
      <label className="select-row">
        日付
        <input
          type="date"
          className="date-input"
          value={date}
          required
          onChange={(event) => setDate(event.target.value)}
        />
      </label>
      <div className="actions">
        <button type="submit" className="primary" disabled={!canSave}>
          保存
        </button>
        <button type="button" onClick={onClose} disabled={pending}>
          キャンセル
        </button>
        <button type="button" className="danger" onClick={() => void remove()} disabled={pending}>
          削除
        </button>
      </div>
    </form>
  )
}
