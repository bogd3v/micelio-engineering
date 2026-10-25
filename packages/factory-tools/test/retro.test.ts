import { readFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { issueFromMarkdown } from '../src/issue.js'
import { lintIssue } from '../src/rules.js'

const FACTORY = fileURLToPath(new URL('../../../fixtures/factory/', import.meta.url))
const OUT = `${FACTORY}retro-out/`

/** The `Date #issue` keys of the rows of a log still to read (Destination empty or `single …`), and of those converted. */
async function logRows(): Promise<{ open: string[]; converted: string[] }> {
  const rows = (await readFile(`${FACTORY}retro-log.md`, 'utf8'))
    .split('\n')
    .filter((line) => /^\| \d{4}-\d{2}-\d{2} /.test(line))
    .map((line) => line.split('|').map((cell) => cell.trim()))
  const keys = (converted: boolean): string[] =>
    rows
      .filter((cells) => cells[5]!.startsWith('#') === converted)
      .map((cells) => `${cells[1]} ${cells[2]}`)
  return { open: keys(false), converted: keys(true) }
}

/** The `Date #issue` keys a draft quotes from the log. */
function quoted(draft: string): string[] {
  return [...draft.matchAll(/(\d{4}-\d{2}-\d{2}) (#\d+)/g)].map(
    (match) => `${match[1]} ${match[2]}`
  )
}

describe('the factory-retro fixture run', () => {
  it('has three drafts, each passing every lint-issue rule', async () => {
    const files = (await readdir(OUT)).filter((name) => name.endsWith('.md'))
    expect(files).toHaveLength(3)
    for (const name of files) {
      const issue = issueFromMarkdown(
        await readFile(`${OUT}${name}`, 'utf8'),
        'bogd3v/micelio-engineering'
      )
      const failed = (await lintIssue(issue, async () => true)).filter((result) => !result.ok)
      expect(failed, name).toEqual([])
      expect(issue.body, name).toContain('Verified by the maintainer')
    }
  })

  it('drafts each repeated correction once and no single one', async () => {
    const { open, converted } = await logRows()
    const files = (await readdir(OUT)).filter((name) => name.endsWith('.md'))
    const covered = new Set<string>()
    for (const name of files) {
      const keys = quoted(await readFile(`${OUT}${name}`, 'utf8'))
      expect(new Set(keys).size, `${name} quotes two rows`).toBe(2)
      for (const key of keys) {
        expect(open, `${name} quotes ${key}, which is not an open row`).toContain(key)
        expect(covered.has(key), `${key} is in two drafts`).toBe(false)
        covered.add(key)
      }
    }
    expect(covered.size).toBe(6)
    expect(open).toHaveLength(10)
    expect(open.filter((key) => !covered.has(key))).toHaveLength(4)
    for (const key of converted) expect(covered.has(key)).toBe(false)
  })
})
