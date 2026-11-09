import { DISH_TYPE_LABELS, formatDate, MEAL_TYPE_LABELS } from '../meals/labels'
import type { MealRecord } from '../meals/mealRecord'
import { GenreTag } from '../today/GenreTag'
import { StatusBadge } from '../today/StatusBadge'
import { mealsOfDay } from './calendarMonth'

type Props = {
  /** 選んだ日（YYYY-MM-DD）。null は何も選んでいない */
  date: string | null
  /** 表示している月の記録。null は読み込み中か、読み込めなかった（品も「記録はありません」も出さない） */
  records: readonly MealRecord[] | null
  /** その日の記録の画面を開く */
  onOpen: (date: string) => void
}

const REGION_NAME = '選んだ日の品'

/** カレンダーで選んだ日の品の一覧。見るだけで、品の操作は記録の画面で行う */
export function DayPreview({ date, records, onOpen }: Props) {
  if (date === null) {
    return (
      <section className="day-preview" aria-label={REGION_NAME}>
        <p className="day-preview-note">日付を選ぶと、その日の品が表示されます</p>
      </section>
    )
  }

  const groups = records === null ? [] : mealsOfDay(records, date)

  return (
    <section className="day-preview" aria-label={REGION_NAME}>
      <div className="day-preview-head">
        <h2>
          <time dateTime={date}>{formatDate(date)}</time>
        </h2>
        <button type="button" onClick={() => onOpen(date)}>
          この日の記録を開く
        </button>
      </div>
      {records !== null && groups.length === 0 && <p className="day-preview-note">記録はありません</p>}
      {groups.map(({ mealType, records: items }) => (
        <section key={mealType} className="preview-group" aria-label={MEAL_TYPE_LABELS[mealType]}>
          <h3>{MEAL_TYPE_LABELS[mealType]}</h3>
          <ul className="preview-items">
            {items.map((record) => (
              <li key={record.id} className={`preview-item item-${record.status}`}>
                <StatusBadge status={record.status} />
                <span className="item-name">{record.name}</span>
                {record.genre && <GenreTag genre={record.genre} />}
                {record.dishType && <span className="tag">{DISH_TYPE_LABELS[record.dishType]}</span>}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </section>
  )
}
