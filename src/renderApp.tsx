// 画面のテスト用（アプリでは使わない）
import { act, render } from '@testing-library/react'
import type { ReactElement } from 'react'

/**
 * アプリを描画し、ログインの状態を確かめ終えるまで待つ（記録の画面は、確かめてから出る）。
 * ログインの窓口がメモリーの窓口（すぐに答える）のときに使う
 */
export async function renderApp(ui: ReactElement) {
  const result = render(ui)
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)))
  return result
}
