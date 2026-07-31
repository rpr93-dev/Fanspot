import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    // Playwright owns *.e2e.test.ts; vitest was collecting them and failing on
    // test.describe() from the wrong runner.
    exclude: ['**/node_modules/**', '**/dist/**', '**/.next/**', '**/*.e2e.test.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
})
