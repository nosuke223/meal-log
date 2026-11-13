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
  /** 作成する。ID と作成・更新の日時は窓口が付ける。無料のプランの上限に達していたら PlanLimitError */
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
   * 全部保存するか、何も保存しないかのどちらか（1件でも不正、または保存に失敗したら、保存データは元のまま）。
   * 取り込んだ後の記録の数が無料のプランの上限を超えるなら、何も保存せず PlanLimitError
   * （今ない ID の記録がなく、上書きだけなら、上限を超えていても保存する）
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

/**
 * 無料のプランの記録の上限に達していて、追加や取り込みができないときのエラー（何も保存していない）。
 * message は、画面にそのまま出す文（サーバーの窓口では、サーバーが返した文）
 */
export class PlanLimitError extends Error {
  /** 保存できる記録の数と、今の記録の数（わからないときは null） */
  readonly limit: number | null
  readonly count: number | null

  constructor(message: string, details: { limit: number; count: number } | null = null) {
    super(message)
    this.name = 'PlanLimitError'
    this.limit = details?.limit ?? null
    this.count = details?.count ?? null
  }
}

/**
 * ログインの期限が切れて（ログアウトした、ほかの端末でパスワードを変えたなども含む）、保存先を使えないときのエラー。
 * 画面は、これを受け取ったら、ログインの画面に移る
 */
export class LoginExpiredError extends MealStorageError {
  constructor(message: string) {
    super(message)
    this.name = 'LoginExpiredError'
  }
}
