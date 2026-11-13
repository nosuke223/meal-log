import { useEffect, useState } from 'react'
import { AccountScreen } from './auth/AccountScreen'
import { AUTH_MESSAGES, type AuthClient, type Member } from './auth/authClient'
import { createDefaultAuthClient } from './auth/defaultAuthClient'
import { ForgotScreen } from './auth/ForgotScreen'
import { LoginScreen } from './auth/LoginScreen'
import { ResetScreen } from './auth/ResetScreen'
import { SignupScreen } from './auth/SignupScreen'
import { CalendarScreen } from './calendar/CalendarScreen'
import { createDefaultMealRepository } from './meals/defaultMealRepository'
import { LoginExpiredError, type MealRepository } from './meals/mealRepository'
import { DataScreen } from './data/DataScreen'
import { createDefaultPlanClient } from './plan/defaultPlanClient'
import type { PlanClient } from './plan/planClient'
import {
  accountHash,
  calendarDateHash,
  calendarHash,
  dataHash,
  dayHash,
  forgotHash,
  loginHash,
  parseHash,
  resetHash,
  signupHash,
  todayHash,
  type Route,
} from './route'
import { DayScreen } from './today/DayScreen'
import { useToday } from './useToday'

type Props = {
  /** 保存の窓口。省略するとサーバーの API に保存する */
  repository?: MealRepository
  /** ログインの窓口。省略するとサーバーのログインの API を使う */
  authClient?: AuthClient
  /** プランの窓口。省略するとサーバーの API（GET /api/plan）を使う */
  planClient?: PlanClient
  /** 今日として扱う日（YYYY-MM-DD）。省略すると端末の現地の今日 */
  today?: string
}

/**
 * ログインの状態
 *   unknown   まだ確かめていない（アカウントの画面のほかを開くときに確かめる）
 *   signedIn  ログイン中
 *   signedOut ログインしていない。expired は、使っている途中でログインの期限が切れたか（ログインの画面に知らせを出す）
 *   error     確かめられなかった
 */
type Session =
  | { kind: 'unknown' }
  | { kind: 'signedIn'; member: Member }
  | { kind: 'signedOut'; expired: boolean }
  | { kind: 'error'; message: string }

