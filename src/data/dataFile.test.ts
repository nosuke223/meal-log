import { describe, expect, test } from 'vitest'
import type { MealRecord } from '../meals/mealRecord'
import { buildDataFile, DataFileError, dataFileName, parseDataFile, planImport } from './dataFile'

const TODAY = '2026-11-06'

function record(overrides: Partial<MealRecord> = {}): MealRecord {
  return {
    id: 'a',
    date: '2026-11-05',
    mealType: 'dinner',
    name: 'カレー',
    genre: 'other',
    dishType: 'main',
    status: 'eaten',
    createdAt: '2026-11-05T10:00:00.000Z',
    updatedAt: '2026-11-05T10:00:00.000Z',
    ...overrides,
  }
}

function fileOf(records: unknown[]): string {
  return JSON.stringify({ version: 1, exportedAt: '2026-11-06T00:00:00.000Z', records })
}

function parseError(text: string): string {
  try {
    parseDataFile(text)
  } catch (error) {
    expect(error).toBeInstanceOf(DataFileError)
    return (error as Error).message
  }
  throw new Error('エラーになりませんでした')
}

describe('書き出し', () => {
  test('バージョン、書き出した日時、記録（ID と日時を含む）の形にする', () => {
    const records = [record(), record({ id: 'b', status: 'planned', date: '2026-11-08' })]
    const data = JSON.parse(buildDataFile(records, new Date('2026-11-06T03:04:05.678Z')))
    expect(data).toEqual({ version: 1, exportedAt: '2026-11-06T03:04:05.678Z', records })
  })

  test('0件でも書き出せる', () => {
    expect(JSON.parse(buildDataFile([], new Date('2026-11-06T00:00:00.000Z')))).toEqual({
      version: 1,
      exportedAt: '2026-11-06T00:00:00.000Z',
      records: [],
    })
  })

  test('ファイル名は端末の現地の日付にする', () => {
    expect(dataFileName(new Date(2026, 0, 2, 23, 59))).toBe('meal-log-2026-01-02.json')
  })

  test('書き出したファイルを読み込むと、同じ記録に戻る', () => {
    const records = [record(), record({ id: 'b', genre: null, dishType: null })]
    expect(parseDataFile(buildDataFile(records, new Date()))).toEqual(records)
  })
})

describe('読み込むファイルの検査', () => {
  test('JSON として読めないとき', () => {
    expect(parseError('{broken')).toContain('JSON として読めません')
  })

  test('形が違うとき', () => {
    expect(parseError('[]')).toContain('ファイルの形が違います')
    expect(parseError('null')).toContain('ファイルの形が違います')
  })

  test('バージョンが対応していない、またはないとき', () => {
    expect(parseError(JSON.stringify({ version: 2, records: [] }))).toContain('バージョンに対応していません（バージョン: 2）')
    expect(parseError(JSON.stringify({ records: [] }))).toContain('バージョンに対応していません（バージョンがありません）')
  })

  test('records がないとき', () => {
    expect(parseError(JSON.stringify({ version: 1 }))).toContain('記録の一覧（records）がありません')
    expect(parseError(JSON.stringify({ version: 1, records: {} }))).toContain('記録の一覧（records）がありません')
  })

  test('1件でも不正なら、何件目が、なぜ不正かを示す', () => {
    const cases: [unknown, string][] = [
      ['x', '2件目の記録が不正です: 記録の形が違います'],
      [{ ...record({ id: 'b' }), id: '' }, '2件目の記録が不正です: ID がありません'],
      [record({ id: 'b', name: '  ' }), '2件目の記録が不正です: 品名を入力してください'],
      [record({ id: 'b', date: '2026-02-30' }), '2件目の記録が不正です: 日付は'],
      [{ ...record({ id: 'b' }), mealType: 'brunch' }, '2件目の記録が不正です: 区分が不正です: brunch'],
      [{ ...record({ id: 'b' }), genre: 'korean' }, '2件目の記録が不正です: ジャンルが不正です: korean'],
      [{ ...record({ id: 'b' }), dishType: undefined }, '2件目の記録が不正です: 料理の分類が不正です'],
      [{ ...record({ id: 'b' }), status: 'done' }, '2件目の記録が不正です: 状態が不正です: done'],
      [record({ id: 'b', createdAt: 'yesterday' }), '2件目の記録が不正です: createdAt は ISO 8601'],
      [record({ id: 'b', updatedAt: '2026-11-05' }), '2件目の記録が不正です: updatedAt は ISO 8601'],
    ]
    for (const [invalid, message] of cases) {
      expect(parseError(fileOf([record(), invalid, record({ id: 'c' })]))).toContain(message)
    }
  })

  test('同じ ID が2つあるとき', () => {
    expect(parseError(fileOf([record({ id: 'x' }), record({ id: 'y' }), record({ id: 'x' })]))).toBe(
      '3件目の記録の ID が、1件目と同じです: x',
    )
  })

  test('品名の前後の空白を取り除き、決まった項目だけを取り出す', () => {
    const [parsed] = parseDataFile(fileOf([{ ...record({ name: ' カレー ' }), extra: 1 }]))
    expect(parsed).toEqual(record())
  })

  test('0件のファイルも読み込める', () => {
    expect(parseDataFile(fileOf([]))).toEqual([])
  })
})

