import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

export const NARRATIVE_TAGS_COVERAGE_INCLUDE = [
  'client/worker-source.js',
  'components/**/*.{ts,vue}',
  'extension.config.ts',
  'server/**/*.ts'
]

export const NARRATIVE_TAGS_COVERAGE_THRESHOLDS = {
  lines: 80,
  functions: 80,
  branches: 80,
  statements: 80
} as const

export default defineConfig({
  plugins: [vue()],
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/unit/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    maxWorkers: 1,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'json-summary'],
      reportsDirectory: 'coverage/unit',
      include: NARRATIVE_TAGS_COVERAGE_INCLUDE,
      thresholds: NARRATIVE_TAGS_COVERAGE_THRESHOLDS
    }
  }
})
