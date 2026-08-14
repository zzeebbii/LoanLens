import { fileURLToPath, URL } from 'node:url'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

/**
 * `base` must match the GitHub Pages project path so that asset URLs resolve on
 * https://<user>.github.io/LoanLens/. It is overridable via BASE_PATH so the same
 * config serves local dev, Docker (served at /) and Pages.
 */
const base = process.env['BASE_PATH'] ?? '/'

export default defineConfig({
  base,
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
})
