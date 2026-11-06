// 書き出すファイルの形と、読み込むときの検査・混ぜる規則
//   { "version": 1, "exportedAt": "<書き出した日時(ISO 8601)>", "records": [<記録>...] }
import { toLocalDateString, validateMealRecord, type MealRecord } from '../meals/mealRecord'
import { statusForDate } from '../meals/mealStatus'

/** 書き出すファイルの形のバージョン番号。形を変えたら上げる */
export const DATA_FILE_VERSION = 1

export type DataFile = {
  version: typeof DATA_FILE_VERSION
  /** 書き出した日時（ISO 8601、UTC） */
  exportedAt: string
  records: MealRecord[]
}

/** 読み込むファイルが不正なときのエラー。message は画面にそのまま出せる文言 */
export class DataFileError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DataFileError'
  }
}

/** 書き出すファイルの中身（JSON の文字列）を作る */
export function buildDataFile(records: MealRecord[], now: Date): string {
  const data: DataFile = { version: DATA_FILE_VERSION, exportedAt: now.toISOString(), records }
  return JSON.stringify(data, null, 2)
}

/** 書き出すファイルの名前。meal-log-YYYY-MM-DD.json（端末の現地の日付） */
export function dataFileName(now: Date): string {
  return `meal-log-${toLocalDateString(now)}.json`
}

/** 読み込んだファイルの中身を検査し、記録の一覧を返す。1件でも不正なら DataFileError */
export function parseDataFile(text: string): MealRecord[] {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new DataFileError('ファイルを JSON として読めません。meal-log で書き出したファイルを選んでください')
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new DataFileError('ファイルの形が違います。meal-log で書き出したファイルを選んでください')
  }
  const { version, records } = data as { version?: unknown; records?: unknown }
  if (version !== DATA_FILE_VERSION) {
    throw new DataFileError(
      `ファイルのバージョンに対応していません（${version === undefined ? 'バージョンがありません' : `バージョン: ${JSON.stringify(version)}`}）`,
    )
  }
  if (!Array.isArray(records)) {
    throw new DataFileError('ファイルに記録の一覧（records）がありません')
  }
  const firstIndexById = new Map<string, number>()
  return records.map((value: unknown, index) => {
    const position = `${index + 1}件目の記録`
    let record: MealRecord
    try {
      record = validateMealRecord(value)
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      throw new DataFileError(`${position}が不正です: ${reason}`)
    }
    const first = firstIndexById.get(record.id)
    if (first !== undefined) {
      throw new DataFileError(`${position}の ID が、${first + 1}件目と同じです: ${record.id}`)
    }
    firstIndexById.set(record.id, index)
    return record
  })
}

export type ImportPlan = {
  /** 今あるデータにない ID の記録 */
  added: MealRecord[]
  /** 今ある記録より更新日時が新しい記録 */
  updated: MealRecord[]
  /** 今ある記録と更新日時が同じか古いので、取り込まない記録の件数 */
  unchangedCount: number
}

/**
 * 読み込んだ記録を、今あるデータとどう混ぜるかを決める。
 * 状態は日付に合わせて直す（未来の日の「食べた」は「予定」に、過去の日の「予定」は「食べた」に）。ID と日時は変えない
 */
export function planImport(existing: MealRecord[], incoming: MealRecord[], today: string): ImportPlan {
  const existingById = new Map(existing.map((record) => [record.id, record]))
  const plan: ImportPlan = { added: [], updated: [], unchangedCount: 0 }
  for (const record of incoming) {
    const fixed: MealRecord = { ...record, status: statusForDate(record.date, today, record.status) }
    const current = existingById.get(record.id)
    if (current === undefined) {
      plan.added.push(fixed)
    } else if (Date.parse(fixed.updatedAt) > Date.parse(current.updatedAt)) {
      plan.updated.push(fixed)
    } else {
      plan.unchangedCount += 1
    }
  }
  return plan
}
