import { defineConfig } from 'vitest/config'

/**
 * `VITEST_MAX_WORKERS`, a positive whole number, caps vitest's workers; `herdr/factory-slot.sh run`
 * sets it to the cores divided by the slots of the pool. Unset, vitest keeps its default.
 */
const requested = Number(process.env['VITEST_MAX_WORKERS'])
const maxWorkers = Number.isInteger(requested) && requested > 0 ? requested : undefined

export default defineConfig({
  test: {
    ...(maxWorkers === undefined ? {} : { maxWorkers }),
    include: ['test/**/*.test.ts'],
  },
})