/** ログインしていないと開けない画面（記録、カレンダー、データ） */
function needsLogin(route: Route): boolean {
  return route.screen === 'day' || route.screen === 'calendar' || route.screen === 'data'
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** 保存の窓口を包み、ログインの期限が切れた（LoginExpiredError）ときに onExpired を呼ぶ（エラーはそのまま投げる） */
function watchLoginExpiry(repository: MealRepository, onExpired: () => void): MealRepository {
  function watch<A extends unknown[], R>(operation: (...args: A) => Promise<R>) {
    return async (...args: A): Promise<R> => {
      try {
        return await operation(...args)
      } catch (error) {
        if (error instanceof LoginExpiredError) onExpired()
        throw error
      }
    }
  }
  return {
    listByDate: watch((date) => repository.listByDate(date)),
    listByDateRange: watch((from, to) => repository.listByDateRange(from, to)),
    get: watch((id) => repository.get(id)),
    create: watch((input) => repository.create(input)),
    update: watch((id, changes) => repository.update(id, changes)),
    delete: watch((id) => repository.delete(id)),
    markPlannedAsEatenBefore: watch((date) => repository.markPlannedAsEatenBefore(date)),
    listAll: watch(() => repository.listAll()),
    importRecords: watch((records) => repository.importRecords(records)),
  }
}

function App({ repository, authClient: givenAuthClient, planClient: givenPlanClient, today: fixedToday }: Props) {
  const [session, setSession] = useState<Session>({ kind: 'unknown' })
  // 日が過ぎた予定を「食べた」にできなかったときのエラー
  const [autoUpdateError, setAutoUpdateError] = useState<string | null>(null)
  // ログインの期限が切れたら、ログインしていない状態にする（記録の画面なら、下でログインの画面に移る）
  const [mealRepository] = useState(() =>
    watchLoginExpiry(repository ?? createDefaultMealRepository(), () => {
      setSession((current) => (current.kind === 'signedIn' ? { kind: 'signedOut', expired: true } : current))
      setAutoUpdateError(null)
    }),
  )
  const [authClient] = useState(() => givenAuthClient ?? createDefaultAuthClient())
  const [planClient] = useState(() => givenPlanClient ?? createDefaultPlanClient())
  const today = useToday(fixedToday)
  const [hash, setHash] = useState(() => window.location.hash)
  // 再設定のメールのリンクのトークン（メモリーにだけ持つ。読み込み直すと消える）
  const [resetToken, setResetToken] = useState<string | null>(null)
  // 日が過ぎた予定を「食べた」にしたときと、タブや画面に戻ってきたときに上げて、画面に読み直させる
  const [revision, setRevision] = useState(0)

  // ログイン中の会員（会員が変わったら、画面の状態を初めからにする）
  const memberKey = session.kind === 'signedIn' ? session.member.email : null

  // ログインした後（アプリを開いたとき、日付をまたいだとき、タブや画面に戻ってきたとき）に、過去の日の「予定」を「食べた」にする。
  // タブや画面に戻ってきたときは、別の端末で記録が変わっているかもしれないので、更新が0件でも画面に読み直させる
  useEffect(() => {
    if (memberKey === null) return
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
    // タブや画面に戻ってきたときは、まずログイン中の会員を確かめ直す（別のタブでログアウトしたり、別の会員でログインしたりしているかもしれない）。
    // 会員が変わっていたら、前の会員の画面の状態（取り込む前の確認なども）を残さないよう、その会員の画面にする（ログアウトしていたら、ログインの画面に移る）。
    // 確かめられなかったときは、今までどおり読み直す（ログインが切れていれば、読み直しの 401 でログインの画面に移る）
    function onReturn() {
      authClient.getSession().then(
        (member) => {
          if (cancelled) return
          if (member?.email === memberKey) {
            completePastPlans(true)
            return
          }
          setSession(member === null ? { kind: 'signedOut', expired: true } : { kind: 'signedIn', member })
          setAutoUpdateError(null)
        },
        () => {
          if (!cancelled) completePastPlans(true)
        },
      )
    }
    function onVisibilityChange() {
      if (document.visibilityState === 'visible') onReturn()
    }
    function onFocus() {
      onReturn()
    }
    completePastPlans(false)
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('focus', onFocus)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('focus', onFocus)
    }
  }, [mealRepository, authClient, today, memberKey])

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

  // 再設定のメールのリンク（#/reset/<トークン>）を開いたら、トークンを画面の中（メモリー）に持ち、
  // アドレスを #/reset に置き換える（履歴は増やさない。トークンをアドレスに残さない）
  if (route.screen === 'reset' && route.token !== null) {
    setResetToken(route.token)
    setHash(resetHash())
  }

  // 上で今日の記録の画面や #/reset にしたときに、アドレスも置き換える（履歴は増やさない）
  // 毎回の描画の後に確かめる（同じタブで別の再設定リンクを開くと、状態の hash が前回と同じ #/reset のままになり、
  // hash を依存にすると実行されず、アドレスにトークンが残るため）
  useEffect(() => {
    if (hash !== window.location.hash) {
      window.history.replaceState(null, '', hash)
    }
  })

  // 画面を開いたときに、まだ確かめていなければ、ログインしているかを確かめる。
  // ログインなどの画面でも確かめる（ログイン中なら「記録の画面へ」を出すため）。
  // アカウントの画面は、画面の中で確かめる
  const checkSession = route.screen !== 'account' && session.kind === 'unknown'
  useEffect(() => {
    if (!checkSession) return
    let cancelled = false
    authClient
      .getSession()
      .then((member) => {
        if (!cancelled) setSession(member === null ? { kind: 'signedOut', expired: false } : { kind: 'signedIn', member })
      })
      .catch((cause: unknown) => {
        if (!cancelled) setSession({ kind: 'error', message: `${AUTH_MESSAGES.sessionCheckFailed}: ${messageOf(cause)}` })
      })
    return () => {
      cancelled = true
    }
  }, [checkSession, authClient])

  /** ログインしたとき（前の会員の画面の状態は持ち越さない）。今日の記録の画面に移る */
  function signedIn(member: Member) {
    setSession({ kind: 'signedIn', member })
    setAutoUpdateError(null)
    navigate(todayHash())
  }

  // ログインしていないときに、記録、カレンダー、データの画面を開いたら、ログインの画面に移る（履歴は増やさない）。
  // 使っている途中でログインの期限が切れたときは、その旨を出す（出すのは1回だけ）
  if (needsLogin(route) && session.kind === 'signedOut') {
    setHash(loginHash(session.expired ? 'session-expired' : undefined))
    if (session.expired) setSession({ kind: 'signedOut', expired: false })
  }

  if (needsLogin(route) && session.kind !== 'signedIn') {
    return (
      <main className="screen">
        {session.kind === 'error' ? (
          <section className="section">
            <p role="alert" className="error">
              {session.message}
            </p>
            <button type="button" onClick={() => setSession({ kind: 'unknown' })}>
              もう一度試す
            </button>
          </section>
        ) : (
          <p role="status" className="description">
            ログインの状態を確かめています…
          </p>
        )}
      </main>
    )
  }

  if (route.screen === 'data') {
    return (
      <DataScreen key={memberKey} repository={mealRepository} today={today} onBack={() => navigate(todayHash())} />
    )
  }

  // ログインの画面は、ログインしたら今日の記録の画面に移る。
  // 「記録の画面へ」は、ログイン中のときだけ出す（ログインしていない、またはまだ確かめていないときは、
  // 記録の画面を開いてもログインの画面に移るだけなので出さない）
  const backToToday = () => navigate(todayHash())
  const authScreenProps = {
    authClient,
    onBack: session.kind === 'signedIn' ? backToToday : undefined,
  }
  if (route.screen === 'login') {
    return (
      <LoginScreen
        {...authScreenProps}
        // 確認のメールのリンクの結果が変わったら、入力と表示を初めからにする
        key={route.notice ?? ''}
        notice={route.notice}
        onSignedIn={signedIn}
        onOpenSignup={() => navigate(signupHash())}
        onOpenForgot={() => navigate(forgotHash())}
      />
    )
  }
  if (route.screen === 'signup') {
    return <SignupScreen {...authScreenProps} onOpenLogin={() => navigate(loginHash())} />
  }
  if (route.screen === 'forgot') {
    return <ForgotScreen {...authScreenProps} onOpenLogin={() => navigate(loginHash())} />
  }
  if (route.screen === 'reset') {
    return (
      <ResetScreen
        {...authScreenProps}
        // リンクのトークンが変わったら、エラーや入力の状態を初めからにする
        key={route.token ?? resetToken ?? ''}
        token={route.token ?? resetToken}
        // 変更できたら、ログインの画面に移る（履歴には戻らない。ログインした状態にはならない）
        onReset={() => {
          setResetToken(null)
          navigate(loginHash('password-reset'), true)
        }}
        onOpenForgot={() => navigate(forgotHash())}
      />
    )
  }
  if (route.screen === 'account') {
    return (
      <AccountScreen
        authClient={authClient}
        planClient={planClient}
        // アカウントの画面は、画面の中で確かめたログインの状態で、「記録の画面へ」を出すかを決める
        onBack={backToToday}
        onSignedIn={signedIn}
        // ログアウトしたら、その会員の記録を画面に残さない（記録の画面を開くと、ログインの画面に移る）
        onSignedOut={() => {
          setSession({ kind: 'signedOut', expired: false })
          setAutoUpdateError(null)
        }}
        // 退会したら、ログアウトしたときと同じく前の会員の記録を残さず、ログインの画面にお知らせを出す（履歴は増やさない）
        onDeleted={() => {
          setSession({ kind: 'signedOut', expired: false })
          setAutoUpdateError(null)
          navigate(loginHash('account-deleted'), true)
        }}
        onOpenSignup={() => navigate(signupHash())}
        onOpenForgot={() => navigate(forgotHash())}
      />
    )
  }

  if (route.screen === 'calendar') {
    return (
      <CalendarScreen
        key={memberKey}
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
      // 日を移ったら、入力中の品名や選んだジャンルを持ち越さない（今日の画面は日付をまたいでも持ち越す）。
      // 会員が変わったときも持ち越さない
      key={`${memberKey}:${route.date ?? 'today'}`}
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
