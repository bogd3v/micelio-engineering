import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
/** The six categories of `docs/factory-log.md`, the only ones a row may have. */
const CATEGORIES = ['lint', 'test', 'skill', 'standard', 'issue', 'docs']

/**
 * The log to check: `docs/factory-log.md`, or the file `FACTORY_LOG` names, so a scratch copy can
 * be tried (`FACTORY_LOG=<path> npm run test -- test/factory-log.test.ts`).
 */
const LOG = process.env.FACTORY_LOG ?? join(ROOT, 'docs/factory-log.md')

const cells = (row: string): string[] =>
  row
    .replace(/^\||\|$/g, '')
    .split(/(?<!\\)\|/)
    .map((cell) => cell.trim())

/** The table rows of a log: the lines that start with a date. */
const rowsOf = (markdown: string): string[][] =>
  markdown
    .split('\n')
    .filter((line) => /^\| \d{4}-\d{2}-\d{2} \|/.test(line))
    .map(cells)

/** The categories no row may use, as `line number: category`; empty when the log is right. */
function badCategories(markdown: string): string[] {
  return markdown.split('\n').flatMap((line, index) => {
    if (!/^\| \d{4}-\d{2}-\d{2} \|/.test(line)) return []
    const category = cells(line)[3] ?? ''
    return CATEGORIES.includes(category) ? [] : [`${index + 1}: ${JSON.stringify(category)}`]
  })
}

describe('the correction log', () => {
  const log = readFileSync(LOG, 'utf8')

  it('has only the six categories, in every row', () => {
    expect(rowsOf(log).length).toBeGreaterThan(0)
    expect(badCategories(log)).toEqual([])
  })

  it('catches a row with another category, such as stale-claim', () => {
    const row = '| 2026-11-03 | #45 | A claim went stale | stale-claim |  |'
    expect(badCategories(row)).toHaveLength(1)
    expect(badCategories(row.replace('stale-claim', 'docs'))).toEqual([])
    expect(badCategories(row.replace('| stale-claim |', '| |'))).toHaveLength(1)
  })
})

describe('the documents that name the categories', () => {
  const named = (text: string): string[] => CATEGORIES.filter((c) => text.includes(`\`${c}\``))

  it('lists the six in the Category column of docs/factory-log.md as the only ones', () => {
    const line =
      readFileSync(join(ROOT, 'docs/factory-log.md'), 'utf8')
        .split('\n')
        .find((l) => l.startsWith('| Category ')) ?? ''
    expect(named(line)).toEqual(CATEGORIES)
    expect(line).toContain('the only ones')
  })

  it('has herdr/master.md name the six where the master posts the line', () => {
    const master = readFileSync(join(ROOT, 'herdr/master.md'), 'utf8')
    const at = master.indexOf('factory-log |')
    expect(at).toBeGreaterThan(-1)
    const near = master.slice(at, at + 1500)
    expect(named(near)).toEqual(CATEGORIES)
  })
})
