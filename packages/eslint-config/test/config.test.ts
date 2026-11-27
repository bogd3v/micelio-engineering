import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ESLint } from 'eslint'
import type { Linter } from 'eslint'
import { describe, expect, it } from 'vitest'
import micelio, { promiseChainRestriction } from '../src/index.js'

const FIXTURE = fileURLToPath(new URL('../../../fixtures/basic/', import.meta.url))

const TSCONFIG = fileURLToPath(new URL('../../tsconfig/tsconfig.json', import.meta.url))
const TYPES = fileURLToPath(new URL('../../../node_modules/@types', import.meta.url))

/**
 * Lints `code` as `src/<name>` of a project under `TMPDIR` that extends `@micelio/tsconfig`, with
 * this package's config, and returns the messages reported. The file is written to disk because the
 * typed rules read it through its `tsconfig.json`.
 */
async function messagesFor(code: string, name = 'sample.ts'): Promise<Linter.LintMessage[]> {
  const dir = await mkdtemp(join(tmpdir(), 'eslint-config-'))
  try {
    const tsconfig = {
      extends: TSCONFIG,
      compilerOptions: { typeRoots: [TYPES] },
      include: ['src'],
    }
    await writeFile(join(dir, 'tsconfig.json'), JSON.stringify(tsconfig))
    const filePath = join(dir, 'src', name)
    await mkdir(dirname(filePath), { recursive: true })
    await writeFile(filePath, code)
    const eslint = new ESLint({ cwd: dir, overrideConfigFile: true, overrideConfig: micelio })
    const [result] = await eslint.lintText(code, { filePath })
    return result?.messages ?? []
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/** Lints `code` as if it were `src/<name>` of the fixture and returns the rule ids reported. */
async function ruleIdsFor(code: string, name = 'sample.ts'): Promise<string[]> {
  return (await messagesFor(code, name)).map((message) => message.ruleId ?? 'parse-error')
}

describe('@micelio/eslint-config against the fixture', () => {
  it('reports nothing on the fixture project', async () => {
    const eslint = new ESLint({ cwd: FIXTURE })
    const results = await eslint.lintFiles(['.'])
    const messages = results.flatMap((result) => result.messages)
    expect(results.length).toBeGreaterThan(0)
    expect(messages).toEqual([])
  })

  it('requires a doc comment on a public export', async () => {
    expect(
      await ruleIdsFor('export function add(a: number, b: number): number {\n  return a + b;\n}\n')
    ).toContain('jsdoc/require-jsdoc')
    expect(await ruleIdsFor('export interface Box {\n  size: number;\n}\n')).toContain(
      'jsdoc/require-jsdoc'
    )
    expect(await ruleIdsFor('export const LIMIT = 3;\n')).toContain('jsdoc/require-jsdoc')
  })

  it('does not require a doc comment on private code, tests or declarations', async () => {
    expect(
      await ruleIdsFor(
        'function add(a: number, b: number): number {\n  return a + b;\n}\nadd(1, 2);\n'
      )
    ).toEqual([])
    expect(await ruleIdsFor('export const LIMIT = 3;\n', 'limit.test.ts')).toEqual([])
    expect(await ruleIdsFor('export declare const LIMIT: number;\n', 'limit.d.ts')).toEqual([])
  })

  it('rejects a doc comment with invalid TSDoc', async () => {
    expect(await ruleIdsFor('/** The limit. @foo */\nexport const LIMIT = 3;\n')).toContain(
      'tsdoc/syntax'
    )
  })

  it('bans promise chains', async () => {
    const code = 'export {};\nfetch("https://example.test").then((response) => response.ok);\n'
    expect(await ruleIdsFor(code)).toContain('no-restricted-syntax')
  })

  it('bans any', async () => {
    expect(
      await ruleIdsFor(
        '/** Echoes a value. */\nexport function echo(value: any): unknown {\n  return value;\n}\n'
      )
    ).toContain('@typescript-eslint/no-explicit-any')
  })

  it('leaves formatting to Prettier', async () => {
    expect(await ruleIdsFor('const a = "double"\nconsole.warn(a)\nexport {}\n')).toEqual([])
  })

  it('bans console.log but allows warn and error', async () => {
    expect(await ruleIdsFor('console.log("x");\nexport {};\n')).toContain('no-console')
    expect(await ruleIdsFor('console.warn("x");\nconsole.error("y");\nexport {};\n')).toEqual([])
  })

  it('allows console.log in scripts', async () => {
    expect(await ruleIdsFor('console.log("x");\n', '../scripts/run.mjs')).toEqual([])
  })

  it('requires types at the module boundary', async () => {
    const ids = await ruleIdsFor(
      '/** Adds. */\nexport function add(a: number, b: number) {\n  return a + b;\n}\n'
    )
    expect(ids).toContain('@typescript-eslint/explicit-module-boundary-types')
  })

  it('reports a promise that is neither awaited nor returned', async () => {
    const load = 'async function load(): Promise<number> {\n  return 1;\n}\n'
    expect(await ruleIdsFor(`${load}load();\nexport {};\n`)).toContain(
      '@typescript-eslint/no-floating-promises'
    )
    expect(
      await ruleIdsFor(
        `${load}export async function run(): Promise<number> {\n  return await load();\n}\n`,
        'run.test.ts'
      )
    ).toEqual([])
  })

  it('reports an assertion that narrows, outside tests only', async () => {
    const code =
      'const value: unknown = JSON.parse("1");\nexport const size = (value as string).length;\n'
    expect(await ruleIdsFor(`/** The size. */\n${code}`)).toContain(
      '@typescript-eslint/no-unsafe-type-assertion'
    )
    expect(await ruleIdsFor(code, 'size.test.ts')).toEqual([])
  })

  it('reports a non-null assertion outside tests only', async () => {
    const code = 'const list = [1];\nexport const first = list[0]!;\n'
    expect(await ruleIdsFor(`/** The first. */\n${code}`)).toContain(
      '@typescript-eslint/no-non-null-assertion'
    )
    expect(await ruleIdsFor(code, 'first.test.ts')).toEqual([])
  })

  it('reports a default in a switch that already names every member of a union, and not one over a string', async () => {
    const rank = (type: string): string =>
      `/** The rank. */\nexport function rank(side: ${type}): number {\n  switch (side) {\n    case 'left':\n      return 1;\n    case 'right':\n      return 2;\n    default:\n      return 0;\n  }\n}\n`
    expect(await ruleIdsFor(rank("'left' | 'right'"))).toEqual([
      '@typescript-eslint/switch-exhaustiveness-check',
    ])
    expect(await ruleIdsFor(rank('string'))).toEqual([])
  })

  it('reports a disable without a rule or without a reason', async () => {
    expect(
      await ruleIdsFor('// eslint-disable-next-line\nconsole.log("x");\nexport {};\n')
    ).toContain('@eslint-community/eslint-comments/no-unlimited-disable')
    expect(
      await ruleIdsFor('// eslint-disable-next-line no-console\nconsole.log("x");\nexport {};\n')
    ).toContain('@eslint-community/eslint-comments/require-description')
    expect(
      await ruleIdsFor(
        '// eslint-disable-next-line no-console -- the fixture prints\nconsole.log("x");\nexport {};\n'
      )
    ).toEqual([])
  })

  it('reports a disable that suppresses nothing', async () => {
    const messages = await messagesFor(
      '// eslint-disable-next-line no-console -- nothing to suppress\nconsole.warn("x");\nexport {};\n'
    )
    expect(messages.map((message) => [message.ruleId, message.severity])).toEqual([[null, 2]])
    expect(messages[0]?.message).toContain('Unused eslint-disable directive')
  })

  it('reports a file-wide disable, even one that names its rule and reason', async () => {
    expect(
      await ruleIdsFor(
        '/* eslint-disable no-console -- the whole file prints */\nconsole.log("x");\nexport {};\n'
      )
    ).toContain('@eslint-community/eslint-comments/disable-enable-pair')
    expect(
      await ruleIdsFor(
        '/* eslint-disable no-console -- this block prints */\nconsole.log("x");\n/* eslint-enable no-console -- the block ends */\nexport {};\n'
      )
    ).toEqual([])
  })

  it('reports a TODO that does not name its issue', async () => {
    expect(await ruleIdsFor('// TODO: later\nexport {};\n')).toContain('micelio/todo-names-issue')
    expect(await ruleIdsFor('// TODO(#12): later\nexport {};\n')).toEqual([])
  })

  it('limits a file to 500 lines outside tests, skipping blank lines and comments', async () => {
    const lines = (count: number): string =>
      Array.from({ length: count }, (_, i) => `console.warn(${i});`).join('\n')
    const padded = `${lines(500)}\n\n// a comment\nexport {};\n`
    expect(await ruleIdsFor(padded)).toEqual(['max-lines'])
    expect(await ruleIdsFor(`${lines(499)}\n\n// a comment\nexport {};\n`)).toEqual([])
    expect(await ruleIdsFor(padded, 'long.test.ts')).toEqual([])
  })

  it('exports the promise-chain selector so repositories can add their own', () => {
    expect(promiseChainRestriction.selector).toContain('then|catch|finally')
    const entry = micelio.find((config) => config.rules?.['no-restricted-syntax'])
    expect(entry?.rules?.['no-restricted-syntax']).toEqual(['error', promiseChainRestriction])
  })
})

describe('the licence allowlist', () => {
  const require = createRequire(import.meta.url)
  const list = require('@micelio/eslint-config/licenses.json') as Record<string, unknown>

  it('resolves through the package exports', () => {
    expect(Object.keys(list)).toEqual(
      expect.arrayContaining(['allowed', 'allowedPrefixes', 'allowedGpl2'])
    )
  })

  it('holds only unique, non-empty SPDX identifiers', () => {
    for (const key of ['allowed', 'allowedPrefixes', 'allowedGpl2']) {
      const ids = list[key] as string[]
      expect(ids.length).toBeGreaterThan(0)
      expect(new Set(ids).size).toBe(ids.length)
      for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9.+-]+$/)
    }
  })

  it('allows what ADR 0007 allows and not GPL-2.0-only', () => {
    const allowed = list.allowed as string[]
    expect(allowed).toEqual(
      expect.arrayContaining(['MIT', 'ISC', 'Apache-2.0', 'MIT-0', 'CC0-1.0'])
    )
    expect(list.allowedPrefixes).toEqual(['LGPL-', 'GPL-3.0', 'AGPL-3.0'])
    expect(list.allowedGpl2).toEqual(['GPL-2.0-or-later', 'GPL-2.0+'])
    expect(JSON.stringify(list)).not.toContain('"GPL-2.0-only"')
    expect(allowed).not.toContain('EPL-2.0')
  })
})
