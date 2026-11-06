import { useState } from 'react'
import { createLocalStorageMealRepository } from './meals/localStorageMealRepository'
import type { MealRepository } from './meals/mealRepository'
import { TodayScreen } from './today/TodayScreen'

type Props = {
  /** 保存の窓口。省略するとブラウザ内（localStorage）に保存する */
  repository?: MealRepository
  /** 表示する日（YYYY-MM-DD）。省略すると端末の現地の今日 */
  today?: string
}

function App({ repository, today }: Props) {
  const [mealRepository] = useState(() => repository ?? createLocalStorageMealRepository())
  return <TodayScreen repository={mealRepository} today={today} />
}

export default App
