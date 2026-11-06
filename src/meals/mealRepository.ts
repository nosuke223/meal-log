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
  /**
   * date（YYYY-MM-DD）より前の日の「予定」を、すべて「食べた」に更新する（日が過ぎた予定の自動更新用）。
   * 更新した記録の updatedAt は変わる。更新した記録を返す（なければ空）
   */
  markPlannedAsEatenBefore(date: string): Promise<MealRecord[]>
  /** すべての記録を取得する（書き出し用） */
  listAll(): Promise<MealRecord[]>
  /**
   * 記録を、ID と作成・更新の日時を保ったまま一括で保存する（読み込み用）。
   * 同じ ID の記録があれば渡した記録で置き換え、なければ追加する。渡していない記録は変えない。
   * 全部保存するか、何も保存しないかのどちらか（1件でも不正、または保存に失敗したら、保存データは元のまま）
   */
  importRecords(records: MealRecord[]): Promise<void>
}

export class MealNotFoundError extends Error {
  constructor(id: string) {
    super(`記録が見つかりません: ${id}`)
    this.name = 'MealNotFoundError'
  }
}

/** 保存データが壊れている、または保存先が使えない（容量の上限を超えた、アクセスが拒否された）ときのエラー */
export class MealStorageError extends Error {
  /** options.cause に、保存先が投げた元のエラーを入れる */
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'MealStorageError'
  }
}
