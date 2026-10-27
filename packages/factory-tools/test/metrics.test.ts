import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { metrics } from '../src/metrics.js'
import { blockingByCategory, countLog, parseEvent, parseLogLines, parseTime } from '../src/parse.js'
import { renderMetrics } from '../src/render.js'
import { repoRoot, run } from '../src/run.js'
import type { RunDeps } from '../src/run.js'
import { fixtureSource } from '../src/source.js'
import type { Source } from '../src/source.js'

const PACKAGE = fileURLToPath(new URL('../', import.meta.url))
const RECORDED = `${PACKAGE}test/fixtures/metrics`
const MILESTONE = 'Micelio · Fábrica'

const deps: RunDeps = {
  readIssue: async () => {
    throw new Error('offline')
  },
  isClosed: async () => false,
  readText: (path) => readFile(path, 'utf8'),
  today: () => '2026-10-24',
}

/** A source over a handful of objects, shaped like the `gh api` output `metrics` reads. */
function source(data: {
  issues?: object[]
  pulls?: object[]
  comments?: Record<number, object[]>
  reviews?: Record<number, object[]>
  reviewComments?: Record<number, object[]>
  checks?: Record<string, [string, string][]>
  commits?: Record<number, [string, string][]>
  required?: string[]
  all?: object[]
  /** Edit history by comment node id, newest first. */
  edits?: Record<string, object[]>
}): Source {
  return {
    milestones: async () => [
      { number: 1, title: 'M1' },
      { number: 2, title: 'M2' },
    ],
    milestoneIssues: async () => data.issues ?? [],
    allIssues: async () => data.all ?? [],
    pulls: async () => data.pulls ?? [],
    pull: async (n) => ({ additions: 10, deletions: 5, head: { sha: `sha${n}` } }),
    comments: async (n) => data.comments?.[n] ?? [],
    commentEdits: async (id) => data.edits?.[id] ?? [],
    reviews: async (n) => data.reviews?.[n] ?? [],
    reviewComments: async (n) => data.reviewComments?.[n] ?? [],
    commits: async (n) =>
      (data.commits?.[n] ?? []).map(([sha, date]) => ({ sha, commit: { committer: { date } } })),
    requiredChecks: async () => data.required ?? [],
    checkRuns: async (sha) =>
      (data.checks?.[sha] ?? []).map(([name, conclusion]) => ({ name, conclusion })),
  }
}

const issue = (number: number, login = 'maint'): object => ({
  number,
  title: `feat: ${number}`,
  user: { login },
  pull_request: null,
})
const comment = (login: string, body: string, at = '2026-01-01T00:00:00Z'): object => ({
  user: { login },
  created_at: at,
  body,
})
const pull = (number: number, extra: object = {}): object => ({
  number,
  title: `pr ${number}`,
  merged_at: '2026-01-02T00:00:00Z',
  user: { login: 'maint' },
  milestone: null,
  body: '',
  ...extra,
})

describe('parseTime', () => {
  it.each([
    ['time: 10m diff', { minutes: 10, kind: 'diff' }],
    ['time: 2 minute diff', { minutes: 2, kind: 'diff' }],
    ['time: 5 minutes report', { minutes: 5, kind: 'report' }],
    ['  Time: 7 MIN Report.  ', { minutes: 7, kind: 'report' }],
    ['LGTM\n\ntime: 3m diff\nthanks', { minutes: 3, kind: 'diff' }],
    ['time: 3m diff\ntime: 4m report', { minutes: 4, kind: 'report' }],
  ])('reads %j', (text, expected) => {
    expect(parseTime(text)).toEqual(expected)
  })

  it.each([
    'time: 10 hours diff',
    'time: 10m',
    'time: m diff',
    'time: 10m diffs',
    'overtime: 10m diff',
    'time 10m diff',
    'it took time: 10m diff',
    '',
  ])('ignores %j', (text) => {
    expect(parseTime(text)).toBeNull()
  })
})

