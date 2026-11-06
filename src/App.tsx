import { useEffect, useState } from 'react'
import { CalendarScreen } from './calendar/CalendarScreen'
import { monthOf } from './calendar/calendarMonth'
import { createLocalStorageMealRepository } from './meals/localStorageMealRepository'
import type { MealRepository } from './meals/mealRepository'
import { calendarHash, dayHash, parseHash, todayHash } from './route'
import { DayScreen } from './today/DayScreen'
import { useToday } from './useToday'

type Props = {
  /** 保存の窓口。省略するとブラウザ内（localStorage）に保存する */
  repository?: MealRepository
  /** 今日として扱う日（YYYY-MM-DD）。省略すると端末の現地の今日 */
  today?: string
}

function App({ repository, today: fixedToday }: Props) {
  const [mealRepository] = useState(() => repository ?? createLocalStorageMealRepository())
  const today = useToday(fixedToday)
  const [hash, setHash] = useState(() => window.location.hash)

  // ブラウザの「戻る」「進む」や、アドレスの書き換えに合わせる
  useEffect(() => {
    function sync() {
      setHash(window.location.hash)
    }
    window.addEventListener('popstate', sync)
    window.addEventListener('hashchange', sync)
    return () => {
      window.removeEventListener('popstate', sync)
      window.removeEventListener('hashchange', sync)
    }
  }, [])

  /** 画面を移る。replace のときは履歴を増やさない */
  function navigate(nextHash: string, replace = false) {
    if (replace) {
      window.history.replaceState(null, '', nextHash)
    } else {
      window.history.pushState(null, '', nextHash)
    }
    setHash(window.location.hash)
  }

  const route = parseHash(hash, today)

  if (route.screen === 'calendar') {
    return (
      <CalendarScreen
        repository={mealRepository}
        today={today}
        month={route.month}
        onChangeMonth={(month) => navigate(calendarHash(month), true)}
        // 今日のマスは、「今日」ボタンと同じ、日付をまたぐと翌日に変わる今日の画面を開く
        onSelectDate={(date) => navigate(date === today ? todayHash() : dayHash(date))}
        onOpenToday={() => navigate(todayHash())}
      />
    )
  }

  const date = route.date ?? today
  return (
    <DayScreen
      // 日を移ったら、入力中の品名や選んだジャンルを持ち越さない（今日の画面は日付をまたいでも持ち越す）
      key={route.date ?? 'today'}
      repository={mealRepository}
      date={date}
      onOpenCalendar={() => navigate(calendarHash(monthOf(date)))}
    />
  )
}

export default App
