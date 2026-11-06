import { useState } from 'react'
import { DISH_TYPE_LABELS, GENRE_LABELS, MEAL_TYPE_LABELS } from '../meals/labels'
import {
  DISH_TYPES,
  GENRES,
  MEAL_TYPES,
  type DishType,
  type Genre,
  type MealChanges,
  type MealRecord,
  type MealType,
} from '../meals/mealRecord'
import { ChoiceButtons } from './ChoiceButtons'

type Props = {
  record: MealRecord
  onUpdate: (id: string, changes: MealChanges) => Promise<boolean>
  onDelete: (id: string) => Promise<boolean>
}

export function MealItem({ record, onUpdate, onDelete }: Props) {
  const [editing, setEditing] = useState(false)

  if (!editing) {
    return (
      <li className="item">
        <button type="button" className="item-button" onClick={() => setEditing(true)}>
          <span className="item-name">{record.name}</span>
          {record.genre && <span className="tag">{GENRE_LABELS[record.genre]}</span>}
          {record.dishType && <span className="tag">{DISH_TYPE_LABELS[record.dishType]}</span>}
        </button>
      </li>
    )
  }

  return (
    <li className="item">
      <EditForm
        record={record}
        onUpdate={onUpdate}
        onDelete={onDelete}
        onClose={() => setEditing(false)}
      />
    </li>
  )
}

type EditFormProps = Props & { onClose: () => void }

function EditForm({ record, onUpdate, onDelete, onClose }: EditFormProps) {
  const [name, setName] = useState(record.name)
  const [genre, setGenre] = useState<Genre | null>(record.genre)
  const [dishType, setDishType] = useState<DishType | null>(record.dishType)
  const [mealType, setMealType] = useState<MealType>(record.mealType)
  const [pending, setPending] = useState(false)

  async function save() {
    setPending(true)
    const ok = await onUpdate(record.id, { name, genre, dishType, mealType })
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
        if (name.trim() !== '' && !pending) void save()
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
      <div className="actions">
        <button type="submit" className="primary" disabled={name.trim() === '' || pending}>
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
