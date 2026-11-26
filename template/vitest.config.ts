import { defineConfig } from 'vitest/config'

/**
 * `VITEST_MAX_WORKERS`, a positive whole number, caps vitest's workers; `herdr/factory-slot.sh run`
 * sets it to the cores divided by the slots of the pool. Unset, vitest keeps its default.
 *
 * `npm run test:coverage` measures coverage with v8 and fails below the floor in `thresholds`, 80
 * for lines and branches in a new repository. A floor is raised as coverage grows and never lowered
 * (section 8 of the standard).
 */
const requested = Number(process.env['VITEST_MAX_WORKERS'])
const maxWorkers = Number.isInteger(requested) && requested > 0 ? requested : undefined

export default defineConfig({
  test: {
    ...(maxWorkers === undefined ? {} : { maxWorkers }),
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary'],
      thresholds: { lines: 80, branches: 80 },
    },
  },
})