describe('混ぜる規則', () => {
  test('ない ID は追加、更新日時が新しいものは更新、同じか古いものは変更なしにする', () => {
    const existing = [
      record({ id: 'newer', name: '古い', updatedAt: '2026-11-05T10:00:00.000Z' }),
      record({ id: 'same', name: '今の', updatedAt: '2026-11-05T10:00:00.000Z' }),
      record({ id: 'older', name: '今の', updatedAt: '2026-11-05T12:00:00.000Z' }),
      record({ id: 'only-existing' }),
    ]
    const incoming = [
      record({ id: 'new' }),
      record({ id: 'newer', name: '新しい', updatedAt: '2026-11-05T10:00:00.001Z' }),
      record({ id: 'same', name: 'ファイルの', updatedAt: '2026-11-05T10:00:00.000Z' }),
      record({ id: 'older', name: 'ファイルの', updatedAt: '2026-11-05T11:00:00.000Z' }),
    ]
    const plan = planImport(existing, incoming, TODAY)
    expect(plan.added).toEqual([record({ id: 'new' })])
    expect(plan.updated).toEqual([record({ id: 'newer', name: '新しい', updatedAt: '2026-11-05T10:00:00.001Z' })])
    expect(plan.unchangedCount).toBe(2)
  })

  test('未来の日の「食べた」は「予定」に、過去の日の「予定」は「食べた」に直し、今日はそのまま。ID と日時は変えない', () => {
    const incoming = [
      record({ id: 'future', date: '2026-11-07', status: 'eaten' }),
      record({ id: 'past', date: '2026-11-05', status: 'planned' }),
      record({ id: 'today-planned', date: TODAY, status: 'planned' }),
      record({ id: 'today-eaten', date: TODAY, status: 'eaten' }),
    ]
    const plan = planImport([], incoming, TODAY)
    expect(plan.added).toEqual([
      record({ id: 'future', date: '2026-11-07', status: 'planned' }),
      record({ id: 'past', date: '2026-11-05', status: 'eaten' }),
      record({ id: 'today-planned', date: TODAY, status: 'planned' }),
      record({ id: 'today-eaten', date: TODAY, status: 'eaten' }),
    ])
  })

  test('更新する記録も、状態を日付に合わせて直す', () => {
    const plan = planImport(
      [record({ id: 'a', date: '2026-11-10', status: 'planned' })],
      [record({ id: 'a', date: '2026-11-03', status: 'planned', updatedAt: '2026-11-06T00:00:00.000Z' })],
      TODAY,
    )
    expect(plan.updated).toEqual([
      record({ id: 'a', date: '2026-11-03', status: 'eaten', updatedAt: '2026-11-06T00:00:00.000Z' }),
    ])
  })
})
