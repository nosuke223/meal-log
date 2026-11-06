import { useEffect, useState } from 'react'
import { CalendarScreen } from './calendar/CalendarScreen'
import { createLocalStorageMealRepository } from './meals/localStorageMealRepository'
import type { MealRepository } from './meals/mealRepository'
import { DataScreen } from './data/DataScreen'
import { calendarDateHash, calendarHash, dataHash, dayHash, parseHash, todayHash } from './route'
import { DayScreen } from './today/DayScreen'
import { useToday } from './useToday'

type Props = {
  /** 保存の窓口。省略するとブラウザ内（localStorage）に保存する */
  repository?: MealRepository
  /** 今日として扱う日（YYYY-MM-DD）。省略すると端末の現地の今日 */
  today?: string
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function App({ repository, today: fixedToday }: Props) {
  const [mealRepository] = useState(() => repository ?? createLocalStorageMealRepository())
  const today = useToday(fixedToday)
  const [hash, setHash] = useState(() => window.location.hash)
  // 日が過ぎた予定を「食べた」にしたら上げて、画面に読み直させる
  const [revision, setRevision] = useState(0)
  // 日が過ぎた予定を「食べた」にできなかったときのエラー
  const [autoUpdateError, setAutoUpdateError] = useState<string | null>(null)

  // アプリを開いたとき、日付をまたいだとき、タブや画面に戻ってきたときに、過去の日の「予定」を「食べた」にする
  useEffect(() => {
    let cancelled = false
    function completePastPlans() {
      mealRepository
        .markPlannedAsEatenBefore(today)
        .then((updated) => {
          if (cancelled) return
          setAutoUpdateError(null)
          if (updated.length > 0) setRevision((value) => value + 1)
        })
        .catch(async (cause: unknown) => {
          // 読み込めないときは、各画面の読み込みでエラーを表示するので、ここでは表示しない。
          // 読み込めるのに失敗したとき（書き込みだけが容量の上限などで失敗した）は、ここで表示する
          const readable = await mealRepository.listByDate(today).then(
            () => true,
            () => false,
          )
          if (cancelled) return
          setAutoUpdateError(readable ? `日が過ぎた予定を「食べた」にできませんでした: ${messageOf(cause)}` : null)
        })
    }
    function onVisibilityChange() {
      if (document.visibilityState === 'visible') completePastPlans()
    }
    completePastPlans()
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('focus', completePastPlans)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('focus', completePastPlans)
    }
  }, [mealRepository, today])

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

  if (route.screen === 'data') {
    return <DataScreen repository={mealRepository} today={today} onBack={() => navigate(todayHash())} />
  }

  if (route.screen === 'calendar') {
    return (
      <CalendarScreen
        repository={mealRepository}
        today={today}
        month={route.month}
        selected={route.selected}
        revision={revision}
        autoUpdateError={autoUpdateError}
        onChangeMonth={(month) => navigate(calendarHash(month), true)}
        // 日を選ぶのは画面を移らない操作なので、月を移るときと同じく履歴を増やさない
        onSelectDate={(date) => navigate(calendarDateHash(date), true)}
        // 今日は、「今日」ボタンと同じ、日付をまたぐと翌日に変わる今日の画面を開く
        onOpenDate={(date) => navigate(date === today ? todayHash() : dayHash(date))}
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
      today={today}
      revision={revision}
      autoUpdateError={autoUpdateError}
      onOpenCalendar={() => navigate(calendarDateHash(date))}
      onOpenData={() => navigate(dataHash())}
    />
  )
}

export default App
