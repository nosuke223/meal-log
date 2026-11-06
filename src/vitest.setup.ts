import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

afterEach(() => {
  cleanup()
  window.localStorage.clear()
  // 画面を移ったテストのアドレスを、次のテストに持ち越さない
  window.history.replaceState(null, '', '/')
})
