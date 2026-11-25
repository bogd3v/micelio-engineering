import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { tempDir } from './support/temp.js'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const KNIP = join(ROOT, 'node_modules/knip/bin/knip.js')

/**
 * A project with the `knip.json` of `template/`: `package.json` exports `src/main.ts`, which imports
 * `used` from `src/lib.ts`; `src/lib.ts` holds `lib` as its body.
 */
function project(lib: string): string {
  const dir = tempDir('lint-unused-')
  copyFileSync(join(ROOT, 'template/knip.json'), join(dir, 'knip.json'))
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({
      name: 'lint-unused-example',
      private: true,
      type: 'module',
      exports: './src/main.ts',
      devDependencies: { vitest: '*' },
    })
  )
  mkdirSync(join(dir, 'src'))
  writeFileSync(
    join(dir, 'src/main.ts'),
    "import { used } from './lib.js'\n\nexport const main = (): number => used()\n"
  )
  writeFileSync(join(dir, 'src/lib.ts'), lib)
  return dir
}

/** Runs `knip` in `dir` the way `npm run lint:unused` does. */
function lintUnused(dir: string) {
  return spawnSync(process.execPath, [KNIP, '--no-progress'], { cwd: dir, encoding: 'utf8' })
}

describe('lint:unused', () => {
  it('fails on an export that no file imports and passes when a test imports it', () => {
    const dir = project(
      'export const used = (): number => 1\n\nexport const unused = (): number => 2\n'
    )
    const failed = lintUnused(dir)
    expect(failed.status, failed.stdout + failed.stderr).toBe(1)
    expect(failed.stdout).toMatch(/Unused exports \(1\)/)
    expect(failed.stdout).toMatch(/unused\s+src\/lib\.ts/)

    mkdirSync(join(dir, 'test'))
    writeFileSync(
      join(dir, 'test/lib.test.ts'),
      "import { unused } from '../src/lib.js'\n\nexport const checked = unused()\n"
    )
    const passed = lintUnused(dir)
    expect(passed.status, passed.stdout + passed.stderr).toBe(0)
  })

  it('fails on an exported type that no file imports and exempts a declaration tagged @public', () => {
    const typed = lintUnused(
      project('export const used = (): number => 1\n\nexport interface Unused {\n  at: number\n}\n')
    )
    expect(typed.status, typed.stdout + typed.stderr).toBe(1)
    expect(typed.stdout).toMatch(/Unused exported types \(1\)/)

    const slot = lintUnused(
      project(
        'export const used = (): number => 1\n\n/**\n * A slot API.\n *\n * @public\n */\nexport const slot = (): number => 2\n'
      )
    )
    expect(slot.status, slot.stdout + slot.stderr).toBe(0)
  })

  it('this repository checks exports and types only, with the template and @public exempt', () => {
    const own = JSON.parse(readFileSync(join(ROOT, 'knip.json'), 'utf8')) as Record<string, unknown>
    const template = JSON.parse(readFileSync(join(ROOT, 'template/knip.json'), 'utf8')) as Record<
      string,
      unknown
    >
    for (const config of [own, template]) {
      expect(config['include']).toEqual(['exports', 'types'])
      expect(config['tags']).toEqual(['-public'])
    }
  })
})
