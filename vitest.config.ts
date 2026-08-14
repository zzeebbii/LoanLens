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
    setupFiles: ['./vitest.setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/domain/**', 'src/rates/**', 'src/persistence/**'],
      exclude: [
        // Fixtures live inside `domain/` so the boundary check covers them, but they are
        // test scaffolding — measuring their coverage would only inflate the number.
        'src/domain/testing/**',
        'src/rates/testing/**',
        // Barrel files are re-exports with nothing to test.
        'src/rates/index.ts',
        'src/persistence/index.ts',
        'src/domain/amortization/index.ts',
      ],
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
