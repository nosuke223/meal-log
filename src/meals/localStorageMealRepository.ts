import { compareMealRecords, validateMealFields, type MealRecord } from './mealRecord'
import { MealNotFoundError, MealStorageError, type MealRepository } from './mealRepository'
import {
  assertDate,
  assertDateRange,
  createdAtFor,
  definedChanges,
  nextTimestamp,
  normalizeFields,
  pickFields,
  validateImportRecords,
} from './repositoryRules'

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
      assertDateRange(from, to)
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
      // 同じミリ秒に続けて作っても作った順に並ぶよう、保存済みのどの記録の作成日時よりも後にする
      const latestCreatedAt = records.reduce<string | null>(
        (latest, existing) =>
          latest === null || Date.parse(existing.createdAt) > Date.parse(latest) ? existing.createdAt : latest,
        null,
      )
      const timestamp = createdAtFor(now(), latestCreatedAt)
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

    async markPlannedAsEatenBefore(date) {
      assertDate(date)
      const records = load()
      const current = now()
      const updated: MealRecord[] = []
      const next = records.map((record) => {
        if (record.status !== 'planned' || record.date >= date) return record
        const eaten: MealRecord = { ...record, status: 'eaten', updatedAt: nextTimestamp(current, record.updatedAt) }
        updated.push(eaten)
        return eaten
      })
      // 更新するものがなければ書き込まない
      if (updated.length > 0) save(next)
      return sorted(updated)
    },

    async listAll() {
      return sorted(load())
    },

    async importRecords(input) {
      // 書き込む前にすべて検査する（1件でも不正なら何も書き込まない）
      const incoming = validateImportRecords(input)
      const byId = new Map(load().map((record) => [record.id, record]))
      for (const record of incoming) byId.set(record.id, record)
      // 1回の書き込みで保存するので、失敗したときは保存データは元のまま
      if (incoming.length > 0) save([...byId.values()])
    },
  }
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
