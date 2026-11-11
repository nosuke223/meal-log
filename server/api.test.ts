import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MealRecord } from '../src/meals/mealRecord'
import { createApiHandler } from './api'
import type { D1Database, D1PreparedStatement } from './d1'
import { createMemoryTransport } from './mail/mailer'
import { overrideDatabase, startTestDatabase, type TestDatabase } from './testDatabase'
import { createTestMember, signInTestMember, TEST_ORIGIN, testEnv, type TestMember } from './testMember'

let database: TestDatabase
/** ログインした会員（テストの間で使い回す。記録だけをテストごとに消す） */
let alice: TestMember
let bob: TestMember

const authHandle = createApiHandler({ mailTransport: createMemoryTransport() })

beforeAll(async () => {
  database = await startTestDatabase()
  alice = await createTestMember(authHandle, database.db, 'alice@example.com')
  bob = await createTestMember(authHandle, database.db, 'bob@example.com')
})

afterAll(async () => {
  await database?.dispose()
})

beforeEach(async () => {
  await database.db.prepare('DELETE FROM member_meals').run()
  vi.restoreAllMocks()
})

/** 呼ぶたびに1秒進む時計 */
function createClock(start = '2026-11-06T00:00:00.000Z') {
  let time = Date.parse(start)
  return () => {
    const date = new Date(time)
    time += 1000
    return date
  }
}

type CallOptions = {
  body?: unknown
  /** この会員のログインの cookie を送る（既定は alice） */
  as?: TestMember
  headers?: Record<string, string>
  db?: D1Database
}

function createClient(handlerOptions: Parameters<typeof createApiHandler>[0] = { now: createClock() }) {
  const handle = createApiHandler(handlerOptions)
  return async function call(method: string, path: string, options: CallOptions = {}) {
    const headers: Record<string, string> = { Cookie: (options.as ?? alice).cookie, ...options.headers }
    if (options.body !== undefined && headers['Content-Type'] === undefined) {
      headers['Content-Type'] = 'application/json'
    }
    if (['POST', 'PATCH', 'DELETE'].includes(method) && headers['Content-Type'] === undefined) {
      headers['Content-Type'] = 'application/json'
    }
    const request = new Request(`${TEST_ORIGIN}${path}`, {
      method,
      headers,
      body: options.body === undefined ? undefined : typeof options.body === 'string' ? options.body : JSON.stringify(options.body),
    })
    const response = await handle(request, testEnv(options.db ?? database.db))
    const text = await response.text()
    return { status: response.status, headers: response.headers, body: text === '' ? null : JSON.parse(text) }
  }
}

/**
 * prefix で始まる文を実行した直後に、interrupt を実行する D1（最初の times 回だけ）。
 * 読んでから書くまでの間に、別のリクエストの書き込みが割り込んだ状態を作る
 */
function interruptedDb(prefix: string, interrupt: () => Promise<unknown>, times = 1): D1Database {
  let count = 0
  async function after() {
    if (count >= times) return
    count++
    await interrupt()
  }
  function wrap(statement: D1PreparedStatement): D1PreparedStatement {
    return {
      bind: (...values) => wrap(statement.bind(...values)),
      first: async <T>() => {
        const result = await statement.first<T>()
        await after()
        return result
      },
      all: async <T>() => {
        const result = await statement.all<T>()
        await after()
        return result
      },
      run: async <T>() => {
        const result = await statement.run<T>()
        await after()
        return result
      },
    }
  }
  return overrideDatabase(database.db, {
    // prefix で始まらない文は包まない（batch には D1 の文のまま渡す必要があるため）
    prepare: (query) => {
      const statement = database.db.prepare(query)
      return query.trimStart().startsWith(prefix) ? wrap(statement) : statement
    },
  })
}

/** 1件の記録のアドレス */
function mealPath(id: string): string {
  return `/api/meal?id=${encodeURIComponent(id)}`
}

const base = {
  date: '2026-11-06',
  mealType: 'lunch',
  name: 'ご飯',
  status: 'eaten',
}

function imported(overrides: Partial<MealRecord> = {}): MealRecord {
  return {
    id: 'imported',
    date: '2026-10-01',
    mealType: 'dinner',
    name: 'カレー',
    genre: 'other',
    dishType: 'main',
    status: 'eaten',
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-02T10:00:00.000Z',
    ...overrides,
  }
}

