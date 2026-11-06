// 食事の記録（1件が1品）の形と、値の検査

export const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack'] as const
export type MealType = (typeof MEAL_TYPES)[number]

export const GENRES = ['japanese', 'western', 'chinese', 'other'] as const
export type Genre = (typeof GENRES)[number]

export const DISH_TYPES = ['staple', 'main', 'side', 'soup', 'other'] as const
export type DishType = (typeof DISH_TYPES)[number]

export const MEAL_STATUSES = ['planned', 'eaten'] as const
export type MealStatus = (typeof MEAL_STATUSES)[number]

export type MealRecord = {
  /** 他の記録と重ならない ID（UUID） */
  id: string
  /** 食べた日／食べる予定の日（YYYY-MM-DD、端末の現地の日付） */
  date: string
  mealType: MealType
  /** 品名（空白だけは不可） */
  name: string
  /** null は未設定 */
  genre: Genre | null
  /** null は未設定 */
  dishType: DishType | null
  status: MealStatus
  /** 作成日時（ISO 8601、UTC） */
  createdAt: string
  /** 更新日時（ISO 8601、UTC） */
  updatedAt: string
}

/** 作成するときに渡す値。genre と dishType は省略すると未設定（null） */
export type MealInput = {
  date: string
  mealType: MealType
  name: string
  genre?: Genre | null
  dishType?: DishType | null
  status: MealStatus
}

/** 更新するときに渡す値。渡した項目だけを変える */
export type MealChanges = Partial<MealInput>

export class MealValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MealValidationError'
  }
}

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

/** YYYY-MM-DD の書式で、実在する日付なら true */
export function isValidDate(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const match = DATE_PATTERN.exec(value)
  if (!match) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  )
}

/** 日時を、端末の現地の日付（YYYY-MM-DD）にする */
export function toLocalDateString(value: Date): string {
  const year = String(value.getFullYear()).padStart(4, '0')
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function isOneOf<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (values as readonly string[]).includes(value)
}

/** 記録の中身（ID と日時以外）を検査する。不正なら MealValidationError */
export function validateMealFields(fields: {
  date: unknown
  mealType: unknown
  name: unknown
  genre: unknown
  dishType: unknown
  status: unknown
}): void {
  if (!isValidDate(fields.date)) {
    throw new MealValidationError(`日付は YYYY-MM-DD の書式の実在する日にしてください: ${String(fields.date)}`)
  }
  if (!isOneOf(MEAL_TYPES, fields.mealType)) {
    throw new MealValidationError(`区分が不正です: ${String(fields.mealType)}`)
  }
  if (typeof fields.name !== 'string' || fields.name.trim() === '') {
    throw new MealValidationError('品名を入力してください')
  }
  if (fields.genre !== null && !isOneOf(GENRES, fields.genre)) {
    throw new MealValidationError(`ジャンルが不正です: ${String(fields.genre)}`)
  }
  if (fields.dishType !== null && !isOneOf(DISH_TYPES, fields.dishType)) {
    throw new MealValidationError(`料理の分類が不正です: ${String(fields.dishType)}`)
  }
  if (!isOneOf(MEAL_STATUSES, fields.status)) {
    throw new MealValidationError(`状態が不正です: ${String(fields.status)}`)
  }
}

/** 日付 → 区分（朝・昼・夜・間食）→ 作成日時の順に並べるための比較 */
export function compareMealRecords(a: MealRecord, b: MealRecord): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1
  const typeDiff = MEAL_TYPES.indexOf(a.mealType) - MEAL_TYPES.indexOf(b.mealType)
  if (typeDiff !== 0) return typeDiff
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1
  if (a.id !== b.id) return a.id < b.id ? -1 : 1
  return 0
}
