import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import config from '../vitest.config.js'
import { setup, teardown } from './setup/tmpdir.js'

describe('the TMPDIR of a run (test/setup/tmpdir.ts)', () => {
  const started = process.env['TMPDIR']
  afterEach(() => {
    if (started === undefined) delete process.env['TMPDIR']
    else process.env['TMPDIR'] = started
  })

  it('is named by vitest.config.ts as a globalSetup', () => {
    expect(config.test?.globalSetup).toEqual(['test/setup/tmpdir.ts'])
  })

  it('a run that leaves an entry in TMPDIR fails and names the entry', () => {
    setup()
    const run = process.env['TMPDIR'] ?? ''
    expect(run).not.toBe(started)
    mkdirSync(join(run, 'micelio-leaked-one'))
    writeFileSync(join(run, 'leaked-file'), '')
    expect(() => {
      teardown()
    }).toThrow(/2 entries in TMPDIR: .*micelio-leaked-one/)
    expect(() => {
      setup()
      writeFileSync(join(process.env['TMPDIR'] ?? '', 'leaked-file'), '')
      teardown()
    }).toThrow(/1 entry in TMPDIR: leaked-file/)
    // The directory goes even when the run fails, and TMPDIR is the one the run started with.
    expect(existsSync(run)).toBe(false)
    expect(process.env['TMPDIR']).toBe(started)
  })

  it('a run that leaves nothing passes, and Node’s compile cache is not a leak', () => {
    setup()
    const run = process.env['TMPDIR'] ?? ''
    mkdirSync(join(run, 'node-compile-cache'))
    expect(() => {
      teardown()
    }).not.toThrow()
    expect(existsSync(run)).toBe(false)
  })
})
