import { useEffect, useState } from 'react'
import { toLocalDateString } from './meals/mealRecord'

const DATE_CHECK_INTERVAL_MS = 30_000

/**
 * 端末の現地の今日（YYYY-MM-DD）を返す。日付をまたいだり画面に戻ったりしたときに取り直す。
 * fixed を渡すと、その日を今日として扱う（テスト用）
 */
export function useToday(fixed?: string): string {
  const [current, setCurrent] = useState(() => toLocalDateString(new Date()))

  useEffect(() => {
    if (fixed !== undefined) return
    function refresh() {
      setCurrent(toLocalDateString(new Date()))
    }
    refresh()
    const timer = window.setInterval(refresh, DATE_CHECK_INTERVAL_MS)
    document.addEventListener('visibilitychange', refresh)
    window.addEventListener('focus', refresh)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', refresh)
      window.removeEventListener('focus', refresh)
    }
  }, [fixed])

  return fixed ?? current
}
