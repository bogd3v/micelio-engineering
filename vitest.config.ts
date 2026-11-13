import { defineConfig } from 'vitest/config'

/**
 * `VITEST_MAX_WORKERS`, a positive whole number, caps vitest's workers; `herdr/factory-slot.sh run`
 * sets it to the cores divided by the slots of the pool. Unset, vitest keeps its default.
 *
 * `test/setup/tmpdir.ts` is the `globalSetup`: each run gets a fresh `TMPDIR` under the one it was
 * started with, and fails when a test leaves an entry in it.
 */
const requested = Number(process.env['VITEST_MAX_WORKERS'])
const maxWorkers = Number.isInteger(requested) && requested > 0 ? requested : undefined

export default defineConfig({
  test: {
    ...(maxWorkers === undefined ? {} : { maxWorkers }),
    globalSetup: ['test/setup/tmpdir.ts'],
    include: ['packages/*/test/**/*.test.ts', 'test/**/*.test.ts'],
    testTimeout: 60_000,
  },
})
