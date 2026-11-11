import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

// 画面のテストでは、アプリの保存の窓口を、サーバーの API ではなくブラウザ内（localStorage）の窓口に差し替える。
// テストの中で localStorage に記録を入れたり、保存データを壊したりして、画面の動きを確かめる
vi.mock('./meals/defaultMealRepository', async () => {
  const { createLocalStorageMealRepository } = await import('./meals/localStorageMealRepository')
  return { createDefaultMealRepository: () => createLocalStorageMealRepository() }
})

// ログインの窓口も、サーバーのログインの API ではなく、メモリーの中だけで動く窓口に差し替える
vi.mock('./auth/defaultAuthClient', async () => {
  const { createMemoryAuthClient } = await import('./auth/memoryAuthClient')
  return { createDefaultAuthClient: () => createMemoryAuthClient() }
})

afterEach(() => {
  cleanup()
  window.localStorage.clear()
  // 画面を移ったテストのアドレスを、次のテストに持ち越さない
  window.history.replaceState(null, '', '/')
})
