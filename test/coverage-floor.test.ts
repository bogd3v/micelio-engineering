import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = fileURLToPath(new URL('../', import.meta.url))

/**
 * The coverage of `npm run test:coverage` measured on `main` at 5455bbf, two runs with the same
 * totals, posted in the Progress of issue #445 before the floor was written. The floor of
 * `vitest.config.ts` is these values rounded down; a raise of the floor measures again and updates
 * them in the same pull request.
 */
const MEASURED = { lines: 95.38, branches: 84.66 }

/** The floor of a new repository, which has no history to measure. */
const TEMPLATE_FLOOR = 80

interface Thresholds {
  lines?: unknown
  branches?: unknown
}

/** The `coverage.thresholds` of a vitest configuration. */
async function thresholdsOf(path: string): Promise<Thresholds> {
  const module = (await import(/* @vite-ignore */ path)) as {
    default: { test?: { coverage?: { thresholds?: Thresholds } } }
  }
  return module.default.test?.coverage?.thresholds ?? {}
}

/** The scripts of a `package.json` below the root. */
function scriptsOf(path: string): Record<string, string> {
  const pkg = JSON.parse(readFileSync(join(ROOT, path), 'utf8')) as {
    scripts: Record<string, string>
  }
  return pkg.scripts
}

describe('the coverage floor', () => {
  it('the floor of vitest.config.ts is a whole number no higher than the measured coverage', async () => {
    const thresholds = await thresholdsOf('../vitest.config.ts')
    for (const key of ['lines', 'branches'] as const) {
      const floor = thresholds[key]
      expect(Number.isInteger(floor), `${key}: ${String(floor)}`).toBe(true)
      expect(floor as number, key).toBeLessThanOrEqual(MEASURED[key])
      // Never set below the measured value to leave room: the measured value rounded down.
      expect(floor, key).toBe(Math.floor(MEASURED[key]))
    }
  })

  it('the floor of template/vitest.config.ts is 80 for lines and branches', async () => {
    const thresholds = await thresholdsOf('../template/vitest.config.ts')
    expect(thresholds.lines).toBe(TEMPLATE_FLOOR)
    expect(thresholds.branches).toBe(TEMPLATE_FLOOR)
  })

  it('check runs test:coverage in place of test, here and in the template', () => {
    for (const path of ['package.json', 'template/package.json']) {
      const scripts = scriptsOf(path)
      expect(scripts['test:coverage'], path).toMatch(/\bvitest run --coverage$/)
      const steps = (scripts['check'] ?? '').split(' && ')
      expect(steps, path).toContain('npm run test:coverage')
      expect(steps, path).not.toContain('npm run test')
    }
  })

  it('the template installs @vitest/coverage-v8 at the version of vitest', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'template/package.json'), 'utf8')) as {
      devDependencies: Record<string, string>
    }
    expect(pkg.devDependencies['@vitest/coverage-v8']).toBe(pkg.devDependencies['vitest'])
  })

  it('ci.yml runs the tests of check.yml with test:coverage', () => {
    const ci = readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8')
    const job = ci.split('\n  check:\n')[1]?.split(/\n {2}[a-z-]+:\n/)[0] ?? ''
    expect(job).toContain('uses: ./.github/workflows/check.yml')
    expect(job).toMatch(/^ {6}test-script: test:coverage$/m)
  })
})