describe('作成・取得・更新・削除', () => {
  it('作成すると 201 で ID と日時が付き、1件取得できる', async () => {
    const call = createClient()
    const created = await call('POST', '/api/meals', { body: { ...base, genre: 'japanese', dishType: 'staple' } })

    expect(created.status).toBe(201)
    expect(created.body.meal.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    expect(created.body.meal).toMatchObject({
      date: '2026-11-06',
      mealType: 'lunch',
      name: 'ご飯',
      genre: 'japanese',
      dishType: 'staple',
      status: 'eaten',
      createdAt: '2026-11-06T00:00:00.000Z',
      updatedAt: '2026-11-06T00:00:00.000Z',
    })
    const got = await call('GET', mealPath(created.body.meal.id))
    expect(got.status).toBe(200)
    expect(got.body).toEqual({ meal: created.body.meal })
  })

  it('ジャンルと料理の分類を省略すると未設定（null）になり、品名の前後の空白は取り除く', async () => {
    const call = createClient()
    const created = await call('POST', '/api/meals', { body: { ...base, name: '  味噌汁 ' } })

    expect(created.body.meal).toMatchObject({ name: '味噌汁', genre: null, dishType: null })
  })

  it('ない ID を1件取得すると 404（MealNotFoundError）', async () => {
    const call = createClient()
    const response = await call('GET', mealPath('missing'))

    expect(response.status).toBe(404)
    expect(response.body.error.type).toBe('MealNotFoundError')
  })

  it('更新すると渡した項目だけ変わり、updatedAt は変わって createdAt は変わらない', async () => {
    const call = createClient()
    const created = (await call('POST', '/api/meals', { body: { ...base, status: 'planned', genre: 'japanese' } })).body.meal
    const updated = await call('PATCH', mealPath(created.id), { body: { status: 'eaten', dishType: 'main' } })

    expect(updated.status).toBe(200)
    expect(updated.body.meal).toEqual({
      ...created,
      status: 'eaten',
      dishType: 'main',
      updatedAt: '2026-11-06T00:00:01.000Z',
    })
    expect((await call('GET', mealPath(created.id))).body.meal).toEqual(updated.body.meal)
  })

  it('ジャンルを null にすると未設定に戻せる', async () => {
    const call = createClient()
    const created = (await call('POST', '/api/meals', { body: { ...base, genre: 'chinese' } })).body.meal
    const updated = await call('PATCH', mealPath(created.id), { body: { genre: null } })

    expect(updated.body.meal.genre).toBeNull()
  })

  it('同じ時刻に更新しても updatedAt は前より後になる', async () => {
    const fixed = new Date('2026-11-06T00:00:00.000Z')
    const call = createClient({ now: () => fixed })
    const created = (await call('POST', '/api/meals', { body: base })).body.meal
    const updated = (await call('PATCH', mealPath(created.id), { body: { name: 'パン' } })).body.meal

    expect(updated.updatedAt > created.updatedAt).toBe(true)
    expect(updated.createdAt).toBe(created.createdAt)
  })

  it('読んでから書くまでの間に別の更新が割り込んでも、割り込んだ変更を元に戻さない', async () => {
    const call = createClient()
    const created = (await call('POST', '/api/meals', { body: { ...base, status: 'planned' } })).body.meal
    // 品名の更新が記録を読んだ直後に、状態の更新を終わらせる
    const db = interruptedDb('SELECT id,', () => call('PATCH', mealPath(created.id), { body: { status: 'eaten' } }))

    const updated = await call('PATCH', mealPath(created.id), { db, body: { name: 'パン' } })
    expect(updated.status).toBe(200)
    expect(updated.body.meal).toMatchObject({ name: 'パン', status: 'eaten' })
    expect((await call('GET', mealPath(created.id))).body.meal).toEqual(updated.body.meal)
  })

  it('読んでから書くまでの間に削除されたら、更新は 404 で、記録は戻らない', async () => {
    const call = createClient()
    const created = (await call('POST', '/api/meals', { body: base })).body.meal
    const db = interruptedDb('SELECT id,', () => call('DELETE', mealPath(created.id)))

    const updated = await call('PATCH', mealPath(created.id), { db, body: { name: 'パン' } })
    expect(updated.status).toBe(404)
    expect(updated.body.error.type).toBe('MealNotFoundError')
    expect((await call('GET', '/api/meals')).body.meals).toEqual([])
  })

  it('割り込みが続いて書き込めなければ 500（MealStorageError）で、割り込んだ変更は残る', async () => {
    const call = createClient()
    const created = (await call('POST', '/api/meals', { body: base })).body.meal
    let count = 0
    const db = interruptedDb(
      'SELECT id,',
      () => call('PATCH', mealPath(created.id), { body: { name: `割り込み${++count}` } }),
      Infinity,
    )
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const updated = await call('PATCH', mealPath(created.id), { db, body: { status: 'planned' } })
    expect(updated.status).toBe(500)
    expect(updated.body.error.type).toBe('MealStorageError')
    expect((await call('GET', mealPath(created.id))).body.meal).toMatchObject({ name: `割り込み${count}`, status: 'eaten' })
  })

  it('削除すると 204 で、取得できなくなる', async () => {
    const call = createClient()
    const kept = (await call('POST', '/api/meals', { body: base })).body.meal
    const removed = (await call('POST', '/api/meals', { body: { ...base, name: 'パン' } })).body.meal

    const response = await call('DELETE', mealPath(removed.id))
    expect(response.status).toBe(204)
    expect(response.body).toBeNull()
    expect((await call('GET', mealPath(removed.id))).status).toBe(404)
    expect((await call('GET', `/api/meals?date=${base.date}`)).body.meals).toEqual([kept])
  })

  it.each([
    ['「/」などを含む', 'a/b c?&id=x#'],
    ['「.」だけの', '.'],
    ['「..」だけの', '..'],
    ['操作の名前と同じ', 'import'],
    ['操作の名前と同じ', 'mark-planned-as-eaten'],
  ])('ID が%s記録（%s）も、取得・更新・削除できる', async (_, id) => {
    const call = createClient()
    await call('POST', '/api/import', { body: { records: [imported({ id }), imported({ id: 'other' })] } })
    const path = mealPath(id)

    expect((await call('GET', path)).body.meal.id).toBe(id)
    expect((await call('PATCH', path, { body: { name: 'パン' } })).body.meal).toMatchObject({ id, name: 'パン' })
    expect((await call('DELETE', path)).status).toBe(204)
    expect((await call('GET', '/api/meals')).body.meals.map((record: MealRecord) => record.id)).toEqual(['other'])
  })

  it.each([
    ['id がない', '/api/meal'],
    ['id が空', '/api/meal?id='],
    ['id が2つある', '/api/meal?id=a&id=b'],
    ['知らない条件がある', '/api/meal?id=a&date=2026-11-06'],
  ])('%s なら 400（MealValidationError）', async (_, path) => {
    const call = createClient()
    await call('POST', '/api/import', { body: { records: [imported({ id: 'a' })] } })

    for (const [method, body] of [
      ['GET', undefined],
      ['PATCH', { name: 'パン' }],
      ['DELETE', undefined],
    ] as const) {
      const response = await call(method, path, { body })
      expect(response.status).toBe(400)
      expect(response.body.error.type).toBe('MealValidationError')
    }
    expect((await call('GET', mealPath('a'))).body.meal).toEqual(imported({ id: 'a' }))
  })

  it('パスに ID を入れたアドレス（/api/meals/<id>）はない（404）', async () => {
    const call = createClient()
    await call('POST', '/api/import', { body: { records: [imported({ id: 'a' })] } })

    const response = await call('GET', '/api/meals/a')
    expect(response.status).toBe(404)
    expect(response.body.error.type).toBe('RouteNotFound')
  })
})

describe('日付指定と期間指定の取得', () => {
  it('日付を指定すると、その日の記録だけを返す', async () => {
    const call = createClient()
    const a = (await call('POST', '/api/meals', { body: { ...base, date: '2026-11-05' } })).body.meal
    const b = (await call('POST', '/api/meals', { body: { ...base, date: '2026-11-06' } })).body.meal
    await call('POST', '/api/meals', { body: { ...base, date: '2026-11-07' } })

    expect((await call('GET', '/api/meals?date=2026-11-05')).body).toEqual({ meals: [a] })
    expect((await call('GET', '/api/meals?date=2026-11-06')).body).toEqual({ meals: [b] })
    expect((await call('GET', '/api/meals?date=2026-11-08')).body).toEqual({ meals: [] })
  })

  it('期間を指定すると、両端の日を含めて返す', async () => {
    const call = createClient()
    await call('POST', '/api/meals', { body: { ...base, date: '2026-10-31' } })
    const first = (await call('POST', '/api/meals', { body: { ...base, date: '2026-11-01' } })).body.meal
    const middle = (await call('POST', '/api/meals', { body: { ...base, date: '2026-11-15' } })).body.meal
    const last = (await call('POST', '/api/meals', { body: { ...base, date: '2026-11-30' } })).body.meal
    await call('POST', '/api/meals', { body: { ...base, date: '2026-12-01' } })

    expect((await call('GET', '/api/meals?from=2026-11-01&to=2026-11-30')).body.meals).toEqual([first, middle, last])
    expect((await call('GET', '/api/meals?from=2026-11-15&to=2026-11-15')).body.meals).toEqual([middle])
  })

  it.each([
    ['期間の始まりが終わりより後', '/api/meals?from=2026-11-30&to=2026-11-01'],
    ['日付の書式が違う', '/api/meals?date=2026/11/06'],
    ['実在しない日付', '/api/meals?from=2026-11-01&to=2026-11-31'],
    ['日付が空', '/api/meals?date='],
    ['期間の終わりがない', '/api/meals?from=2026-11-01'],
    ['知らない条件', '/api/meals?month=2026-11'],
  ])('%s なら 400（MealValidationError）', async (_, path) => {
    const call = createClient()
    const response = await call('GET', path)

    expect(response.status).toBe(400)
    expect(response.body.error.type).toBe('MealValidationError')
  })
})

describe('並び順', () => {
  it('日付 → 区分（朝・昼・夜・間食）→ 作成日時の順に並ぶ', async () => {
    const call = createClient()
    const create = async (date: string, mealType: string, name: string) =>
      (await call('POST', '/api/meals', { body: { ...base, date, mealType, name } })).body.meal
    const snack = await create('2026-11-06', 'snack', '1')
    const dinner = await create('2026-11-06', 'dinner', '2')
    const lunchFirst = await create('2026-11-06', 'lunch', '3')
    const breakfast = await create('2026-11-06', 'breakfast', '4')
    const lunchSecond = await create('2026-11-06', 'lunch', '5')
    const earlierDay = await create('2026-11-05', 'snack', '6')

    const expected = [breakfast, lunchFirst, lunchSecond, dinner, snack]
    expect((await call('GET', '/api/meals?date=2026-11-06')).body.meals).toEqual(expected)
    expect((await call('GET', '/api/meals?from=2026-11-05&to=2026-11-06')).body.meals).toEqual([earlierDay, ...expected])
    expect((await call('GET', '/api/meals')).body.meals).toEqual([earlierDay, ...expected])
  })

  it('同じ時刻に作っても、作った順に並ぶ', async () => {
    const fixed = new Date('2026-11-06T03:00:00.000Z')
    const ids = ['ffff', 'aaaa', 'cccc']
    let i = 0
    const call = createClient({ now: () => fixed, generateId: () => ids[i++] })
    const names = ['1品目 ご飯', '2品目 味噌汁', '3品目 焼き魚']
    for (const name of names) {
      await call('POST', '/api/meals', { body: { ...base, mealType: 'dinner', name } })
    }

    const records: MealRecord[] = (await call('GET', `/api/meals?date=${base.date}`)).body.meals
    expect(records.map((record) => record.name)).toEqual(names)
    expect(records[0].createdAt).toBe('2026-11-06T03:00:00.000Z')
    expect(records[2].createdAt).toBe('2026-11-06T03:00:00.002Z')
  })

  it('同じ人の作成が、作成日時を決めてから書くまでの間に割り込んでも、作成日時は重ならない', async () => {
    const fixed = new Date('2026-11-06T03:00:00.000Z')
    const ids = ['zzzz', 'aaaa']
    let i = 0
    const call = createClient({ now: () => fixed, generateId: () => ids[i++] })
    // 1つ目の作成が最も遅い作成日時を読んだ直後に、2つ目の作成を終わらせる
    const db = interruptedDb('SELECT MAX(created_at)', () => call('POST', '/api/meals', { body: { ...base, name: '割り込み' } }))

    const created = await call('POST', '/api/meals', { db, body: { ...base, name: '先に始めた' } })
    expect(created.status).toBe(201)

    const records: MealRecord[] = (await call('GET', `/api/meals?date=${base.date}`)).body.meals
    expect(records.map((record) => [record.name, record.createdAt])).toEqual([
      ['割り込み', '2026-11-06T03:00:00.000Z'],
      ['先に始めた', '2026-11-06T03:00:00.001Z'],
    ])
    expect(created.body.meal).toEqual(records[1])
  })

  it('時計を差し替えずに続けて作っても、作った順に並ぶ', async () => {
    const call = createClient({})
    const names = Array.from({ length: 20 }, (_, index) => `品${index}`)
    for (const name of names) {
      await call('POST', '/api/meals', { body: { ...base, name } })
    }

    const records: MealRecord[] = (await call('GET', `/api/meals?date=${base.date}`)).body.meals
    expect(records.map((record) => record.name)).toEqual(names)
  })

  it('その人の保存済みの記録のうち、最も遅い作成日時より後の日時で作る（他の人の記録は見ない）', async () => {
    const call = createClient()
    await call('POST', '/api/import', {
      body: { records: [imported({ id: 'future', createdAt: '2026-11-06T05:00:00.000Z' })] },
    })
    await call('POST', '/api/import', {
      as: bob,
      body: { records: [imported({ id: 'bob-future', createdAt: '2026-11-06T09:00:00.000Z' })] },
    })
    const created = (await call('POST', '/api/meals', { body: base })).body.meal

    expect(created.createdAt).toBe('2026-11-06T05:00:00.001Z')
    expect(created.updatedAt).toBe(created.createdAt)
  })

  it('作成日時まで同じ記録は、ID の順に並ぶ', async () => {
    const call = createClient()
    const record = (id: string) => imported({ id, date: base.date, createdAt: '2026-11-06T00:00:00.000Z' })
    await call('POST', '/api/import', { body: { records: [record('c'), record('a'), record('b')] } })

    const first: MealRecord[] = (await call('GET', `/api/meals?date=${base.date}`)).body.meals
    expect(first.map((r) => r.id)).toEqual(['a', 'b', 'c'])
  })
})

describe('不正な値', () => {
  const invalidInputs: [string, Record<string, unknown>][] = [
    ['品名が空', { name: '' }],
    ['品名が空白だけ', { name: ' 　\t' }],
    ['品名が文字列でない', { name: 1 }],
    ['品名が null', { name: null }],
    ['日付の書式が違う', { date: '2026/11/06' }],
    ['実在しない日付', { date: '2026-02-29' }],
    ['区分が決まった値でない', { mealType: 'brunch' }],
    ['ジャンルが決まった値でない', { genre: 'korean' }],
    ['料理の分類が決まった値でない', { dishType: 'dessert' }],
    ['状態が決まった値でない', { status: 'skipped' }],
  ]

  it.each(invalidInputs)('作成: %s なら 400 で、保存されない', async (_, override) => {
    const call = createClient()
    const response = await call('POST', '/api/meals', { body: { ...base, ...override } })

    expect(response.status).toBe(400)
    expect(response.body.error.type).toBe('MealValidationError')
    expect((await call('GET', '/api/meals')).body.meals).toEqual([])
  })

  it.each(invalidInputs)('更新: %s なら 400 で、記録は変わらない', async (_, override) => {
    const call = createClient()
    const created = (await call('POST', '/api/meals', { body: base })).body.meal
    const response = await call('PATCH', mealPath(created.id), { body: override })

    expect(response.status).toBe(400)
    expect(response.body.error.type).toBe('MealValidationError')
    expect((await call('GET', mealPath(created.id))).body.meal).toEqual(created)
  })

  it.each([
    ['JSON として読めない', '{not json'],
    ['オブジェクトでない', '[1]'],
    ['null', 'null'],
  ])('本文が %s なら 400', async (_, body) => {
    const call = createClient()
    const response = await call('POST', '/api/meals', { body })

    expect(response.status).toBe(400)
    expect(response.body.error.type).toBe('MealValidationError')
  })
})

describe('存在しない ID', () => {
  it('更新すると 404（MealNotFoundError）', async () => {
    const call = createClient()
    const response = await call('PATCH', mealPath('missing'), { body: { name: 'パン' } })

    expect(response.status).toBe(404)
    expect(response.body.error.type).toBe('MealNotFoundError')
  })

  it('削除すると 404（MealNotFoundError）で、他の記録は残る', async () => {
    const call = createClient()
    await call('POST', '/api/meals', { body: base })
    const response = await call('DELETE', mealPath('missing'))

    expect(response.status).toBe(404)
    expect(response.body.error.type).toBe('MealNotFoundError')
    expect((await call('GET', '/api/meals')).body.meals).toHaveLength(1)
  })
})

describe('日が過ぎた予定の更新', () => {
  it('基準の日より前の日の予定だけを食べたにし、更新日時を変え、更新した記録を返す', async () => {
    const call = createClient()
    const create = async (body: Record<string, unknown>) =>
      (await call('POST', '/api/meals', { body: { ...base, ...body } })).body.meal as MealRecord
    const past = await create({ date: '2026-11-04', status: 'planned' })
    const yesterday = await create({ date: '2026-11-05', mealType: 'dinner', status: 'planned' })
    const eaten = await create({ date: '2026-11-04', name: 'パン', status: 'eaten' })
    const today = await create({ date: '2026-11-06', status: 'planned' })
    const future = await create({ date: '2026-11-07', status: 'planned' })

    const response = await call('POST', '/api/mark-planned-as-eaten', { body: { date: '2026-11-06' } })
    expect(response.status).toBe(200)
    const updated: MealRecord[] = response.body.meals

    expect(updated.map((record) => record.id)).toEqual([past.id, yesterday.id])
    for (const [before, after] of [
      [past, updated[0]],
      [yesterday, updated[1]],
    ]) {
      expect(after).toEqual({ ...before, status: 'eaten', updatedAt: after.updatedAt })
      expect(Date.parse(after.updatedAt)).toBeGreaterThan(Date.parse(before.updatedAt))
      expect((await call('GET', mealPath(before.id))).body.meal).toEqual(after)
    }
    for (const unchanged of [eaten, today, future]) {
      expect((await call('GET', mealPath(unchanged.id))).body.meal).toEqual(unchanged)
    }
  })

  it('予定を読んでから書くまでの間に、日付が基準の日以降に変わった記録は食べたにしない', async () => {
    const call = createClient()
    const moved = (await call('POST', '/api/meals', { body: { ...base, date: '2026-11-05', status: 'planned' } })).body
      .meal as MealRecord
    const kept = (
      await call('POST', '/api/meals', { body: { ...base, date: '2026-11-04', mealType: 'dinner', status: 'planned' } })
    ).body.meal as MealRecord
    // 予定を読んだ直後に、1件の日付を基準の日より後へ移す
    const db = interruptedDb('SELECT id,', () => call('PATCH', mealPath(moved.id), { body: { date: '2026-11-07' } }))

    const response = await call('POST', '/api/mark-planned-as-eaten', { db, body: { date: '2026-11-06' } })
    expect(response.status).toBe(200)
    expect(response.body.meals.map((record: MealRecord) => record.id)).toEqual([kept.id])
    expect((await call('GET', mealPath(moved.id))).body.meal).toMatchObject({
      date: '2026-11-07',
      status: 'planned',
    })
    expect((await call('GET', mealPath(kept.id))).body.meal.status).toBe('eaten')
  })

  it('予定を読んでから書くまでの間に別の更新が割り込んでも、更新日時は割り込んだ更新より後になる', async () => {
    // 時計が進まなくても、更新日時は保存されているものより後になる
    const fixed = new Date('2026-11-06T00:00:00.000Z')
    const call = createClient({ now: () => fixed })
    const created = (await call('POST', '/api/meals', { body: { ...base, date: '2026-11-05', status: 'planned' } })).body
      .meal as MealRecord
    let patched: MealRecord | undefined
    // 予定を読んだ直後に、予定のまま品名を変える
    const db = interruptedDb('SELECT id,', async () => {
      patched = (await call('PATCH', mealPath(created.id), { body: { name: 'パン' } })).body.meal
    })

    const response = await call('POST', '/api/mark-planned-as-eaten', { db, body: { date: '2026-11-06' } })
    expect(response.status).toBe(200)
    const [marked]: MealRecord[] = response.body.meals
    expect(response.body.meals).toHaveLength(1)
    expect(marked).toMatchObject({ id: created.id, name: 'パン', status: 'eaten' })
    expect(Date.parse(marked.updatedAt)).toBeGreaterThan(Date.parse(patched!.updatedAt))
    expect((await call('GET', mealPath(created.id))).body.meal).toEqual(marked)
  })

  it('予定の更新で割り込みが続いて書き込めなければ 500（MealStorageError）で、割り込んだ変更は残る', async () => {
    const call = createClient()
    const created = (await call('POST', '/api/meals', { body: { ...base, date: '2026-11-05', status: 'planned' } })).body
      .meal as MealRecord
    let count = 0
    const db = interruptedDb(
      'SELECT id,',
      () => call('PATCH', mealPath(created.id), { body: { name: `割り込み${++count}` } }),
      Infinity,
    )
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const response = await call('POST', '/api/mark-planned-as-eaten', { db, body: { date: '2026-11-06' } })
    expect(response.status).toBe(500)
    expect(response.body.error.type).toBe('MealStorageError')
    expect((await call('GET', mealPath(created.id))).body.meal).toMatchObject({
      name: `割り込み${count}`,
      status: 'planned',
    })
  })

  it('更新する予定がなければ空を返す', async () => {
    const call = createClient()
    await call('POST', '/api/meals', { body: { ...base, date: '2026-11-06', status: 'planned' } })

    expect((await call('POST', '/api/mark-planned-as-eaten', { body: { date: '2026-11-06' } })).body).toEqual({
      meals: [],
    })
  })

  it('数百件の予定もまとめて更新できる', async () => {
    const call = createClient()
    const records = Array.from({ length: 250 }, (_, index) =>
      imported({ id: `p${String(index).padStart(3, '0')}`, status: 'planned' }),
    )
    await call('POST', '/api/import', { body: { records } })

    const updated: MealRecord[] = (
      await call('POST', '/api/mark-planned-as-eaten', { body: { date: '2026-11-06' } })
    ).body.meals
    expect(updated).toHaveLength(250)
    const all: MealRecord[] = (await call('GET', '/api/meals')).body.meals
    expect(all.every((record) => record.status === 'eaten')).toBe(true)
  })

  it.each([
    ['不正な日付', { date: '2026-02-30' }],
    ['日付がない', {}],
    ['日付が文字列でない', { date: 20261106 }],
  ])('%s なら 400（MealValidationError）', async (_, body) => {
    const call = createClient()
    const response = await call('POST', '/api/mark-planned-as-eaten', { body })

    expect(response.status).toBe(400)
    expect(response.body.error.type).toBe('MealValidationError')
  })
})

describe('全件の取得と一括取り込み', () => {
  it('全件の取得は、すべての日の記録を並べて返す。0件なら空', async () => {
    const call = createClient()
    expect((await call('GET', '/api/meals')).body).toEqual({ meals: [] })
    const later = (await call('POST', '/api/meals', { body: { ...base, date: '2026-12-01' } })).body.meal
    const earlier = (await call('POST', '/api/meals', { body: { ...base, date: '2025-01-01' } })).body.meal
    expect((await call('GET', '/api/meals')).body.meals).toEqual([earlier, later])
  })

  it('ID と日時を保ったまま追加し、同じ ID は置き換え、渡していない記録は残す', async () => {
    const call = createClient()
    const kept = (await call('POST', '/api/meals', { body: base })).body.meal
    const replaced = (await call('POST', '/api/meals', { body: { ...base, name: 'パン' } })).body.meal

    const replacement = imported({ id: replaced.id, name: 'おにぎり', genre: null, dishType: null })
    const response = await call('POST', '/api/import', { body: { records: [imported(), replacement] } })

    expect(response.status).toBe(204)
    expect((await call('GET', mealPath('imported'))).body.meal).toEqual(imported())
    expect((await call('GET', mealPath(replaced.id))).body.meal).toEqual(replacement)
    expect((await call('GET', mealPath(kept.id))).body.meal).toEqual(kept)
    expect((await call('GET', '/api/meals')).body.meals).toHaveLength(3)
  })

  it('品名の前後の空白は取り除いて保存する', async () => {
    const call = createClient()
    await call('POST', '/api/import', { body: { records: [imported({ name: ' カレー  ' })] } })

    expect((await call('GET', mealPath('imported'))).body.meal.name).toBe('カレー')
  })

  it('0件の取り込みは何も変えない', async () => {
    const call = createClient()
    const kept = (await call('POST', '/api/meals', { body: base })).body.meal

    expect((await call('POST', '/api/import', { body: { records: [] } })).status).toBe(204)
    expect((await call('GET', '/api/meals')).body.meals).toEqual([kept])
  })

  it('数百件を取り込める', async () => {
    const call = createClient()
    const records = Array.from({ length: 500 }, (_, index) =>
      imported({ id: `r${String(index).padStart(3, '0')}`, name: `品${index}` }),
    )

    expect((await call('POST', '/api/import', { body: { records } })).status).toBe(204)
    const all: MealRecord[] = (await call('GET', '/api/meals')).body.meals
    expect(all).toEqual([...records].sort((a, b) => (a.id < b.id ? -1 : 1)))
  })

  it('1件でも不正、または ID が重なっていたら 400 で、何も保存しない', async () => {
    const call = createClient()
    const kept = (await call('POST', '/api/meals', { body: base })).body.meal

    const invalid = await call('POST', '/api/import', {
      body: { records: [imported({ id: 'ok' }), imported({ id: 'bad', name: ' ' })] },
    })
    expect(invalid.status).toBe(400)
    expect(invalid.body.error).toEqual({
      type: 'MealValidationError',
      message: '2件目の記録が不正です: 品名を入力してください',
    })
    const duplicated = await call('POST', '/api/import', { body: { records: [imported(), imported()] } })
    expect(duplicated.status).toBe(400)
    const badTime = await call('POST', '/api/import', { body: { records: [imported({ updatedAt: 'x' })] } })
    expect(badTime.status).toBe(400)
    const notArray = await call('POST', '/api/import', { body: { records: 'x' } })
    expect(notArray.status).toBe(400)

    expect((await call('GET', '/api/meals')).body.meals).toEqual([kept])
  })

  it('保存に失敗したときは 500（MealStorageError）で、複数の文に分けた取り込みでも保存データは元のまま', async () => {
    const call = createClient()
    const kept = (await call('POST', '/api/meals', { body: base })).body.meal
    // 最後の文だけを失敗させる（それより前の文の書き込みも取り消されることを確かめる）
    const failingDb = overrideDatabase(database.db, {
      batch: (statements: D1PreparedStatement[]) =>
        database.db.batch([...statements.slice(0, -1), database.db.prepare('INSERT INTO no_such_table VALUES (1)')]),
    })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const records = Array.from({ length: 250 }, (_, index) => imported({ id: `r${index}` }))

    const response = await call('POST', '/api/import', { db: failingDb, body: { records } })
    expect(response.status).toBe(500)
    expect(response.body.error.type).toBe('MealStorageError')
    expect((await call('GET', '/api/meals')).body.meals).toEqual([kept])
  })
})

describe('他の会員の記録', () => {
  async function setUp() {
    const call = createClient()
    const bobMeal = (await call('POST', '/api/meals', { as: bob, body: { ...base, name: 'ボブの品', status: 'planned' } }))
      .body.meal as MealRecord
    return { call, bobMeal }
  }

  it('取得（日付、期間、1件、全件）で見えない。ID を指定しても 404', async () => {
    const { call, bobMeal } = await setUp()

    expect((await call('GET', `/api/meals?date=${base.date}`)).body.meals).toEqual([])
    expect((await call('GET', `/api/meals?from=${base.date}&to=${base.date}`)).body.meals).toEqual([])
    const got = await call('GET', mealPath(bobMeal.id))
    expect(got.status).toBe(404)
    expect(got.body.error.type).toBe('MealNotFoundError')
    expect((await call('GET', '/api/meals')).body.meals).toEqual([])
    expect((await call('GET', '/api/meals', { as: bob })).body.meals).toEqual([bobMeal])
  })

  it('更新・削除は 404 で、日が過ぎた予定の更新でも変えられない', async () => {
    const { call, bobMeal } = await setUp()

    const patched = await call('PATCH', mealPath(bobMeal.id), { body: { name: '書き換え' } })
    expect(patched.status).toBe(404)
    expect(patched.body.error.type).toBe('MealNotFoundError')
    const deleted = await call('DELETE', mealPath(bobMeal.id))
    expect(deleted.status).toBe(404)
    expect(deleted.body.error.type).toBe('MealNotFoundError')
    expect((await call('POST', '/api/mark-planned-as-eaten', { body: { date: '2026-12-01' } })).body.meals).toEqual(
      [],
    )
    expect((await call('GET', mealPath(bobMeal.id), { as: bob })).body.meal).toEqual(bobMeal)
  })

  it('同じ ID の記録を取り込んでも、他の会員の記録は変わらず、別の記録として保存される', async () => {
    const { call, bobMeal } = await setUp()

    const mine = imported({ id: bobMeal.id, name: 'アリスの品' })
    expect((await call('POST', '/api/import', { body: { records: [mine] } })).status).toBe(204)
    expect((await call('GET', mealPath(bobMeal.id))).body.meal).toEqual(mine)
    expect((await call('GET', mealPath(bobMeal.id), { as: bob })).body.meal).toEqual(bobMeal)

    // 取り込んだ記録を変えたり消したりしても、他の会員の同じ ID の記録は変わらない
    expect((await call('PATCH', mealPath(bobMeal.id), { body: { name: 'アリスの品2' } })).status).toBe(200)
    expect((await call('DELETE', mealPath(bobMeal.id))).status).toBe(204)
    expect((await call('GET', mealPath(bobMeal.id), { as: bob })).body.meal).toEqual(bobMeal)
    expect((await call('GET', '/api/meals', { as: bob })).body.meals).toEqual([bobMeal])
  })

  it('2人が同じ ID の記録を取り込むと、それぞれ別の記録になる', async () => {
    const call = createClient()
    const shared = imported({ id: 'shared-id' })

    await call('POST', '/api/import', { body: { records: [shared] } })
    await call('POST', '/api/import', { as: bob, body: { records: [{ ...shared, name: 'ボブのカレー' }] } })
    expect((await call('GET', mealPath('shared-id'))).body.meal).toEqual(shared)
    expect((await call('GET', mealPath('shared-id'), { as: bob })).body.meal).toEqual({ ...shared, name: 'ボブのカレー' })
  })

  it('日が過ぎた予定の更新は、自分の予定だけを食べたにする', async () => {
    const call = createClient()
    const mine = (await call('POST', '/api/meals', { body: { ...base, status: 'planned' } })).body.meal as MealRecord
    const bobs = (await call('POST', '/api/meals', { as: bob, body: { ...base, status: 'planned' } })).body.meal as MealRecord

    const marked = await call('POST', '/api/mark-planned-as-eaten', { body: { date: '2026-12-01' } })
    expect(marked.body.meals.map((record: MealRecord) => record.id)).toEqual([mine.id])
    expect((await call('GET', mealPath(bobs.id), { as: bob })).body.meal).toEqual(bobs)
  })

  it('同じ会員なら、別のセッション（別の端末のログイン）でも同じ記録が見える', async () => {
    const { call, bobMeal } = await setUp()
    const otherDevice = await signInTestMember(authHandle, database.db, 'Bob@Example.COM')

    expect(otherDevice.id).toBe(bob.id)
    expect(otherDevice.cookie).not.toBe(bob.cookie)
    expect((await call('GET', mealPath(bobMeal.id), { as: otherDevice })).body.meal).toEqual(bobMeal)
  })
})

describe('リクエストの形', () => {
  it.each([
    ['POST', '/api/meals', { body: JSON.stringify(base) }],
    ['PATCH', mealPath('a'), { body: JSON.stringify({ name: 'パン' }) }],
    ['DELETE', mealPath('a'), {}],
    ['POST', '/api/import', { body: JSON.stringify({ records: [] }) }],
    ['POST', '/api/mark-planned-as-eaten', { body: JSON.stringify({ date: '2026-11-06' }) }],
  ])('書き込み（%s %s）は Content-Type が application/json でなければ 415 で、何も変えない', async (method, path, init) => {
    const call = createClient()
    await call('POST', '/api/import', { body: { records: [imported({ id: 'a', status: 'planned' })] } })
    const before = (await call('GET', '/api/meals')).body.meals

    for (const contentType of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x']) {
      const response = await call(method, path, { ...init, headers: { 'Content-Type': contentType } })
      expect(response.status).toBe(415)
      expect(response.body.error.type).toBe('UnsupportedMediaType')
    }
    expect((await call('GET', '/api/meals')).body.meals).toEqual(before)
  })

  it.each([
    ['POST', '/api/meals', { body: base }],
    ['PATCH', mealPath('a'), { body: { name: 'パン' } }],
    ['DELETE', mealPath('a'), {}],
    ['POST', '/api/import', { body: { records: [] } }],
    ['POST', '/api/mark-planned-as-eaten', { body: { date: '2026-11-06' } }],
  ])('書き込み（%s %s）は、Origin が他のオリジンなら 403（Forbidden）で、何も変えない', async (method, path, init) => {
    const call = createClient()
    await call('POST', '/api/import', { body: { records: [imported({ id: 'a', status: 'planned' })] } })
    const before = (await call('GET', '/api/meals')).body.meals

    for (const origin of ['https://evil.example', 'http://meal-log.example', 'null']) {
      const response = await call(method, path, { ...init, headers: { Origin: origin } })
      expect(response.status).toBe(403)
      expect(response.body.error.type).toBe('Forbidden')
    }
    expect((await call('GET', '/api/meals')).body.meals).toEqual(before)
  })

  it('書き込みは、Origin が同じオリジンか、Origin がなければ受け付ける。読み出しは Origin を見ない', async () => {
    const call = createClient()

    expect((await call('POST', '/api/meals', { body: base, headers: { Origin: TEST_ORIGIN } })).status).toBe(201)
    expect((await call('POST', '/api/meals', { body: base })).status).toBe(201)
    expect((await call('GET', '/api/meals', { headers: { Origin: 'https://evil.example' } })).status).toBe(200)
  })

  it('Content-Type に charset が付いていても受け付ける', async () => {
    const call = createClient()
    const response = await call('POST', '/api/meals', {
      body: base,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    })

    expect(response.status).toBe(201)
  })

  it('ない API は 404、対応していないメソッドは 405', async () => {
    const call = createClient()

    const notFound = await call('GET', '/api/other')
    expect(notFound.status).toBe(404)
    expect(notFound.body.error.type).toBe('RouteNotFound')
    const notAllowed = await call('PUT', mealPath('a'), { body: base })
    expect(notAllowed.status).toBe(405)
    expect(notAllowed.body.error.type).toBe('MethodNotAllowed')
    expect(notAllowed.headers.get('Allow')).toBe('GET, PATCH, DELETE')
  })

  it('応答はキャッシュさせない', async () => {
    const call = createClient()
    const response = await call('GET', '/api/meals')

    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(response.headers.get('Content-Type')).toBe('application/json; charset=utf-8')
  })
})

describe('保存先の失敗', () => {
  it('D1 が失敗すると 500（MealStorageError）', async () => {
    const call = createClient()
    // マイグレーションの確かめは、最初のリクエストで済ませておく（失敗させたいのは記録の読み書き）
    expect((await call('GET', '/api/meals')).status).toBe(200)
    // 記録の表への文だけを失敗させる（ログインの確かめは通す）
    const brokenDb = overrideDatabase(database.db, {
      prepare: (query) => database.db.prepare(query.includes('member_meals') ? 'SELECT * FROM no_such_table' : query),
    })
    vi.spyOn(console, 'error').mockImplementation(() => {})

    for (const [method, path, body] of [
      ['GET', '/api/meals', undefined],
      ['GET', mealPath('a'), undefined],
      ['POST', '/api/meals', base],
      ['PATCH', mealPath('a'), { name: 'パン' }],
      ['DELETE', mealPath('a'), undefined],
    ] as const) {
      const response = await call(method, path, { db: brokenDb, body })
      expect(response.status).toBe(500)
      expect(response.body.error.type).toBe('MealStorageError')
    }
  })
})
