import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/domain/**', 'src/rates/**', 'src/persistence/**'],
      thresholds: {
        // The financial engine is the part that must not be wrong.
        lines: 90,
        functions: 90,
        branches: 85,
        statements: 90,
      },
    },
  },
})
