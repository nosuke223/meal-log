import { useEffect, useState } from 'react'
import { AccountScreen } from './auth/AccountScreen'
import type { AuthClient } from './auth/authClient'
import { createDefaultAuthClient } from './auth/defaultAuthClient'
import { LoginScreen } from './auth/LoginScreen'
import { SignupScreen } from './auth/SignupScreen'
import { CalendarScreen } from './calendar/CalendarScreen'
import { createDefaultMealRepository } from './meals/defaultMealRepository'
import type { MealRepository } from './meals/mealRepository'
import { DataScreen } from './data/DataScreen'
import {
  accountHash,
  calendarDateHash,
  calendarHash,
  dataHash,
  dayHash,
  loginHash,
  parseHash,
  signupHash,
  todayHash,
} from './route'
import { DayScreen } from './today/DayScreen'
import { useToday } from './useToday'

type Props = {
  /** 保存の窓口。省略するとサーバーの API に保存する */
  repository?: MealRepository
  /** ログインの窓口。省略するとサーバーのログインの API を使う */
  authClient?: AuthClient
  /** 今日として扱う日（YYYY-MM-DD）。省略すると端末の現地の今日 */
  today?: string
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function App({ repository, authClient: givenAuthClient, today: fixedToday }: Props) {
  const [mealRepository] = useState(() => repository ?? createDefaultMealRepository())
  const [authClient] = useState(() => givenAuthClient ?? createDefaultAuthClient())
  const today = useToday(fixedToday)
  const [hash, setHash] = useState(() => window.location.hash)
  // 日が過ぎた予定を「食べた」にしたときと、タブや画面に戻ってきたときに上げて、画面に読み直させる
  const [revision, setRevision] = useState(0)
  // 日が過ぎた予定を「食べた」にできなかったときのエラー
  const [autoUpdateError, setAutoUpdateError] = useState<string | null>(null)

  // アプリを開いたとき、日付をまたいだとき、タブや画面に戻ってきたときに、過去の日の「予定」を「食べた」にする。
  // タブや画面に戻ってきたときは、別の端末で記録が変わっているかもしれないので、更新が0件でも画面に読み直させる
  useEffect(() => {
    let cancelled = false
    function completePastPlans(reload: boolean) {
      mealRepository
        .markPlannedAsEatenBefore(today)
        .then((updated) => {
          if (cancelled) return
          setAutoUpdateError(null)
          if (reload || updated.length > 0) setRevision((value) => value + 1)
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
          if (reload) setRevision((value) => value + 1)
        })
    }
    function onVisibilityChange() {
      if (document.visibilityState === 'visible') completePastPlans(true)
    }
    function onFocus() {
      completePastPlans(true)
    }
    completePastPlans(false)
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('focus', onFocus)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('focus', onFocus)
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
  // 今日の画面は1種類にする。表示している日が今日のとき（開いたとき、または開いたまま日付をまたいで
  // 今日になったとき）は、今日の記録の画面にし、以後は日付をまたぐと翌日の画面に変わるようにする
  if (route.screen === 'day' && route.date === today) {
    setHash(todayHash())
  }

  // 上で今日の記録の画面にしたときに、アドレスも置き換える（履歴は増やさない）
  useEffect(() => {
    if (hash !== window.location.hash) {
      window.history.replaceState(null, '', hash)
    }
  }, [hash])

  if (route.screen === 'data') {
    return <DataScreen repository={mealRepository} today={today} onBack={() => navigate(todayHash())} />
  }

  // ログインの画面は、ログインしたら今日の記録の画面に移る
  const authScreenProps = {
    authClient,
    onBack: () => navigate(todayHash()),
  }
  if (route.screen === 'login') {
    return (
      <LoginScreen
        {...authScreenProps}
        // 確認のメールのリンクの結果が変わったら、入力と表示を初めからにする
        key={route.verification ?? ''}
        verification={route.verification}
        onSignedIn={() => navigate(todayHash())}
        onOpenSignup={() => navigate(signupHash())}
      />
    )
  }
  if (route.screen === 'signup') {
    return <SignupScreen {...authScreenProps} onOpenLogin={() => navigate(loginHash())} />
  }
  if (route.screen === 'account') {
    return (
      <AccountScreen {...authScreenProps} onSignedIn={() => navigate(todayHash())} onOpenSignup={() => navigate(signupHash())} />
    )
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
      onOpenAccount={() => navigate(accountHash())}
    />
  )
}

export default App
