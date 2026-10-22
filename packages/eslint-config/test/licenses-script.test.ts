import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SCRIPT = fileURLToPath(new URL('../../../scripts/check-licenses.mjs', import.meta.url))

interface Entry {
  license?: string | string[] | { type: string }
  dev?: boolean
  link?: boolean
}

/** Runs `lint:licenses` on a lockfile made of `packages` and answers its exit code and output. */
function run(packages: Record<string, Entry>): { code: number | null; output: string } {
  const dir = mkdtempSync(`${tmpdir()}/micelio-licenses-`)
  const lock = `${dir}/package-lock.json`
  const entries = Object.fromEntries(
    Object.entries(packages).map(([name, entry]) => [
      `node_modules/${name}`,
      { version: '1.0.0', ...entry },
    ])
  )
  writeFileSync(lock, JSON.stringify({ lockfileVersion: 3, packages: { '': {}, ...entries } }))
  const result = spawnSync('node', [SCRIPT, '--lock', lock], { encoding: 'utf8' })
  return { code: result.status, output: result.stdout + result.stderr }
}

describe('lint:licenses against the shipped allowlist', () => {
  it('passes on the real lockfile of this repository', () => {
    const result = spawnSync('node', [SCRIPT], { encoding: 'utf8' })
    expect(result.status, result.stderr).toBe(0)
  })

  it('accepts allowed licences and SPDX expressions', () => {
    const { code } = run({
      a: { license: 'MIT' },
      b: { license: '(MIT OR GPL-2.0-only)' },
      c: { license: 'Apache-2.0 AND ISC' },
      d: { license: 'GPL-3.0-or-later WITH Classpath-exception-2.0' },
      e: { license: 'GPL-2.0-or-later' },
      f: { license: 'MIT-0' },
    })
    expect(code).toBe(0)
  })

  it('fails a production dependency with a licence that is not allowed', () => {
    const { code, output } = run({ bad: { license: 'GPL-2.0-only' } })
    expect(code).toBe(1)
    expect(output).toContain('error: bad@1.0.0 (GPL-2.0-only)')
  })

  it('fails EPL-2.0, a missing licence and a malformed expression', () => {
    expect(run({ x: { license: 'EPL-2.0' } }).code).toBe(1)
    expect(run({ x: {} }).code).toBe(1)
    expect(run({ x: { license: '(MIT OR' } }).code).toBe(1)
    expect(run({ x: { license: 'MIT AND GPL-2.0-only' } }).code).toBe(1)
  })

  it('only warns about a dev dependency', () => {
    const { code, output } = run({ tool: { license: 'EPL-2.0', dev: true } })
    expect(code).toBe(0)
    expect(output).toContain('warn: tool@1.0.0 (EPL-2.0) [dev]')
  })

  it('ignores workspace links', () => {
    expect(run({ '@micelio/x': { link: true } }).code).toBe(0)
  })
})
