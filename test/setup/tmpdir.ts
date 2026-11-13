import { mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** What the teardown does not count as a leak: Node's own cache of compiled modules. */
const IGNORED = new Set(['node-compile-cache'])

/** The directory this run gives to `TMPDIR`, and the one it was started with. */
let run = ''
let started: string | undefined

/**
 * Gives the run a fresh `TMPDIR` under the one it was started with, so that every directory a test
 * or a script makes lands there and nowhere else. The workers inherit it.
 */
export function setup(): void {
  started = process.env['TMPDIR']
  const parent = tmpdir()
  mkdirSync(parent, { recursive: true })
  run = mkdtempSync(join(parent, 'micelio-run-'))
  process.env['TMPDIR'] = run
}

/**
 * Lists what the tests left in the run's `TMPDIR`, removes the directory, and fails the run naming
 * every entry left. `node-compile-cache` is ignored: Node makes it, not a test.
 */
export function teardown(): void {
  const left = readdirSync(run).filter((name) => !IGNORED.has(name))
  rmSync(run, { recursive: true, force: true })
  if (started === undefined) delete process.env['TMPDIR']
  else process.env['TMPDIR'] = started
  if (left.length > 0) {
    throw new Error(
      `the tests left ${String(left.length)} ${left.length === 1 ? 'entry' : 'entries'} in TMPDIR: ${left.join(', ')}`
    )
  }
}
