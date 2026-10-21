import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { check, format, resolveConfig } from 'prettier'
import { describe, expect, it } from 'vitest'
import config from '../src/index.js'

const FIXTURE = fileURLToPath(new URL('../../../fixtures/basic/', import.meta.url))

describe('@micelio/prettier-config against the fixture', () => {
  it('is the configuration the fixture resolves through its package.json', async () => {
    const resolved = await resolveConfig(`${FIXTURE}src/slug.ts`)
    expect(resolved).toMatchObject(config)
  })

  it('accepts every source file of the fixture as formatted', async () => {
    const resolved = await resolveConfig(`${FIXTURE}src/slug.ts`)
    const files = readdirSync(`${FIXTURE}src`).filter((name) => name.endsWith('.ts'))
    expect(files.length).toBeGreaterThan(0)
    for (const name of files) {
      const text = readFileSync(`${FIXTURE}src/${name}`, 'utf8')
      expect(await check(text, { ...resolved, filepath: `${FIXTURE}src/${name}` })).toBe(true)
    }
  })

  it('formats with no semicolons, single quotes, ES5 trailing commas and 100 columns', async () => {
    const source =
      'const a = {\n  b: "x",\n  c: 1\n}\nconst long = ["aaaaaaaaaaaaaaaaaaaa", "bbbbbbbbbbbbbbbbbbbb", "cccccccccccccccccccc", "dddddddddddddddddd"]\n'
    const out = await format(source, { ...config, parser: 'typescript' })
    expect(out).toContain("b: 'x',")
    expect(out).toContain('c: 1,')
    expect(out).not.toContain(';')
    expect(out.split('\n').every((line) => line.length <= 100)).toBe(true)
  })
})
