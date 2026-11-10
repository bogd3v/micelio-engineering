import { afterEach, describe, expect, it, vi } from 'vitest'

const CONFIGS = ['../vitest.config.ts', '../template/vitest.config.ts']

/** Loads a config fresh, with `VITEST_MAX_WORKERS` as given (`undefined` unsets it). */
async function load(path: string, value: string | undefined) {
  vi.resetModules()
  if (value === undefined) delete process.env['VITEST_MAX_WORKERS']
  else process.env['VITEST_MAX_WORKERS'] = value
  const module = (await import(/* @vite-ignore */ path)) as {
    default: { test?: { maxWorkers?: unknown } }
  }
  return module.default.test?.maxWorkers
}

describe('the vitest configurations', () => {
  const saved = process.env['VITEST_MAX_WORKERS']
  afterEach(() => {
    if (saved === undefined) delete process.env['VITEST_MAX_WORKERS']
    else process.env['VITEST_MAX_WORKERS'] = saved
  })

  it('maxWorkers follows VITEST_MAX_WORKERS', async () => {
    for (const path of CONFIGS) {
      expect(await load(path, '10'), path).toBe(10)
      expect(await load(path, '1'), path).toBe(1)
      // Unset or not a positive whole number: vitest's default stays.
      for (const bad of [undefined, '', '0', '-2', '2.5', 'many']) {
        expect(await load(path, bad), `${path} with ${String(bad)}`).toBeUndefined()
      }
    }
  })
})