describe('parseEvent', () => {
  it.each([
    ['**Gate 1 (by hand, master): not ready — not started.**', { kind: 'returned' }],
    [
      '**Gate 1 re-run (master): content passes; not started.** It now declares',
      { kind: 'returned' },
    ],
    [
      '**Gate 1 (master): `lint-issue` passes, but the issue is held, not started.**',
      { kind: 'returned' },
    ],
    ['**lint-issue** · `a/b#1` · 2026-10-24 · 1 of 7 rules fail', { kind: 'returned' }],
    [
      '**Gate 3, round 4 (reviewer-35-r4): Red, 1 Blocking, 4 Important.** Report',
      { kind: 'review', round: 4, blocking: 1 },
    ],
    [
      '**Gate 3, round 5 (reviewer-35-r5): Pass, 0 Blocking, 0 Important.**',
      { kind: 'review', round: 5, blocking: 0 },
    ],
    ['**Gate 3 (reviewer-37-r4): Red, 1 Blocking**', { kind: 'review', round: null, blocking: 1 }],
    ['**Gate 3, round 1 (reviewer-35)** — report', { kind: 'review', round: 1, blocking: null }],
    [
      '**Gate 4 (verifier-36): Green, 0 mismatches**: report',
      { kind: 'verification', mismatches: 0 },
    ],
    [
      '**Gate 4 (verifier-35-r2, Sonnet): 1 mismatch, description only.**',
      { kind: 'verification', mismatches: 1 },
    ],
    [
      '**Gate 4, after round 2 (verifier-35)** — report',
      { kind: 'verification', mismatches: null },
    ],
    [
      '**Gate 4, after round 2 (verifier-35)**\n\n**Mismatches: 3.**',
      { kind: 'verification', mismatches: 3 },
    ],
  ])('reads %j', (body, expected) => {
    expect(parseEvent(body)).toEqual(expected)
  })

  it.each([
    '**Gate 1 (master): ready, started** (`worker-38`)',
    '**Gate 1 re-run (master): ready — started**',
    '**lint-issue** · `a/b#1` · 2026-10-24 · all 7 rules pass',
    '**Gate 5 (master): ready for the maintainer.**',
    '**Finding from `worker-36` (#36):** gate 1 held it, not started',
    'factory-log | 2026-10-24 | #35 | Gate 1 not ready | issue',
    '',
  ])('ignores %j', (body) => {
    expect(parseEvent(body)).toBeNull()
  })

  it('counts the mismatches of a report whose first line has none, and does not read a late "round"', () => {
    expect(parseEvent('**Gate 4 (v)**\n## x\n**Mismatches: 2.**')).toEqual({
      kind: 'verification',
      mismatches: 2,
    })
  })
})

describe('blockingByCategory', () => {
  it('counts the B findings under the section 11 check the heading above them starts with', () => {
    const body = [
      '**Gate 3, round 1 (r)** — report',
      '## 1. Correctness and edge cases',
      '**B1. one.** `a.ts:1`',
      '**B2. two.**',
      '**I1. not blocking.**',
      '## 2. Security',
      '**B3. three.**',
      '## 3. Documentation the change made false',
      '**B4.',
      '## Blocking',
      '**B5.',
      '## "Instructions that were wrong"',
      '**B6.',
    ].join('\n')
    expect([...blockingByCategory(body)]).toEqual([
      ['Correctness', 2],
      ['Security', 1],
      ['Documentation', 1],
      ['uncategorised', 2],
    ])
  })

  it('files a finding with no heading above it as uncategorised', () => {
    expect([...blockingByCategory('**B1. lone.**')]).toEqual([['uncategorised', 1]])
  })
})

