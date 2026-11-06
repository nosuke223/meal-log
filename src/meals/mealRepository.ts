import type { MealChanges, MealInput, MealRecord } from './mealRecord'

/**
 * 食事の記録を保存する窓口。画面からはこの窓口だけを使う。
 * 保存先（ブラウザ内、サーバー）を差し替えても同じ使い方ができるよう、すべて非同期にしている。
 * 取得した記録は、日付 → 区分（朝・昼・夜・間食）→ 作成日時の順に並ぶ。
 */
export interface MealRepository {
  /** 指定した日の記録を取得する */
  listByDate(date: string): Promise<MealRecord[]>
  /** from から to まで（両端の日を含む）の記録を取得する */
  listByDateRange(from: string, to: string): Promise<MealRecord[]>
  /** 1件取得する。なければ null */
  get(id: string): Promise<MealRecord | null>
  /** 作成する。ID と作成・更新の日時は窓口が付ける */
  create(input: MealInput): Promise<MealRecord>
  /** 渡した項目だけを更新する。updatedAt は変わり、createdAt は変わらない */
  update(id: string, changes: MealChanges): Promise<MealRecord>
  /** 削除する */
  delete(id: string): Promise<void>
}

export class MealNotFoundError extends Error {
  constructor(id: string) {
    super(`記録が見つかりません: ${id}`)
    this.name = 'MealNotFoundError'
  }
}

export class MealStorageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MealStorageError'
  }
}
