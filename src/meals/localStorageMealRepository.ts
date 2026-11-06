import {
  compareMealRecords,
  isValidDate,
  MealValidationError,
  validateMealFields,
  type MealChanges,
  type MealRecord,
} from './mealRecord'
import { MealNotFoundError, MealStorageError, type MealRepository } from './mealRepository'

/** localStorage に保存するときのキー */
export const MEAL_STORAGE_KEY = 'meal-log:meals'

/** 保存データの形のバージョン番号。形を変えたら上げる */
export const MEAL_STORAGE_VERSION = 1

type StoredData = {
  version: typeof MEAL_STORAGE_VERSION
  records: MealRecord[]
}

export type LocalStorageMealRepositoryOptions = {
  /** 保存先。省略すると window.localStorage */
  storage?: Storage
  /** 今の日時。テストで差し替える */
  now?: () => Date
  /** ID を作る。テストで差し替える */
  generateId?: () => string
}

/** ブラウザ内（localStorage）に保存する窓口を作る */
export function createLocalStorageMealRepository(
  options: LocalStorageMealRepositoryOptions = {},
): MealRepository {
  // window.localStorage は、アクセスが拒否された環境では取得時に例外になる。
  // 窓口を作る時点では触らず、操作の中で取得して、呼び出し側のエラー処理で受けられるようにする
  const getStorage = () => options.storage ?? window.localStorage
  const now = options.now ?? (() => new Date())
  const generateId = options.generateId ?? (() => crypto.randomUUID())

  function load(): MealRecord[] {
    const raw = withStorage('読み込めません', (storage) => storage.getItem(MEAL_STORAGE_KEY))
    if (raw === null) return []
    return parseStoredData(raw).records
  }

  function save(records: MealRecord[]): void {
    const data: StoredData = { version: MEAL_STORAGE_VERSION, records }
    const json = JSON.stringify(data)
    withStorage('書き込めません', (storage) => storage.setItem(MEAL_STORAGE_KEY, json))
  }

  /** 保存先の操作が投げたエラー（容量の上限、アクセスの拒否など）を MealStorageError に包む */
  function withStorage<T>(failure: string, operation: (storage: Storage) => T): T {
    try {
      return operation(getStorage())
    } catch (error) {
      const reason = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
      throw new MealStorageError(`保存先に${failure}（${reason}）`, { cause: error })
    }
  }

  function sorted(records: MealRecord[]): MealRecord[] {
    return [...records].sort(compareMealRecords)
  }

  return {
    async listByDate(date) {
      assertDate(date)
      return sorted(load().filter((record) => record.date === date))
    },

    async listByDateRange(from, to) {
      assertDate(from)
      assertDate(to)
      if (from > to) {
        throw new MealValidationError(`期間の始まりが終わりより後です: ${from} 〜 ${to}`)
      }
      return sorted(load().filter((record) => from <= record.date && record.date <= to))
    },

    async get(id) {
      return load().find((record) => record.id === id) ?? null
    },

    async create(input) {
      const records = load()
      const fields = normalizeFields({
        date: input.date,
        mealType: input.mealType,
        name: input.name,
        genre: input.genre ?? null,
        dishType: input.dishType ?? null,
        status: input.status,
      })
      const timestamp = now().toISOString()
      const record: MealRecord = {
        id: generateId(),
        ...fields,
        createdAt: timestamp,
        updatedAt: timestamp,
      }
      if (records.some((existing) => existing.id === record.id)) {
        throw new MealStorageError(`ID が重なりました: ${record.id}`)
      }
      save([...records, record])
      return record
    },

    async update(id, changes) {
      const records = load()
      const index = records.findIndex((record) => record.id === id)
      if (index === -1) throw new MealNotFoundError(id)
      const current = records[index]
      const fields = normalizeFields({ ...pickFields(current), ...definedChanges(changes) })
      const updated: MealRecord = {
        ...current,
        ...fields,
        updatedAt: nextTimestamp(now(), current.updatedAt),
      }
      const next = [...records]
      next[index] = updated
      save(next)
      return updated
    },

    async delete(id) {
      const records = load()
      if (!records.some((record) => record.id === id)) throw new MealNotFoundError(id)
      save(records.filter((record) => record.id !== id))
    },
  }
}

type MealFields = Omit<MealRecord, 'id' | 'createdAt' | 'updatedAt'>

const FIELD_KEYS = ['date', 'mealType', 'name', 'genre', 'dishType', 'status'] as const

function pickFields(record: MealRecord): MealFields {
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
function definedChanges(changes: MealChanges): Partial<MealFields> {
  const result: Record<string, unknown> = {}
  for (const key of FIELD_KEYS) {
    if (changes[key] !== undefined) result[key] = changes[key]
  }
  return result as Partial<MealFields>
}

function normalizeFields(fields: MealFields): MealFields {
  validateMealFields(fields)
  return { ...fields, name: fields.name.trim() }
}

function assertDate(date: string): void {
  if (!isValidDate(date)) {
    throw new MealValidationError(`日付は YYYY-MM-DD の書式の実在する日にしてください: ${String(date)}`)
  }
}

/** 更新日時が前の値と同じかそれより前にならないようにする（同じミリ秒に続けて更新したとき用） */
function nextTimestamp(current: Date, previous: string): string {
  const previousTime = Date.parse(previous)
  const time = Math.max(current.getTime(), previousTime + 1)
  return new Date(time).toISOString()
}

function parseStoredData(raw: string): StoredData {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    throw new MealStorageError('保存データが壊れています（JSON として読めません）')
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new MealStorageError('保存データが壊れています（形が違います）')
  }
  const { version, records } = data as { version?: unknown; records?: unknown }
  if (version !== MEAL_STORAGE_VERSION) {
    throw new MealStorageError(`保存データのバージョンに対応していません: ${String(version)}`)
  }
  if (!Array.isArray(records)) {
    throw new MealStorageError('保存データが壊れています（記録の一覧がありません）')
  }
  const ids = new Set<string>()
  for (const record of records) {
    assertStoredRecord(record)
    if (ids.has(record.id)) {
      throw new MealStorageError(`保存データが壊れています（ID が重なっています: ${record.id}）`)
    }
    ids.add(record.id)
  }
  return { version, records }
}

function assertStoredRecord(value: unknown): asserts value is MealRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new MealStorageError('保存データが壊れています（記録の形が違います）')
  }
  const record = value as Record<string, unknown>
  if (typeof record.id !== 'string' || record.id === '') {
    throw new MealStorageError('保存データが壊れています（記録の ID がありません）')
  }
  for (const key of ['createdAt', 'updatedAt'] as const) {
    const timestamp = record[key]
    if (typeof timestamp !== 'string' || Number.isNaN(Date.parse(timestamp))) {
      throw new MealStorageError(`保存データが壊れています（記録 ${record.id} の ${key} が不正です）`)
    }
  }
  try {
    validateMealFields({
      date: record.date,
      mealType: record.mealType,
      name: record.name,
      genre: record.genre,
      dishType: record.dishType,
      status: record.status,
    })
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new MealStorageError(`保存データが壊れています（記録 ${record.id}: ${reason}）`)
  }
}