describe('factory log', () => {
  it('reads factory-log lines, in order, and ignores the rest', () => {
    const body = [
      'factory-log | 2026-10-24 | #35 | Gate lines | issue',
      'prose in between',
      'factory-log | 2026-10-24 | #43 #44 | a `|` stays | in the cell | test',
      'factory-log | yesterday | #1 | bad date | docs',
      'factory-log | 2026-10-24 | #1 | no category',
      '  factory-log | 2026-10-24 | #2 | indented | docs',
      'factory-log | 2026-10-25 | #39 | with a destination | skill | `blind-review`',
      'factory-log | 2026-10-25 | #39 | no destination yet | test | -',
    ].join('\n')
    expect(parseLogLines(body)).toEqual([
      { date: '2026-10-24', issue: '#35', what: 'Gate lines', category: 'issue', destination: '' },
      {
        date: '2026-10-24',
        issue: '#43 #44',
        what: 'a `|` stays | in the cell',
        category: 'test',
        destination: '',
      },
      {
        date: '2026-10-25',
        issue: '#39',
        what: 'with a destination',
        category: 'skill',
        destination: '`blind-review`',
      },
      {
        date: '2026-10-25',
        issue: '#39',
        what: 'no destination yet',
        category: 'test',
        destination: '',
      },
    ])
  })

  it('counts the rows of the table and those with a destination', () => {
    const log = [
      '| Date | Issue | What was corrected | Category | Destination |',
      '| ---- | ----- | ------------------ | -------- | ----------- |',
      '| 2026-10-24 | #35 | one `a \\| b` | docs |  |',
      '| 2026-10-24 | #36 | two | test | `lint-issue` rule |',
      '| 2026-10-25 | #37 | three | lint | skill `x` |',
      'not a row',
    ].join('\n')
    expect(countLog(log)).toEqual({ rows: 3, converted: 2 })
  })

  it('has every line the issues carried, moved with an empty destination', async () => {
    const log = await readFile(`${PACKAGE}../../docs/factory-log.md`, 'utf8')
    const fixtures = await readFile(`${RECORDED}/factory-log.md`, 'utf8')
    const comments: { body: string; created_at: string }[] = []
    for (const file of await readdir(`${RECORDED}/comments`)) {
      comments.push(...JSON.parse(await readFile(`${RECORDED}/comments/${file}`, 'utf8')))
    }
    const cells = (row: string): string[] =>
      row
        .replace(/^\||\|$/g, '')
        .split(/(?<!\\)\|/)
        .map((cell) => cell.trim())
    const rowsOf = (markdown: string): string[][] =>
      markdown
        .split('\n')
        .filter((line) => /^\| 2026/.test(line))
        .map(cells)
    const expected = comments
      .toSorted((a, b) => a.created_at.localeCompare(b.created_at))
      .flatMap((c) => parseLogLines(c.body))
      .map((l) => [l.date, l.issue, l.what.replaceAll('|', '\\|'), l.category, l.destination])
    const rows = rowsOf(log)
    expect(expected).toHaveLength(45)
    expect(rowsOf(fixtures)).toEqual(expected)
    // The first 45 rows are the moved lines and stay as they were; the scribe appends the rest.
    expect(rows.slice(0, 45)).toEqual(expected)
    expect(countLog(log).rows).toBe(rows.length)
    for (const [date, issue, what, category] of rows.slice(45)) {
      const line = `factory-log | ${date} | ${issue} | ${(what ?? '').replaceAll('\\|', '|')} | ${category} | -`
      expect(parseLogLines(line)).toHaveLength(1)
    }
  })
})

