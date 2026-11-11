import { createApiAuthClient } from './apiAuthClient'
import type { AuthClient } from './authClient'

/**
 * アプリが使うログインの窓口（サーバーのログインの API）を作る。
 * 画面のテストでは、このモジュールを差し替えて、メモリーの中だけで動く窓口を使う（src/vitest.setup.ts）
 */
export function createDefaultAuthClient(): AuthClient {
  return createApiAuthClient()
}
