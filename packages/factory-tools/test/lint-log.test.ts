import { spawnSync } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { tempDir } from '../../../test/support/temp.js'
import { lintLog, runLintLog } from '../src/lint-log.js'
import { parseLogLines } from '../src/parse.js'

const PACKAGE = fileURLToPath(new URL('../', import.meta.url))

const PROCESS =
  'factory-log | 2026-11-17 | bogd3v/micelio-plugin-core#237 | herdr pane run leaves the slice shell busy | process | -'

const inFile = async (body: string, run: (path: string) => Promise<void>): Promise<void> => {
  const path = join(tempDir('lint-log-'), 'comment.txt')
  await writeFile(path, body)
  await run(path)
}

describe('lint-log', () => {
  it('fails a line whose category is not one of the six, and names it', async () => {
    // the planner's reproduction: parseLogLines folds the bad category into What
    expect(parseLogLines(PROCESS)[0]?.category).toBe('-')
    await inFile(`posted:\n${PROCESS}\n`, async (path) => {
      const result = await runLintLog(['lint-log', '--file', path])
      expect(result.code).toBe(1)
      expect(result.stdout).toContain('"process"')
      expect(result.stdout).toContain('line 2')
    })
    expect(lintLog(PROCESS)).toHaveLength(1)
  })

  it('passes the six categories, with and without a destination', async () => {
    const categories = ['lint', 'test', 'skill', 'standard', 'issue', 'docs']
    const lines = categories.flatMap((category) => [
      `factory-log | 2026-11-17 | #291 | what with a | inside | ${category} | -`,
      `factory-log | 2026-11-17 | #291 | something wrong | ${category} | #292`,
    ])
    expect(lintLog(lines.join('\n'))).toEqual([])
    await inFile(lines.join('\n'), async (path) => {
      const result = await runLintLog(['lint-log', '--file', path])
      expect(result.code).toBe(0)
    })
  })

  it('fails a bad date, an empty issue, an empty what and an empty last field', () => {
    const reasons = (line: string): string[] => lintLog(line).map((p) => p.reason)
    expect(reasons('factory-log | 17-11-2026 | #1 | x | test | -')[0]).toContain('YYYY-MM-DD')
    expect(reasons('factory-log | 2026-11-17 |  | x | test | -')).toEqual(['the issue is empty'])
    expect(reasons('factory-log | 2026-11-17 | #1 |  | test | -')).toEqual(['the what is empty'])
    expect(reasons('factory-log | 2026-11-17 | #1 | x | test | ')[0]).toContain('last field')
    expect(reasons('factory-log | 2026-11-17 | #1 | x | test |')[0]).toContain('last field')
    expect(reasons('factory-log | 2026-11-17 | #1 | x | y')[0]).toContain('"y"')
    expect(reasons('factory-log | 2026-11-17 | #1 | x')[0]).toContain('fields')
    expect(reasons('factory-log |')[0]).toContain('last field')
  })

  it('fails an empty issue or what written as "| |", and a date that is not a calendar date', () => {
    const reasons = (line: string): string[] => lintLog(line).map((p) => p.reason)
    expect(reasons('factory-log | 2026-11-17 | | a | b | test | -')).toEqual(['the issue is empty'])
    expect(reasons('factory-log | 2026-11-17 | #1 | | | test | -')).toEqual(['the what is empty'])
    expect(reasons('factory-log | 2026-11-17 | #1 |  |  | test | -')).toEqual(['the what is empty'])
    expect(reasons('factory-log | 2026-11-17 | #1 | | test | -')).toEqual(['the what is empty'])
    expect(reasons('factory-log | 2026-13-45 | #1 | x | test | -')[0]).toContain('YYYY-MM-DD')
    expect(reasons('factory-log | 2026-02-30 | #1 | x | test | -')[0]).toContain('YYYY-MM-DD')
  })

  it('fails a line that parseLogLines would misread or drop, which has no space beside a |', () => {
    const lines = [
      'factory-log | 2026-11-17 | #1 | what here| test | -',
      'factory-log | 2026-11-17 | #1 | what here | test|-',
      'factory-log | 2026-11-17 | #1 | what here |test| -',
      'factory-log | 2026-11-17| #1 | what here | test | -',
      'factory-log |2026-11-17 | #1 | what here | test | -',
    ]
    for (const line of lines) {
      expect(
        lintLog(line).map((p) => p.reason),
        line
      ).toEqual(['the fields must be separated by " | " (a space on each side of every |)'])
    }
    expect(lintLog('factory-log | 2026-11-17 | #1 | what | here | test | #2')).toEqual([])
  })

  it('passes the older form without a destination, which parseLogLines reads with the category last', async () => {
    const line = 'factory-log | 2026-11-18 | #291 | the draft left out the baseline | issue'
    expect(lintLog(line)).toEqual([])
    expect(parseLogLines(line)).toEqual([
      {
        date: '2026-11-18',
        issue: '#291',
        what: 'the draft left out the baseline',
        category: 'issue',
        destination: '',
      },
    ])
    expect(lintLog('factory-log | 2026-11-18 | #291 | a | b | issue | -')).toEqual([])
    const bad = lintLog('factory-log | 2026-11-18 | #291 | the draft | process')
    expect(bad.map((p) => p.reason)).toHaveLength(1)
    expect(bad[0]?.reason).toContain('"process"')
    await inFile(`${line}\n`, async (path) => {
      expect((await runLintLog(['lint-log', '--file', path])).code).toBe(0)
    })
  })

  it('names an empty field before the category instead of the spaces', () => {
    const reasons = (line: string): string[] => lintLog(line).map((p) => p.reason)
    expect(
      reasons('factory-log | 2026-11-18 | #291 | the draft left out the baseline | | issue | -')
    ).toEqual(['a field between the what and the category is empty ("| |")'])
    // a | without a space keeps the reason about spaces
    expect(reasons('factory-log | 2026-11-18 | #291 | a |  | b| issue | -')).toEqual([
      'the fields must be separated by " | " (a space on each side of every |)',
    ])
  })

  it('runs as the bin: exit 1 on the process line, exit 0 on a right one', async () => {
    const run = (path: string): ReturnType<typeof spawnSync> =>
      spawnSync('node', [`${PACKAGE}dist/cli.js`, 'lint-log', '--file', path], { encoding: 'utf8' })
    await inFile(`${PROCESS}\n`, async (path) => {
      const bad = run(path)
      expect(bad.status).toBe(1)
      expect(String(bad.stdout)).toContain('"process"')
    })
    await inFile('factory-log | 2026-11-17 | #1 | x | test | -\n', async (path) => {
      expect(run(path).status).toBe(0)
    })
  })

  it('ignores lines that do not start with factory-log, and exits 2 on bad arguments', async () => {
    expect(lintLog('hello\n tokens | x\n  factory-log | nope\nfactory-logs | x | y')).toEqual([])
    await inFile('nothing to see\n', async (path) => {
      expect((await runLintLog(['lint-log', '--file', path])).code).toBe(0)
    })
    for (const argv of [
      ['lint-log'],
      ['lint-log', '--file'],
      ['lint-log', '--file', 'a', 'b'],
      ['lint-log', '--other', 'a'],
    ]) {
      expect((await runLintLog(argv)).code).toBe(2)
    }
    const missing = await runLintLog(['lint-log', '--file', '/nonexistent/comment.txt'])
    expect(missing.code).toBe(2)
    expect(missing.stderr).toContain('cannot read')
  })
})