describe('metrics', () => {
  it('prints the recorded milestone as the golden table, with every column filled', async () => {
    const result = await run(['metrics', '--milestone', MILESTONE, '--fixtures', RECORDED], deps)
    expect(result.code).toBe(0)
    expect(result.stderr).toBe('')
    expect(result.stdout).toBe(await readFile(`${RECORDED}/expected.md`, 'utf8'))
    for (const line of result.stdout.split('\n')) {
      if (line.startsWith('|') && !line.startsWith('| Total')) expect(line).not.toMatch(/\|\s*\|/)
    }
  })

  it('counts what the recorded comments say, by hand', async () => {
    const result = await metrics(fixtureSource(RECORDED), {
      milestone: MILESTONE,
      log: await readFile(`${RECORDED}/factory-log.md`, 'utf8'),
    })
    const row = (n: number) => result.issues.find((i) => i.number === n)
    expect(row(35)).toMatchObject({ returned: 0, rounds: 5, blocking: 4, mismatches: 1 })
    expect(row(36)).toMatchObject({ returned: 1, rounds: 4, blocking: 2, mismatches: 0 })
    expect(row(38)?.returned).toBe(2)
    expect(row(41)?.returned).toBe(0)
    expect(result.pulls.map((p) => [p.number, p.issue, p.lines, p.time])).toEqual([
      [46, 35, 18, { minutes: 2, kind: 'diff' }],
      [47, 35, 405, { minutes: 10, kind: 'diff' }],
      [48, 36, 1804, { minutes: 12, kind: 'diff' }],
      [49, 37, 466, { minutes: 7, kind: 'diff' }],
    ])
  })

  it('records only logins of people', async () => {
    const walk = async (dir: string): Promise<string[]> => {
      const names = await readdir(dir, { withFileTypes: true })
      const nested = await Promise.all(
        names.map((e) => (e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`]))
      )
      return nested.flat().filter((file) => file.endsWith('.json'))
    }
    const keys = new Set<string>()
    for (const file of await walk(RECORDED)) {
      const text = await readFile(file, 'utf8')
      expect(text).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/)
      JSON.stringify(JSON.parse(text), (key: string, value: unknown) => {
        if (key === 'user' && typeof value === 'object' && value !== null) {
          for (const k of Object.keys(value)) keys.add(k)
        }
        return value
      })
    }
    expect([...keys]).toEqual(['login'])
  })

  it('counts a round, a Blocking finding and a mismatch only from the maintainer', async () => {
    const result = await metrics(
      source({
        issues: [issue(1), issue(2)],
        comments: {
          2: [
            comment('maint', '**Gate 3, round 2 (r): Red, 2 Blocking**'),
            comment('maint', '**Gate 4 (v): 1 mismatch**'),
            comment('someone', '**Gate 3, round 9 (r): Red, 5 Blocking**'),
            comment('someone', '**Gate 1: not ready**'),
          ],
        },
      }),
      { milestone: 'M2', log: '' }
    )
    expect(result.issues[1]).toMatchObject({ returned: 0, rounds: 2, blocking: 2, mismatches: 1 })
    expect(result.categories).toEqual([['uncategorised', 2]])
  })

  describe('the lint-issue report of the issue-ready bot', () => {
    const marker = '<!-- micelio:issue-ready -->'
    const fail = (n: number) =>
      `${marker}\n**lint-issue** · \`a/b#${n}\` · 2026-10-24 · 2 of 7 rules fail`
    const pass = (n: number) =>
      `${marker}\n**lint-issue** · \`a/b#${n}\` · 2026-10-24 · all 7 rules pass`
    const bot = (body: string, node_id = 'IC_1'): object => ({
      ...comment('micelio-bot[bot]', body),
      node_id,
    })
    // The history comes newest first, as GraphQL returns it.
    const edits = (...bodies: string[]): object[] =>
      bodies.map((diff, i) => ({ editedAt: `2026-10-24T10:0${i}:00Z`, diff })).reverse()
    const returned = async (comments: object[], history: Record<string, object[]> = {}) =>
      (
        await metrics(
          source({ issues: [issue(1), issue(2)], comments: { 2: comments }, edits: history }),
          {
            milestone: 'M2',
            log: '',
          }
        )
      ).issues[1]?.returned

    it('counts fail → pass once', async () => {
      expect(await returned([bot(pass(2))], { IC_1: edits(fail(2), pass(2)) })).toBe(1)
    })

    it('counts fail → pass → fail twice', async () => {
      expect(await returned([bot(fail(2))], { IC_1: edits(fail(2), pass(2), fail(2)) })).toBe(2)
    })

    it('counts a comment that was never edited once if it fails, and not if it passes', async () => {
      expect(await returned([bot(fail(2))])).toBe(1)
      expect(await returned([bot(pass(2))])).toBe(0)
    })

    it('does not count an edit that keeps failing, nor a pass → fail → pass history twice', async () => {
      expect(await returned([bot(fail(2))], { IC_1: edits(fail(2), fail(2)) })).toBe(1)
      expect(await returned([bot(pass(2))], { IC_1: edits(pass(2), fail(2), pass(2)) })).toBe(1)
    })

    it('counts a failing current text that the history lacks', async () => {
      expect(await returned([bot(fail(2))], { IC_1: edits(pass(2)) })).toBe(1)
    })

    it('adds the comments of one issue', async () => {
      const second = bot(fail(2), 'IC_2')
      expect(await returned([bot(pass(2)), second], { IC_1: edits(fail(2), pass(2)) })).toBe(2)
    })

    it('ignores a person, a comment without the marker and the bot’s Gate lines', async () => {
      expect(
        await returned(
          [
            { ...comment('someone', fail(2)), node_id: 'IC_1' },
            bot(fail(2).replace(marker, ''), 'IC_2'),
            bot(`${marker}\n**Gate 1: not ready**`, 'IC_3'),
          ],
          { IC_1: edits(fail(2)) }
        )
      ).toBe(0)
    })
  })

  it('counts the recorded fail → pass history of the bot comment on #51 once', async () => {
    const recorded = fixtureSource(RECORDED)
    const comments = await recorded.comments(51)
    const result = await metrics(
      { ...recorded, milestoneIssues: async () => [issue(51)] },
      { milestone: MILESTONE, maintainer: 'ale9420', log: '' }
    )
    expect(comments.map((c) => (c as { user: { login: string } }).user.login)).toEqual([
      'micelio-bot[bot]',
      'ale9420',
    ])
    // The comment now passes; the history has the failing version before it.
    expect(result.issues[0]?.returned).toBe(1)
  })

  it('counts a Gate 3 comment without a round before a numbered one as two reviews', async () => {
    const result = await metrics(
      source({
        issues: [issue(1)],
        comments: {
          1: [
            comment('maint', '**Gate 3 (r): Red, 1 Blocking**'),
            comment('maint', '**Gate 3, round 1 (r2): Red, 1 Blocking**'),
          ],
        },
      }),
      { milestone: 'M2', log: '' }
    )
    expect(result.issues[0]).toMatchObject({ rounds: 2, blocking: 2 })
  })

  it('takes the maintainer from the lowest issue, or from --maintainer', async () => {
    const data = {
      issues: [issue(5, 'other'), issue(3, 'maint')],
      comments: { 3: [comment('other', '**Gate 1: held**')] },
    }
    const first = await metrics(source(data), { milestone: 'M2', log: '' })
    expect(first.issues.map((i) => i.returned)).toEqual([0, 0])
    const named = await metrics(source(data), { milestone: 'M2', log: '', maintainer: 'other' })
    expect(named.issues.map((i) => i.returned)).toEqual([1, 0])
  })

  it('measures a pull request: lines, corrections, red checks, defects and the time line', async () => {
    const result = await metrics(
      source({
        issues: [issue(1)],
        pulls: [
          pull(10, { body: 'Closes #1', head: { sha: 'x' } }),
          pull(11, { milestone: { title: 'M1' }, body: 'Closes #1' }),
          pull(12, { milestone: { title: 'M2' } }),
          pull(13),
          pull(14, { body: 'Refs #1', merged_at: null }),
        ],
        comments: {
          10: [comment('maint', 'time: 4m diff', '2026-01-01T00:00:00Z')],
          12: [comment('other', 'time: 9m diff')],
        },
        reviews: {
          10: [
            {
              user: { login: 'maint' },
              submitted_at: '2026-01-02T00:00:00Z',
              body: 'time: 6 minutes report',
            },
          ],
          12: [{ user: { login: 'maint' }, submitted_at: '2026-01-02T00:00:00Z', body: 'LGTM' }],
        },
        reviewComments: {
          10: [comment('maint', 'fix this'), comment('maint', 'and this'), comment('bot', 'nit')],
        },
        commits: { 10: [['sha10', '2026-01-02T00:00:00Z']] },
        checks: {
          sha10: [
            ['a', 'success'],
            ['b', 'failure'],
            ['c', 'timed_out'],
            ['d', 'skipped'],
            ['e', 'cancelled'],
          ],
        },
        all: [
          { number: 20, title: 'fix(x): broke it', body: 'Introduced by #10.' },
          { number: 21, title: 'fix: also', body: 'See https://github.com/o/r/pull/10' },
          { number: 22, title: 'feat: no', body: 'Cites #10' },
          { number: 23, title: 'fix: unrelated', body: 'Cites #100 and a/b#10' },
          { number: 24, title: 'fix: of the unmerged', body: 'Cites #14' },
        ],
      }),
      { milestone: 'M2', log: '' }
    )
    expect(result.pulls.map((p) => p.number)).toEqual([10, 12, 14])
    expect(result.pulls[0]).toEqual({
      number: 10,
      title: 'pr 10',
      issue: 1,
      lines: 15,
      corrections: 2,
      redChecks: 3,
      defects: 2,
      time: { minutes: 6, kind: 'report' },
    })
    expect(result.pulls[1]).toMatchObject({ issue: null, time: null, defects: 0 })
    expect(result.pulls[2]).toMatchObject({ issue: 1, defects: 0 })
    const text = renderMetrics(result, '2026-10-24')
    expect(text).toContain('| #10 | #1 | 15 | 2 | 3 | 2 | 0 | 6 |')
    expect(text).toContain('| #12 | — | 15 | 0 | 0 | 0 | — | — |')
    expect(text).toContain('| Total |  | 45 | 2 | 3 | 2 | 0 | 6 |')
  })

  it('splits the Blocking findings by category and keeps the uncounted ones as uncategorised', async () => {
    const result = await metrics(
      source({
        issues: [issue(1)],
        comments: {
          1: [
            comment(
              'maint',
              '**Gate 3, round 1 (r)** — report\n## 1. Contracts\n**B1. a.**\n**B2. b.**'
            ),
            comment('maint', '**Gate 3, round 2 (r): Red, 3 Blocking.**\n## Contracts\n**B1. a.**'),
          ],
        },
      }),
      { milestone: 'M2', log: '' }
    )
    expect(result.issues[0]?.blocking).toBe(5)
    expect(result.categories).toEqual([
      ['Contracts', 3],
      ['uncategorised', 2],
    ])
  })

  it('does not count a fix pull request as a defect, only a fix issue', async () => {
    const result = await metrics(
      source({
        issues: [issue(1)],
        pulls: [pull(10, { body: 'Closes #1' })],
        all: [
          { number: 20, title: 'fix(x): regression', body: 'From #10.', pull_request: null },
          { number: 21, title: 'fix(x): its fix', body: 'From #10.', pull_request: {} },
        ],
      }),
      { milestone: 'M2', log: '' }
    )
    expect(result.pulls[0]?.defects).toBe(1)
  })

  it('counts the required checks that ended red on commits pushed after the pull request opened', async () => {
    const opened = '2026-01-02T00:00:00Z'
    const result = await metrics(
      source({
        issues: [issue(1)],
        pulls: [pull(10, { body: 'Closes #1', created_at: opened })],
        required: ['check / Check', 'dco'],
        commits: {
          10: [
            ['before', '2026-01-01T00:00:00Z'],
            ['at', opened],
            ['after1', '2026-01-02T00:00:01Z'],
            ['after2', '2026-01-03T00:00:00Z'],
          ],
        },
        checks: {
          before: [['check / Check', 'failure']],
          at: [['check / Check', 'failure']],
          after1: [
            ['check / Check', 'failure'],
            ['dco', 'success'],
            ['scorecard', 'failure'],
          ],
          after2: [
            ['check / Check', 'cancelled'],
            ['dco', 'timed_out'],
            ['check / Check', 'success'],
          ],
        },
      }),
      { milestone: 'M2', log: '' }
    )
    expect(result.pulls[0]?.redChecks).toBe(3)
  })

  it('counts every red check when the branch requires none', async () => {
    const result = await metrics(
      source({
        issues: [issue(1)],
        pulls: [pull(10, { body: 'Closes #1', created_at: '2026-01-02T00:00:00Z' })],
        commits: { 10: [['a', '2026-01-03T00:00:00Z']] },
        checks: {
          a: [
            ['x', 'failure'],
            ['y', 'failure'],
          ],
        },
      }),
      { milestone: 'M2', log: '' }
    )
    expect(result.pulls[0]?.redChecks).toBe(2)
  })

  it('prefers the issue a pull request closes over one it refers to', async () => {
    const result = await metrics(
      source({
        issues: [issue(1), issue(2)],
        pulls: [pull(10, { body: 'Refs #1\n\nCloses #2' }), pull(11, { body: 'Refs #1' })],
      }),
      { milestone: 'M2', log: '' }
    )
    expect(result.pulls.map((p) => p.issue)).toEqual([2, 1])
  })

  it('counts a Gate 3 comment without a round as the next round', async () => {
    const result = await metrics(
      source({
        issues: [issue(1)],
        comments: {
          1: [
            comment('maint', '**Gate 3, round 1 (r): Red, 1 Blocking**'),
            comment('maint', '**Gate 3 (r): Red, 2 Blocking**'),
          ],
        },
      }),
      { milestone: 'M2', log: '' }
    )
    expect(result.issues[0]).toMatchObject({ rounds: 2, blocking: 3 })
  })

  it('says which milestones exist when the title is wrong', async () => {
    await expect(metrics(source({}), { milestone: 'M3', log: '' })).rejects.toThrow(
      'no milestone "M3"; the repository has "M1", "M2"'
    )
  })
})

describe('factory-tools metrics', () => {
  it('needs a milestone and knows its arguments', async () => {
    for (const argv of [
      ['metrics'],
      ['metrics', '--milestone'],
      ['metrics', '--milestone', 'M', '--bogus', 'x'],
      ['metrics', '--milestone', 'M', '--repo', '-x/y'],
    ]) {
      const result = await run(argv, deps)
      expect(result.code).toBe(2)
      expect(result.stdout).toBe('')
      expect(result.stderr).toMatch(/^error: .*\nUsage:/s)
    }
  })

  it('exits 2 with one line when the milestone or a file is missing', async () => {
    const wrong = await run(['metrics', '--milestone', 'Nope', '--fixtures', RECORDED], deps)
    expect(wrong.code).toBe(2)
    expect(wrong.stderr).toBe(
      'error: no milestone "Nope"; the repository has "Micelio · Bases por producto", "Micelio · Fábrica"\n'
    )
    const noLog = await run(
      ['metrics', '--milestone', MILESTONE, '--fixtures', `${RECORDED}/pulls`],
      deps
    )
    expect(noLog.code).toBe(2)
    expect(noLog.stderr).toMatch(/^error: .*factory-log\.md/)
  })

  it('finds the log from the repository root when run from a package folder', async () => {
    const root = await mkdtemp(join(tmpdir(), 'factory-tools-'))
    const folder = join(root, 'packages', 'factory-tools')
    await mkdir(join(root, 'docs'), { recursive: true })
    await mkdir(folder, { recursive: true })
    await writeFile(
      join(root, 'docs', 'factory-log.md'),
      '| 2026-10-24 | #1 | x | test | a check |\n| 2026-10-24 | #2 | y | docs |  |\n'
    )
    expect(spawnSync('git', ['init', '-q', root]).status).toBe(0)
    expect(await repoRoot(folder)).toBe(await realpath(root))
    const stub = source({ issues: [issue(1)] })
    const result = await run(['metrics', '--milestone', 'M2'], {
      ...deps,
      repoRoot: () => repoRoot(folder),
      currentRepo: async () => 'o/r',
      metricsSource: () => stub,
    })
    expect(result.stderr).toBe('')
    expect(result.code).toBe(0)
    expect(result.stdout).toContain('| 2 | 1 |')
    const outside = await mkdtemp(join(tmpdir(), 'factory-tools-outside-'))
    const inside = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: outside })
    // A TMPDIR inside a repository (some sandboxes) has no "outside" to test.
    if (inside.status !== 0) {
      await expect(repoRoot(outside)).rejects.toThrow('is not in a git repository')
    }
  })

  it('reads another log with --log', async () => {
    const result = await run(
      [
        'metrics',
        '--milestone',
        MILESTONE,
        '--fixtures',
        RECORDED,
        '--log',
        `${RECORDED}/expected.md`,
      ],
      deps
    )
    expect(result.stdout).toContain('| 0 | 0 |')
  })

  it('runs as the built bin from the package, as the issue writes it', () => {
    const done = spawnSync(
      'node',
      ['dist/cli.js', 'metrics', '--milestone', MILESTONE, '--fixtures', 'test/fixtures/metrics'],
      { cwd: PACKAGE, encoding: 'utf8' }
    )
    expect(done.status).toBe(0)
    expect(done.stdout).toMatch(/^\*\*metrics\*\* · "Micelio · Fábrica" · \d{4}-\d\d-\d\d\n/)
    expect(done.stdout).toContain('| #46 | #35 | 18 | 0 | 0 | 0 | 2 | 0 |')
  })

  it('serves metrics and issue-ready from the same bin', () => {
    const ready = spawnSync('node', ['dist/cli.js', 'issue-ready'], {
      cwd: PACKAGE,
      encoding: 'utf8',
    })
    expect(ready.status).toBe(2)
    expect(ready.stderr).toContain('give one target')
    expect(ready.stderr).toContain('factory-tools issue-ready')
    const metrics = spawnSync('node', ['dist/cli.js', 'metrics'], {
      cwd: PACKAGE,
      encoding: 'utf8',
    })
    expect(metrics.status).toBe(2)
    expect(metrics.stderr).toContain('metrics needs --milestone')
  })
})
