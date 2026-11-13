import { compareMealRecords, validateMealRecord, type MealRecord } from '../src/meals/mealRecord'
import { MealNotFoundError, MealStorageError, PlanLimitError, type MealRepository } from '../src/meals/mealRepository'
import {
  assertDate,
  assertDateRange,
  createdAtFor,
  definedChanges,
  nextTimestamp,
  normalizeFields,
  pickFields,
  validateImportRecords,
} from '../src/meals/repositoryRules'
import { FREE_PLAN_RECORD_LIMIT, createLimitMessage, importLimitMessage } from '../src/meals/plan'
import type { D1Database } from './d1'
import { readPlanUsage, recordLimitFor } from './memberPlan'

export type D1MealRepositoryOptions = {
  /** 今の日時。テストで差し替える */
  now?: () => Date
  /** ID を作る。テストで差し替える */
  generateId?: () => string
  /** 無料のプランで保存できる記録の数（追加と取り込みで確かめる）。省略すると FREE_PLAN_RECORD_LIMIT */
  freePlanRecordLimit?: number
}

/**
 * 一括で書き込むとき、1つの文で扱う記録の数。記録は JSON の文字列1つにまとめて渡すので、
 * 変数の個数の上限（1つの文に100個）には当たらない。1つの値の大きさの上限に余裕を持たせるために分ける
 */
export const RECORDS_PER_STATEMENT = 100

/** 読んでから書くまでの間に他の書き込みが割り込んだとき、読み直して試す回数の上限 */
export const MAX_WRITE_ATTEMPTS = 10

type MealRow = {
  id: string
  date: string
  meal_type: string
  name: string
  genre: string | null
  dish_type: string | null
  status: string
  created_at: string
  updated_at: string
}

const COLUMNS = 'id, date, meal_type, name, genre, dish_type, status, created_at, updated_at'

/**
 * D1（表 member_meals）に保存する窓口を作る。読み書きはすべて userId の会員の記録だけに絞る
 * （userId は、ログインのセッションで確かめた会員の ID）
 */
