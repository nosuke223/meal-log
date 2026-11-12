import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createApiMealRepository, LOGIN_EXPIRED_MESSAGE } from '../src/meals/apiMealRepository'
import { MealValidationError, type MealRecord } from '../src/meals/mealRecord'
import { LoginExpiredError, MealNotFoundError, type MealRepository } from '../src/meals/mealRepository'
import { createApiHandler } from './api'
import { createMemoryTransport } from './mail/mailer'
import { startTestDatabase, type TestDatabase } from './testDatabase'
import { createTestMember, signInTestMember, testEnv, type TestMember } from './testMember'

// 画面が使う窓口のサーバー版（src/meals/apiMealRepository.ts）を、実際の API（server/api.ts）と手元の D1 につないで確かめる

let database: TestDatabase

beforeAll(async () => {
  database = await startTestDatabase()
})

afterAll(async () => {
  await database?.dispose()
})

beforeEach(async () => {
  await database.reset()
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

const authHandle = createApiHandler({ mailTransport: createMemoryTransport() })

/** 会員登録してログインする */
function signUp(email: string): Promise<TestMember> {
  return createTestMember(authHandle, database.db, email)
}

/**
 * API の処理を直接呼ぶ fetch で、この会員の窓口を作る（ブラウザと同じく、ログインの cookie を付けて呼ぶ）
 */
function repositoryAs(member: TestMember, handle = createApiHandler({ now: createClock() })): MealRepository {
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const headers = new Headers(init?.headers)
    headers.set('Cookie', member.cookie)
    return handle(new Request(new URL(String(input), 'https://meal-log.example'), { ...init, headers }), testEnv(database.db))
  }
  return createApiMealRepository({ fetch })
}

const IMPORTED: MealRecord = {
  id: 'imported/../.',
  date: '2026-11-05',
  mealType: 'dinner',
  name: 'カレー',
  genre: 'other',
  dishType: 'main',
  status: 'planned',
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
}

describe('サーバー版の窓口', () => {
  it('作成した記録を、日ごと・期間・すべて・1件で取得できる', async () => {
    const repository = repositoryAs(await signUp('alice@example.com'))
    const lunch = await repository.create({ date: '2026-11-06', mealType: 'lunch', name: ' うどん ', genre: 'japanese', status: 'eaten' })
    const breakfast = await repository.create({ date: '2026-11-06', mealType: 'breakfast', name: 'パン', status: 'planned' })
    const other = await repository.create({ date: '2026-11-20', mealType: 'dinner', name: '鍋', status: 'planned' })

    expect(lunch).toMatchObject({ name: 'うどん', genre: 'japanese', dishType: null, status: 'eaten' })
    expect(await repository.listByDate('2026-11-06')).toEqual([breakfast, lunch])
    expect(await repository.listByDateRange('2026-11-01', '2026-11-30')).toEqual([breakfast, lunch, other])
    expect(await repository.listAll()).toEqual([breakfast, lunch, other])
    expect(await repository.get(lunch.id)).toEqual(lunch)
    expect(await repository.get('none')).toBeNull()
  })

  it('更新・削除でき、ない ID では MealNotFoundError', async () => {
    const repository = repositoryAs(await signUp('alice@example.com'))
    const created = await repository.create({ date: '2026-11-06', mealType: 'lunch', name: 'うどん', genre: 'japanese', status: 'planned' })

    const updated = await repository.update(created.id, { name: 'そば', genre: null, status: 'eaten' })
    expect(updated).toMatchObject({ id: created.id, name: 'そば', genre: null, status: 'eaten', createdAt: created.createdAt })
    expect(updated.updatedAt > created.updatedAt).toBe(true)
    expect(await repository.get(created.id)).toEqual(updated)

    await repository.delete(created.id)
    expect(await repository.listAll()).toEqual([])
    await expect(repository.update(created.id, { name: 'x' })).rejects.toThrow(new MealNotFoundError(created.id))
    await expect(repository.delete(created.id)).rejects.toBeInstanceOf(MealNotFoundError)
  })

  it('不正な値は MealValidationError で、何も保存しない', async () => {
    const repository = repositoryAs(await signUp('alice@example.com'))
    await expect(repository.create({ date: '2026-11-06', mealType: 'lunch', name: '  ', status: 'eaten' })).rejects.toBeInstanceOf(
      MealValidationError,
    )
    await expect(repository.listByDate('2026-02-30')).rejects.toBeInstanceOf(MealValidationError)
    await expect(repository.importRecords([IMPORTED, { ...IMPORTED, id: 'b', mealType: 'brunch' as never }])).rejects.toBeInstanceOf(
      MealValidationError,
    )
    expect(await repository.listAll()).toEqual([])
  })

  it('渡した日より前の日の予定を「食べた」にする', async () => {
    const repository = repositoryAs(await signUp('alice@example.com'))
    const past = await repository.create({ date: '2026-11-05', mealType: 'dinner', name: '焼き魚', status: 'planned' })
    const today = await repository.create({ date: '2026-11-06', mealType: 'dinner', name: '鍋', status: 'planned' })

    const updated = await repository.markPlannedAsEatenBefore('2026-11-06')
    expect(updated).toHaveLength(1)
    expect(updated[0]).toMatchObject({ id: past.id, status: 'eaten' })
    expect(await repository.get(today.id)).toEqual(today)
    expect(await repository.markPlannedAsEatenBefore('2026-11-06')).toEqual([])
  })

  it('書き出した記録を、ID と日時を保ったまま取り込める（「.」などを含む ID も扱える）', async () => {
    const repository = repositoryAs(await signUp('alice@example.com'))
    await repository.importRecords([IMPORTED])
    expect(await repository.listAll()).toEqual([IMPORTED])
    expect(await repository.get(IMPORTED.id)).toEqual(IMPORTED)

    const updated = await repository.update(IMPORTED.id, { name: 'ハヤシライス' })
    expect(updated.name).toBe('ハヤシライス')
    await repository.delete(IMPORTED.id)
    expect(await repository.get(IMPORTED.id)).toBeNull()
  })

  it('同じ会員なら、別の窓口（別のブラウザでログイン）でも同じ記録が見え、別の会員には見えない', async () => {
    const alice = await signUp('alice@example.com')
    const bob = await signUp('bob@example.com')
    const created = await repositoryAs(alice).create({ date: '2026-11-06', mealType: 'lunch', name: 'うどん', status: 'eaten' })
    const otherBrowser = await signInTestMember(authHandle, database.db, 'Alice@Example.com')
    expect(await repositoryAs(otherBrowser).listAll()).toEqual([created])
    expect(await repositoryAs(bob).listAll()).toEqual([])
  })

  it('書き出した記録を、別の会員のアカウントで読み込める（書き出しのファイルの記録の形のまま）', async () => {
    const alice = repositoryAs(await signUp('alice@example.com'))
    const bob = repositoryAs(await signUp('bob@example.com'))
    await alice.importRecords([IMPORTED])
    const created = await alice.create({ date: '2026-11-06', mealType: 'lunch', name: 'うどん', status: 'eaten' })

    const exported = await alice.listAll()
    await bob.importRecords(exported)
    expect(await bob.listAll()).toEqual(exported)
    // 読み込んだ側で変えても、書き出した側の記録は変わらない
    await bob.delete(created.id)
    expect(await alice.listAll()).toEqual(exported)
  })

  it('ログインの期限が切れたとき（401）は、ログインし直しを促す LoginExpiredError', async () => {
    const repository = repositoryAs({ id: 'none', email: 'none@example.com', cookie: 'better-auth.session_token=broken' })
    await expect(repository.listAll()).rejects.toBeInstanceOf(LoginExpiredError)
    await expect(repository.listAll()).rejects.toThrow(LOGIN_EXPIRED_MESSAGE)
  })
})
