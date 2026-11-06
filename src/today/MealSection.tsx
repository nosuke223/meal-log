import { useId, useState } from 'react'
import { DISH_TYPE_LABELS, GENRE_LABELS, MEAL_TYPE_LABELS } from '../meals/labels'
import {
  DISH_TYPES,
  GENRES,
  type DishType,
  type Genre,
  type MealChanges,
  type MealRecord,
  type MealType,
} from '../meals/mealRecord'
import { ChoiceButtons } from './ChoiceButtons'
import { MealItem } from './MealItem'

type Props = {
  mealType: MealType
  /** この区分の記録（作成した順） */
  records: MealRecord[]
  onAdd: (mealType: MealType, name: string, genre: Genre | null, dishType: DishType | null) => Promise<boolean>
  onUpdate: (id: string, changes: MealChanges) => Promise<boolean>
  onDelete: (id: string) => Promise<boolean>
}

export function MealSection({ mealType, records, onAdd, onUpdate, onDelete }: Props) {
  const headingId = useId()
  const [name, setName] = useState('')
  // undefined は「選んでいない」。その間は、直前の品のジャンルが選ばれた状態にする
  const [pickedGenre, setPickedGenre] = useState<Genre | null | undefined>(undefined)
  const [dishType, setDishType] = useState<DishType | null>(null)
  const [pending, setPending] = useState(false)

  const genre = pickedGenre === undefined ? (records.at(-1)?.genre ?? null) : pickedGenre
  const canAdd = name.trim() !== '' && !pending

  async function add() {
    setPending(true)
    const ok = await onAdd(mealType, name, genre, dishType)
    setPending(false)
    if (ok) {
      setName('')
      setPickedGenre(undefined)
      setDishType(null)
    }
  }

  return (
    <section aria-labelledby={headingId} className="section">
      <h2 id={headingId}>{MEAL_TYPE_LABELS[mealType]}</h2>
      <ul className="items">
        {records.map((record) => (
          <MealItem key={record.id} record={record} onUpdate={onUpdate} onDelete={onDelete} />
        ))}
      </ul>
      <form
        className="add-form"
        onSubmit={(event) => {
          event.preventDefault()
          if (canAdd) void add()
        }}
      >
        <div className="add-row">
          <input
            className="text-input"
            aria-label="新しい品名"
            placeholder="品名"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <button type="submit" className="primary" disabled={!canAdd}>
            追加
          </button>
        </div>
        <ChoiceButtons
          legend="ジャンル"
          options={GENRES}
          labels={GENRE_LABELS}
          value={genre}
          onChange={setPickedGenre}
        />
        <ChoiceButtons
          legend="料理の分類"
          options={DISH_TYPES}
          labels={DISH_TYPE_LABELS}
          value={dishType}
          onChange={setDishType}
        />
      </form>
    </section>
  )
}
