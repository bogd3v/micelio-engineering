import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import config from '../vitest.config.js'
import { build } from './setup/build.js'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

describe('the build of a run (test/setup/build.ts)', () => {
  it('the global setup runs the build before the tmpdir setup', () => {
    expect(config.test?.globalSetup).toEqual(['test/setup/build.ts', 'test/setup/tmpdir.ts'])
  })

  it('a build that fails fails the run with the compiler output', () => {
    const dir = mkdtempSync(join(tmpdir(), 'micelio-build-'))
    try {
      writeFileSync(
        join(dir, 'package.json'),
        JSON.stringify({ scripts: { build: 'echo error TS2322: not assignable; exit 2' } })
      )
      expect(() => {
        build(dir)
      }).toThrow(/the build failed \(exit 2\):[\s\S]*error TS2322: not assignable/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('a build that passes returns', () => {
    const dir = mkdtempSync(join(tmpdir(), 'micelio-build-'))
    try {
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts: { build: 'true' } }))
      expect(() => {
        build(dir)
      }).not.toThrow()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('setup() builds the packages at the repository root', async () => {
    const spawnSync = vi.fn(() => ({ status: 0, stdout: '', stderr: '' }))
    vi.resetModules()
    vi.doMock('node:child_process', () => ({ spawnSync }))
    try {
      const fresh = await import('./setup/build.js')
      fresh.setup()
      expect(spawnSync).toHaveBeenCalledTimes(1)
      expect(spawnSync).toHaveBeenCalledWith(
        'npm',
        ['run', 'build'],
        expect.objectContaining({ cwd: ROOT })
      )
    } finally {
      vi.doUnmock('node:child_process')
      vi.resetModules()
    }
  })
})
