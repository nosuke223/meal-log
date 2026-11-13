import { describe, expect, it, vi } from 'vitest'
import { parseFreePlanRecordLimit, recordLimitFor } from './memberPlan'

describe('環境変数 FREE_PLAN_RECORD_LIMIT の解析', () => {
  it('ないときは、警告を出さず 300', () => {
    const warn = vi.fn()
    expect(parseFreePlanRecordLimit(undefined, warn)).toBe(300)
    expect(warn).not.toHaveBeenCalled()
  })

  it.each([
    ['3', 3],
    [' 3 ', 3],
    ['1', 1],
    ['1000', 1000],
  ])('1以上の整数（%j）なら、その数にする', (value, expected) => {
    const warn = vi.fn()
    expect(parseFreePlanRecordLimit(value, warn)).toBe(expected)
    expect(warn).not.toHaveBeenCalled()
  })

  it.each(['', ' ', '0', '-1', '1.5', '1e3', '03', '+3', 'abc', '3品', '99999999999999999999'])(
    '使えない値（%j）は、警告を出して 300 にする',
    (value) => {
      const warn = vi.fn()
      expect(parseFreePlanRecordLimit(value, warn)).toBe(300)
      expect(warn).toHaveBeenCalledTimes(1)
      expect(warn.mock.calls[0][0]).toContain('FREE_PLAN_RECORD_LIMIT')
    },
  )
})

describe('プランの上限', () => {
  it('無料は渡した上限、有料は上限なし（null）', () => {
    expect(recordLimitFor('free', 300)).toBe(300)
    expect(recordLimitFor('paid', 300)).toBeNull()
  })
})