export function createD1MealRepository(
  db: D1Database,
  userId: string,
  options: D1MealRepositoryOptions = {},
): MealRepository {
  const now = options.now ?? (() => new Date())
  const generateId = options.generateId ?? (() => crypto.randomUUID())
  const freePlanRecordLimit = options.freePlanRecordLimit ?? FREE_PLAN_RECORD_LIMIT

  /** この会員の、保存できる記録の数（有料は null）と、今の記録の数 */
  async function readLimit(): Promise<{ limit: number | null; count: number }> {
    const usage = await withStorage('読み込めません', () => readPlanUsage(db, userId))
    return { limit: recordLimitFor(usage.plan, freePlanRecordLimit), count: usage.count }
  }

  async function selectRecords(where: string, ...values: unknown[]): Promise<MealRecord[]> {
    const result = await withStorage('読み込めません', () =>
      db
        .prepare(`SELECT ${COLUMNS} FROM member_meals WHERE user_id = ? AND ${where}`)
        .bind(userId, ...values)
        .all<MealRow>(),
    )
    return result.results.map(toRecord).sort(compareMealRecords)
  }

  async function selectOne(id: string): Promise<MealRecord | null> {
    const row = await withStorage('読み込めません', () =>
      db.prepare(`SELECT ${COLUMNS} FROM member_meals WHERE user_id = ? AND id = ?`).bind(userId, id).first<MealRow>(),
    )
    return row === null ? null : toRecord(row)
  }

  /**
   * 記録のうち、この会員がまだ持っていない ID の記録の数。記録は JSON の文字列にまとめて渡す
   * （ID の数だけ変数を並べると、変数の個数の上限に当たるため）
   */
  async function countNewRecords(parts: MealRecord[][]): Promise<number> {
    const statements = parts.map((part) =>
      db
        .prepare(
          `SELECT COUNT(*) AS added FROM json_each(?2) AS r
           WHERE NOT EXISTS (SELECT 1 FROM member_meals WHERE user_id = ?1 AND id = json_extract(r.value, '$.id'))`,
        )
        .bind(userId, JSON.stringify(part)),
    )
    const results = await withStorage('読み込めません', () => db.batch<{ added: number }>(statements))
    return results.reduce((sum, result) => sum + Number(result.results[0]?.added ?? 0), 0)
  }

  return {
    async listByDate(date) {
      assertDate(date)
      return selectRecords('date = ?', date)
    },

    async listByDateRange(from, to) {
      assertDateRange(from, to)
      return selectRecords('date BETWEEN ? AND ?', from, to)
    },

    async get(id) {
      return selectOne(id)
    },

    async create(input) {
      const fields = normalizeFields({
        date: input.date,
        mealType: input.mealType,
        name: input.name,
        genre: input.genre ?? null,
        dishType: input.dishType ?? null,
        status: input.status,
      })
      const id = generateId()
      let { limit } = await readLimit()
      for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt++) {
        // 同じミリ秒に続けて作っても作った順に並ぶよう、その人の保存済みのどの記録の作成日時よりも後にする
        const latest = await withStorage('読み込めません', () =>
          db
            .prepare('SELECT MAX(created_at) AS latest FROM member_meals WHERE user_id = ?')
            .bind(userId)
            .first<{ latest: string | null }>(),
        )
        const timestamp = createdAtFor(now(), latest?.latest ?? null)
        const record: MealRecord = { id, ...fields, createdAt: timestamp, updatedAt: timestamp }
        // 読んでから書くまでの間に、同じ人の別の作成が割り込んで、この作成日時以降の記録ができていたら書かない
        // 無料のプランの上限（?11。有料は NULL）に達していても書かない
        // （確かめるのと書くのを1つの文で行うので、間に他の書き込みは入らない。同時に追加されても上限を超えない）。
        // ID が重なったときは、主キーの制約で失敗する（MealStorageError）
        const result = await withStorage('書き込めません', () =>
          db
            .prepare(
              `INSERT INTO member_meals (user_id, ${COLUMNS})
               SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10
               WHERE NOT EXISTS (SELECT 1 FROM member_meals WHERE user_id = ?1 AND created_at >= ?9)
                 AND (?11 IS NULL OR (SELECT COUNT(*) FROM member_meals WHERE user_id = ?1) < ?11)`,
            )
            .bind(userId, ...toValues(record), limit)
            .run(),
        )
        if (result.meta.changes > 0) return record
        // 書かなかった。上限に達していたなら、やり直さずに上限のエラーにする。
        // 達していなければ、作成日時が割り込まれたので、作成日時を付け直してやり直す
        const current = await readLimit()
        limit = current.limit
        if (limit !== null && current.count >= limit) {
          throw new PlanLimitError(createLimitMessage(limit), { limit, count: current.count })
        }
      }
      throw conflictError()
    },

    async update(id, changes) {
      const defined = definedChanges(changes)
      for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt++) {
        const current = await selectOne(id)
        if (current === null) throw new MealNotFoundError(id)
        const fields = normalizeFields({ ...pickFields(current), ...defined })
        const updated: MealRecord = {
          ...current,
          ...fields,
          updatedAt: nextTimestamp(now(), current.updatedAt),
        }
        // 読んだときから行が変わっていないときだけ書く。読んでから書くまでの間に、他の更新や取り込みが
        // 割り込んでいたら、読み直して渡された項目だけを当て直す（割り込んだ変更を元に戻さないため）。
        // 取り込みは更新日時を変えずに置き換えることがあるので、更新日時だけでなく、すべての列を比べる
        const result = await withStorage('書き込めません', () =>
          db
            .prepare(
              `UPDATE member_meals SET date = ?, meal_type = ?, name = ?, genre = ?, dish_type = ?, status = ?, updated_at = ?
               WHERE user_id = ? AND id = ? AND date = ? AND meal_type = ? AND name = ? AND genre IS ?
                 AND dish_type IS ? AND status = ? AND created_at = ? AND updated_at = ?`,
            )
            .bind(
              updated.date,
              updated.mealType,
              updated.name,
              updated.genre,
              updated.dishType,
              updated.status,
              updated.updatedAt,
              userId,
              ...toValues(current),
            )
            .run(),
        )
        if (result.meta.changes > 0) return updated
        // 割り込まれた（削除されていれば、読み直したときに MealNotFoundError）
      }
      throw conflictError()
    },

    async delete(id) {
      const result = await withStorage('書き込めません', () =>
        db.prepare('DELETE FROM member_meals WHERE user_id = ? AND id = ?').bind(userId, id).run(),
      )
      if (result.meta.changes === 0) throw new MealNotFoundError(id)
    },

    async markPlannedAsEatenBefore(date) {
      assertDate(date)
      const marked = new Map<string, MealRecord>()
      for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt++) {
        const planned = await selectRecords("status = 'planned' AND date < ?", date)
        // 更新するものがなければ書き込まない
        if (planned.length === 0) return [...marked.values()].sort(compareMealRecords)
        const current = now()
        const changes = planned.map((record) => ({
          id: record.id,
          updatedAt: record.updatedAt,
          newUpdatedAt: nextTimestamp(current, record.updatedAt),
        }))
        // 読んでから書くまでの間に、他の更新や取り込みで状態や日付や更新日時が変わっていたら、その記録は書かない
        // （書くときにも、まだ予定で、基準の日より前の日で、更新日時が読んだときのままかを確かめる）。
        // 更新日時が変わっていた記録は、読み直して、保存されている更新日時より後の日時を付け直す
        const statements = chunk(changes, RECORDS_PER_STATEMENT).map((part) =>
          db
            .prepare(
              `UPDATE member_meals SET status = 'eaten', updated_at = u.new_updated_at
               FROM (
                 SELECT json_extract(value, '$.id') AS new_id,
                   json_extract(value, '$.updatedAt') AS old_updated_at,
                   json_extract(value, '$.newUpdatedAt') AS new_updated_at
                 FROM json_each(?2)
               ) AS u
               WHERE member_meals.user_id = ?1 AND member_meals.id = u.new_id AND member_meals.status = 'planned'
                 AND member_meals.date < ?3 AND member_meals.updated_at = u.old_updated_at
               RETURNING ${COLUMNS}`,
            )
            .bind(userId, JSON.stringify(part), date),
        )
        const results = await withStorage('書き込めません', () => db.batch<MealRow>(statements))
        const written = results.flatMap((result) => result.results.map(toRecord))
        for (const record of written) marked.set(record.id, record)
        if (written.length === planned.length) return [...marked.values()].sort(compareMealRecords)
        // 割り込まれた記録がある（まだ予定のまま残っていれば、読み直して書き直す）
      }
      throw conflictError()
    },

    async listAll() {
      return selectRecords('1 = 1')
    },

    async importRecords(input) {
      // 書き込む前にすべて検査する（1件でも不正なら何も書き込まない）
      const incoming = validateImportRecords(input)
      if (incoming.length === 0) return
      const parts = chunk(incoming, RECORDS_PER_STATEMENT)
      // 無料のプランなら、取り込んだ後の記録の数（今の数 + 今ない ID の記録の数）が上限を超えないかを、書く前に確かめる。
      // 今ある ID の記録は上書きなので数が増えない（上書きだけなら、上限を超えていても取り込む）。
      // 同時に何回も取り込まれたときに上限を超えることは、今は防がない
      const { limit, count } = await readLimit()
      if (limit !== null) {
        const added = await countNewRecords(parts)
        if (added > 0 && count + added > limit) {
          throw new PlanLimitError(importLimitMessage(limit), { limit, count })
        }
      }
      const statements = parts.map((part) =>
        db
          .prepare(
            // 「WHERE true」は、SQLite で INSERT ... SELECT と ON CONFLICT を一緒に書くときに必要
            `INSERT INTO member_meals (user_id, ${COLUMNS})
             SELECT ?1,
               json_extract(value, '$.id'),
               json_extract(value, '$.date'),
               json_extract(value, '$.mealType'),
               json_extract(value, '$.name'),
               json_extract(value, '$.genre'),
               json_extract(value, '$.dishType'),
               json_extract(value, '$.status'),
               json_extract(value, '$.createdAt'),
               json_extract(value, '$.updatedAt')
             FROM json_each(?2) WHERE true
             ON CONFLICT (user_id, id) DO UPDATE SET
               date = excluded.date,
               meal_type = excluded.meal_type,
               name = excluded.name,
               genre = excluded.genre,
               dish_type = excluded.dish_type,
               status = excluded.status,
               created_at = excluded.created_at,
               updated_at = excluded.updated_at`,
          )
          .bind(userId, JSON.stringify(part)),
      )
      // batch は1つのトランザクションなので、どれかが失敗したら、保存データは元のまま
      await withStorage('書き込めません', () => db.batch(statements))
    },
  }
}

function toValues(record: MealRecord): unknown[] {
  return [
    record.id,
    record.date,
    record.mealType,
    record.name,
    record.genre,
    record.dishType,
    record.status,
    record.createdAt,
    record.updatedAt,
  ]
}

/** 保存されていた行を記録にする。形が違えば MealStorageError */
function toRecord(row: MealRow): MealRecord {
  try {
    return validateMealRecord({
      id: row.id,
      date: row.date,
      mealType: row.meal_type,
      name: row.name,
      genre: row.genre,
      dishType: row.dish_type,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new MealStorageError(`保存データが壊れています（記録 ${row.id}: ${reason}）`)
  }
}

/** 他の書き込みとの重なりが続いて、書き込めなかったとき */
function conflictError(): MealStorageError {
  return new MealStorageError('ほかの操作と重なったため、保存先に書き込めません。もう一度試してください')
}

/** 保存先の操作が投げたエラーを MealStorageError に包む */
async function withStorage<T>(failure: string, operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    const reason = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
    throw new MealStorageError(`保存先に${failure}（${reason}）`, { cause: error })
  }
}

function chunk<T>(items: T[], size: number): T[][] {
  const result: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size))
  }
  return result
}
