import { defineConfig } from 'vitest/config'

/**
 * `VITEST_MAX_WORKERS`, a positive whole number, caps vitest's workers; `herdr/factory-slot.sh run`
 * sets it to the cores divided by the slots of the pool. Unset, vitest keeps its default.
 *
 * Two `globalSetup`s, in this order: `test/setup/build.ts` runs the root `build` script once (a no-op
 * after `npm run build`, since `tsc -b` is incremental) and fails the run with the compiler's output
 * when it fails, so a targeted `npx vitest run <file>` finds `dist/` on a clean copy;
 * `test/setup/tmpdir.ts` gives each run a fresh `TMPDIR` under the one it was started with, and
 * fails when a test leaves an entry in it.
 */
const requested = Number(process.env['VITEST_MAX_WORKERS'])
const maxWorkers = Number.isInteger(requested) && requested > 0 ? requested : undefined

export default defineConfig({
  test: {
    ...(maxWorkers === undefined ? {} : { maxWorkers }),
    globalSetup: ['test/setup/build.ts', 'test/setup/tmpdir.ts'],
    include: ['packages/*/test/**/*.test.ts', 'test/**/*.test.ts'],
    testTimeout: 60_000,
  },
})
