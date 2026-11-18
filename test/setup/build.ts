import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

/** The repository root, where the `build` script lives. */
const ROOT = fileURLToPath(new URL('../..', import.meta.url))

/**
 * Runs the `build` script of the `package.json` in `cwd` and throws, with the compiler's output,
 * when it fails. `npm test` builds before `vitest`; this makes `npx vitest run <file>` do the same,
 * so the tests that spawn `dist/cli.js` or run `dist/` find it on a clean copy.
 */
export function build(cwd: string): void {
  const result = spawnSync('npm', ['run', 'build'], { cwd, encoding: 'utf8' })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(
      `the build failed (exit ${String(result.status)}):\n${result.stdout}${result.stderr}`
    )
  }
}

/** The first `globalSetup`: builds the packages once, before `test/setup/tmpdir.ts` runs. */
export function setup(): void {
  build(ROOT)
}
