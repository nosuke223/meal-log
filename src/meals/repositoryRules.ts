// 保存の窓口（ブラウザ内、サーバー）に共通の、値の整え方と検査の規則

import {
  isValidDate,
  MealValidationError,
  validateMealFields,
  validateMealRecord,
  type MealChanges,
  type MealRecord,
} from './mealRecord'

export type MealFields = Omit<MealRecord, 'id' | 'createdAt' | 'updatedAt'>

const FIELD_KEYS = ['date', 'mealType', 'name', 'genre', 'dishType', 'status'] as const

export function pickFields(record: MealRecord): MealFields {
  return {
    date: record.date,
    mealType: record.mealType,
    name: record.name,
    genre: record.genre,
    dishType: record.dishType,
    status: record.status,
  }
}

/** 更新の値のうち、記録の中身の項目で、undefined でないものだけを取り出す */
export function definedChanges(changes: MealChanges): Partial<MealFields> {
  const result: Record<string, unknown> = {}
  for (const key of FIELD_KEYS) {
    if (changes[key] !== undefined) result[key] = changes[key]
  }
  return result as Partial<MealFields>
}

/** 中身を検査し、品名の前後の空白を取り除く。不正なら MealValidationError */
export function normalizeFields(fields: MealFields): MealFields {
  validateMealFields(fields)
  return { ...fields, name: fields.name.trim() }
}

export function assertDate(date: string): void {
  if (!isValidDate(date)) {
    throw new MealValidationError(`日付は YYYY-MM-DD の書式の実在する日にしてください: ${String(date)}`)
  }
}

export function assertDateRange(from: string, to: string): void {
  assertDate(from)
  assertDate(to)
  if (from > to) {
    throw new MealValidationError(`期間の始まりが終わりより後です: ${from} 〜 ${to}`)
  }
}

/** 日時が前の値と同じかそれより前にならないようにする（同じミリ秒に続けて作成・更新したとき用） */
export function nextTimestamp(current: Date, previous: string): string {
  const previousTime = Date.parse(previous)
  const time = Math.max(current.getTime(), previousTime + 1)
  return new Date(time).toISOString()
}

/**
 * 作成日時を決める。「今の時刻」と「保存済みの記録の最も遅い作成日時 + 1ミリ秒」の遅い方
 * （同じミリ秒に続けて作っても、作った順に並ぶ）。latestCreatedAt は、記録がなければ null
 */
export function createdAtFor(current: Date, latestCreatedAt: string | null): string {
  return latestCreatedAt === null ? current.toISOString() : nextTimestamp(current, latestCreatedAt)
}

/** 一括の取り込みの記録をすべて検査し、整えた記録を返す。1件でも不正、または ID が重なっていたら MealValidationError */
export function validateImportRecords(input: unknown[]): MealRecord[] {
  const incoming = input.map((record, index) => {
    try {
      return validateMealRecord(record)
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      throw new MealValidationError(`${index + 1}件目の記録が不正です: ${reason}`)
    }
  })
  const ids = new Set<string>()
  for (const record of incoming) {
    if (ids.has(record.id)) throw new MealValidationError(`ID が重なっています: ${record.id}`)
    ids.add(record.id)
  }
  return incoming
}
