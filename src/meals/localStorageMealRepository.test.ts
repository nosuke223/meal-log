import { beforeEach, describe, expect, it } from 'vitest'
import {
  createLocalStorageMealRepository,
  MEAL_STORAGE_KEY,
  MEAL_STORAGE_VERSION,
} from './localStorageMealRepository'
import { MealValidationError, toLocalDateString, type MealInput } from './mealRecord'
import { MealNotFoundError, MealStorageError } from './mealRepository'

/** 呼ぶたびに1秒進む時計 */
function createClock(start = '2026-11-06T00:00:00.000Z') {
  let time = Date.parse(start)
  return () => {
    const date = new Date(time)
    time += 1000
    return date
  }
}

function createRepository() {
  return createLocalStorageMealRepository({ storage: localStorage, now: createClock() })
}

const base: MealInput = {
  date: '2026-11-06',
  mealType: 'lunch',
  name: 'ご飯',
  status: 'eaten',
}

beforeEach(() => {
  localStorage.clear()
})

describe('作成・取得・更新・削除', () => {
  it('作成すると ID と日時が付き、1件取得できる', async () => {
    const repository = createRepository()
    const created = await repository.create({ ...base, genre: 'japanese', dishType: 'staple' })

    expect(created.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    expect(created).toMatchObject({
      date: '2026-11-06',
      mealType: 'lunch',
      name: 'ご飯',
      genre: 'japanese',
      dishType: 'staple',
      status: 'eaten',
      createdAt: '2026-11-06T00:00:00.000Z',
      updatedAt: '2026-11-06T00:00:00.000Z',
    })
    expect(await repository.get(created.id)).toEqual(created)
  })

  it('ジャンルと料理の分類を省略すると未設定（null）になる', async () => {
    const repository = createRepository()
    const created = await repository.create(base)

    expect(created.genre).toBeNull()
    expect(created.dishType).toBeNull()
  })

  it('品名の前後の空白は取り除いて保存する', async () => {
    const repository = createRepository()
    const created = await repository.create({ ...base, name: '  味噌汁 ' })

    expect(created.name).toBe('味噌汁')
  })

  it('記録ごとに違う ID が付く', async () => {
    const repository = createRepository()
    const a = await repository.create(base)
    const b = await repository.create(base)

    expect(a.id).not.toBe(b.id)
  })

  it('ない ID を1件取得すると null', async () => {
    const repository = createRepository()

    expect(await repository.get('missing')).toBeNull()
  })

  it('更新すると渡した項目だけ変わり、updatedAt は変わって createdAt は変わらない', async () => {
    const repository = createRepository()
    const created = await repository.create({ ...base, status: 'planned', genre: 'japanese' })
    const updated = await repository.update(created.id, { status: 'eaten', dishType: 'main' })

    expect(updated).toEqual({
      ...created,
      status: 'eaten',
      dishType: 'main',
      updatedAt: '2026-11-06T00:00:01.000Z',
    })
    expect(updated.createdAt).toBe(created.createdAt)
    expect(await repository.get(created.id)).toEqual(updated)
  })

  it('ジャンルを null にすると未設定に戻せる', async () => {
    const repository = createRepository()
    const created = await repository.create({ ...base, genre: 'chinese' })
    const updated = await repository.update(created.id, { genre: null })

    expect(updated.genre).toBeNull()
  })

  it('同じ時刻に更新しても updatedAt は前より後になる', async () => {
    const fixed = new Date('2026-11-06T00:00:00.000Z')
    const repository = createLocalStorageMealRepository({ now: () => fixed })
    const created = await repository.create(base)
    const updated = await repository.update(created.id, { name: 'パン' })

    expect(updated.updatedAt > created.updatedAt).toBe(true)
    expect(updated.createdAt).toBe(created.createdAt)
  })

  it('削除すると取得できなくなる', async () => {
    const repository = createRepository()
    const kept = await repository.create(base)
    const removed = await repository.create({ ...base, name: 'パン' })
    await repository.delete(removed.id)

    expect(await repository.get(removed.id)).toBeNull()
    expect(await repository.listByDate(base.date)).toEqual([kept])
  })
})

describe('日付指定と期間指定の取得', () => {
  it('日付を指定すると、その日の記録だけを返す', async () => {
    const repository = createRepository()
    const a = await repository.create({ ...base, date: '2026-11-05' })
    const b = await repository.create({ ...base, date: '2026-11-06' })
    await repository.create({ ...base, date: '2026-11-07' })

    expect(await repository.listByDate('2026-11-05')).toEqual([a])
    expect(await repository.listByDate('2026-11-06')).toEqual([b])
    expect(await repository.listByDate('2026-11-08')).toEqual([])
  })

  it('期間を指定すると、両端の日を含めて返す', async () => {
    const repository = createRepository()
    await repository.create({ ...base, date: '2026-10-31' })
    const first = await repository.create({ ...base, date: '2026-11-01' })
    const middle = await repository.create({ ...base, date: '2026-11-15' })
    const last = await repository.create({ ...base, date: '2026-11-30' })
    await repository.create({ ...base, date: '2026-12-01' })

    expect(await repository.listByDateRange('2026-11-01', '2026-11-30')).toEqual([first, middle, last])
  })

  it('始まりと終わりが同じ日なら、その日の記録を返す', async () => {
    const repository = createRepository()
    const a = await repository.create(base)

    expect(await repository.listByDateRange(base.date, base.date)).toEqual([a])
  })

  it('期間の始まりが終わりより後ならエラー', async () => {
    const repository = createRepository()

    await expect(repository.listByDateRange('2026-11-30', '2026-11-01')).rejects.toThrow(MealValidationError)
  })

  it('取得の日付の書式が違えばエラー', async () => {
    const repository = createRepository()

    await expect(repository.listByDate('2026/11/06')).rejects.toThrow(MealValidationError)
    await expect(repository.listByDateRange('2026-11-01', '2026-11-31')).rejects.toThrow(MealValidationError)
  })
})

describe('並び順', () => {
  it('日付 → 区分（朝・昼・夜・間食）→ 作成日時の順に並ぶ', async () => {
    const repository = createRepository()
    const snack = await repository.create({ ...base, date: '2026-11-06', mealType: 'snack', name: '1' })
    const dinner = await repository.create({ ...base, date: '2026-11-06', mealType: 'dinner', name: '2' })
    const lunchFirst = await repository.create({ ...base, date: '2026-11-06', mealType: 'lunch', name: '3' })
    const breakfast = await repository.create({ ...base, date: '2026-11-06', mealType: 'breakfast', name: '4' })
    const lunchSecond = await repository.create({ ...base, date: '2026-11-06', mealType: 'lunch', name: '5' })
    const earlierDay = await repository.create({ ...base, date: '2026-11-05', mealType: 'snack', name: '6' })

    const expected = [breakfast, lunchFirst, lunchSecond, dinner, snack]
    expect(await repository.listByDate('2026-11-06')).toEqual(expected)
    expect(await repository.listByDateRange('2026-11-05', '2026-11-06')).toEqual([earlierDay, ...expected])
  })

  it('更新しても作成日時の順は変わらない', async () => {
    const repository = createRepository()
    const first = await repository.create(base)
    const second = await repository.create(base)
    const updatedFirst = await repository.update(first.id, { name: '変更' })

    expect(await repository.listByDate(base.date)).toEqual([updatedFirst, second])
  })
})

describe('不正な値', () => {
  const invalidInputs: [string, Record<string, unknown>][] = [
    ['品名が空', { name: '' }],
    ['品名が空白だけ', { name: ' 　\t' }],
    ['品名が文字列でない', { name: 1 }],
    ['日付の書式が違う', { date: '2026/11/06' }],
    ['日付の桁が足りない', { date: '2026-1-6' }],
    ['実在しない日付', { date: '2026-02-29' }],
    ['区分が決まった値でない', { mealType: 'brunch' }],
    ['ジャンルが決まった値でない', { genre: 'korean' }],
    ['料理の分類が決まった値でない', { dishType: 'dessert' }],
    ['状態が決まった値でない', { status: 'skipped' }],
  ]

  it.each(invalidInputs)('作成: %s ならエラーで、保存されない', async (_, override) => {
    const repository = createRepository()

    await expect(repository.create({ ...base, ...override } as MealInput)).rejects.toThrow(MealValidationError)
    expect(localStorage.getItem(MEAL_STORAGE_KEY)).toBeNull()
  })

  it.each(invalidInputs)('更新: %s ならエラーで、記録は変わらない', async (_, override) => {
    const repository = createRepository()
    const created = await repository.create(base)

    await expect(repository.update(created.id, override as Partial<MealInput>)).rejects.toThrow(MealValidationError)
    expect(await repository.get(created.id)).toEqual(created)
  })
})

describe('存在しない ID', () => {
  it('更新するとエラー', async () => {
    const repository = createRepository()

    await expect(repository.update('missing', { name: 'パン' })).rejects.toThrow(MealNotFoundError)
  })

  it('削除するとエラー', async () => {
    const repository = createRepository()
    await repository.create(base)

    await expect(repository.delete('missing')).rejects.toThrow(MealNotFoundError)
    expect(await repository.listByDate(base.date)).toHaveLength(1)
  })
})

describe('壊れた保存データ', () => {
  const validRecord = {
    id: 'a',
    date: '2026-11-06',
    mealType: 'lunch',
    name: 'ご飯',
    genre: null,
    dishType: null,
    status: 'eaten',
    createdAt: '2026-11-06T00:00:00.000Z',
    updatedAt: '2026-11-06T00:00:00.000Z',
  }
  const store = (data: unknown) => JSON.stringify(data)

  const brokenData: [string, string][] = [
    ['JSON として読めない', '{not json'],
    ['オブジェクトでない', store([validRecord])],
    ['バージョンがない', store({ records: [validRecord] })],
    ['知らないバージョン', store({ version: MEAL_STORAGE_VERSION + 1, records: [validRecord] })],
    ['記録の一覧がない', store({ version: MEAL_STORAGE_VERSION })],
    ['記録がオブジェクトでない', store({ version: MEAL_STORAGE_VERSION, records: ['a'] })],
    ['ID がない', store({ version: MEAL_STORAGE_VERSION, records: [{ ...validRecord, id: undefined }] })],
    ['ID が重なっている', store({ version: MEAL_STORAGE_VERSION, records: [validRecord, validRecord] })],
    ['区分が不正', store({ version: MEAL_STORAGE_VERSION, records: [{ ...validRecord, mealType: 'x' }] })],
    ['ジャンルの項目がない', store({ version: MEAL_STORAGE_VERSION, records: [{ ...validRecord, genre: undefined }] })],
    ['日時が不正', store({ version: MEAL_STORAGE_VERSION, records: [{ ...validRecord, createdAt: 'x' }] })],
  ]

  it.each(brokenData)('%s なら、取得・作成・更新・削除がエラーになり、保存データは上書きされない', async (_, raw) => {
    localStorage.setItem(MEAL_STORAGE_KEY, raw)
    const repository = createRepository()

    await expect(repository.listByDate(base.date)).rejects.toThrow(MealStorageError)
    await expect(repository.listByDateRange(base.date, base.date)).rejects.toThrow(MealStorageError)
    await expect(repository.get('a')).rejects.toThrow(MealStorageError)
    await expect(repository.create(base)).rejects.toThrow(MealStorageError)
    await expect(repository.update('a', { name: 'パン' })).rejects.toThrow(MealStorageError)
    await expect(repository.delete('a')).rejects.toThrow(MealStorageError)
    expect(localStorage.getItem(MEAL_STORAGE_KEY)).toBe(raw)
  })

  it('正しい保存データは読める', async () => {
    localStorage.setItem(MEAL_STORAGE_KEY, store({ version: MEAL_STORAGE_VERSION, records: [validRecord] }))
    const repository = createRepository()

    expect(await repository.get('a')).toEqual(validRecord)
  })
})

describe('保存の永続化', () => {
  it('窓口を作り直しても、保存した記録が残っている', async () => {
    const first = createRepository()
    const kept = await first.create({ ...base, genre: 'western' })
    const updated = await first.update(kept.id, { status: 'planned' })
    const removed = await first.create({ ...base, name: 'パン' })
    await first.delete(removed.id)

    const reloaded = createRepository()

    expect(await reloaded.get(kept.id)).toEqual(updated)
    expect(await reloaded.get(removed.id)).toBeNull()
    expect(await reloaded.listByDate(base.date)).toEqual([updated])
  })

  it('保存データにバージョン番号が付いている', async () => {
    const repository = createRepository()
    await repository.create(base)

    const data = JSON.parse(localStorage.getItem(MEAL_STORAGE_KEY) ?? 'null')
    expect(data.version).toBe(MEAL_STORAGE_VERSION)
    expect(data.records).toHaveLength(1)
  })
})

describe('toLocalDateString', () => {
  it('端末の現地の日付を YYYY-MM-DD にする', () => {
    expect(toLocalDateString(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05')
    expect(toLocalDateString(new Date(2026, 10, 6, 0, 0))).toBe('2026-11-06')
  })
})
