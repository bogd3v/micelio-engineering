import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll } from 'vitest'

/** The directories `tempDir` made in this test file and has not removed yet. */
const made: string[] = []

/**
 * Makes a directory under the `TMPDIR` of the process (the run's own, see `test/setup/tmpdir.ts`)
 * and answers its path. The test file removes it, with what it holds, when its last test ends.
 */
export function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  made.push(dir)
  return dir
}

/** Removes one directory `tempDir` made (a test that wants it gone earlier) and forgets it. */
export function removeTemp(dir: string): void {
  rmSync(dir, { recursive: true, force: true })
  const at = made.indexOf(dir)
  if (at >= 0) made.splice(at, 1)
}

afterAll(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true })
})
