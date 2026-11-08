/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { devApiPlugin } from './server/devApi.ts'

export default defineConfig({
  // devApiPlugin は開発サーバー（npm run dev）だけで、/api/ を手元の D1 につなぐ。ビルドには入らない
  plugins: [react(), devApiPlugin()],
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'app',
          environment: 'jsdom',
          setupFiles: ['./src/vitest.setup.ts'],
          include: ['src/**/*.test.{ts,tsx}'],
        },
      },
      {
        // API のテスト。手元の D1（wrangler の Miniflare）を起動するので、時間に余裕を持たせる
        test: {
          name: 'server',
          environment: 'node',
          include: ['server/**/*.test.ts'],
          testTimeout: 60_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
})
