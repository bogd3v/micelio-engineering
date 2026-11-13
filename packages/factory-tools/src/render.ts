import type { Metrics, PullRow, RoleTokens } from './metrics.js'

/**
 * The Markdown of a run of `metrics`: a header line, then the tables of the README; a totals row
 * ends the first two. A pull request without a `time:` line shows `—` in the three minutes columns;
 * with one, a column it does not give shows `—`, except that `diff` and `report` are alternatives,
 * so a note with one of them shows 0 in the other. The tokens cell is `—` when the issue has no
 * `tokens |` record, never 0. After the correction log table come the tokens of the milestone by
 * role (the `master` and `canary` records included, cache reads shown) and two summary lines, the
 * tokens per merged pull request without a later fix without and with cache reads; a pull request's
 * issue record is counted once in them, however many pull requests repeat its cell. The same holds
 * for `Findings with no log row (any kind)` in the totals row.
 *
 * @param date - The day of the run, `YYYY-MM-DD`.
 */
export function renderMetrics(result: Metrics, date: string): string {
  const sum = <T>(items: T[], pick: (item: T) => number): number =>
    items.reduce((total, item) => total + pick(item), 0)
  const minutes = (column: 'diff' | 'report' | 'handsOn'): number =>
    sum(result.pulls, (pull) => pull.time?.[column] ?? 0)
  const reading = (pull: PullRow, column: 'diff' | 'report'): string | number => {
    const { time } = pull
    if (time === null || (time.diff === null && time.report === null)) return '—'
    return time[column] ?? 0
  }

  // `unlogged` is its issue's: an issue with two pull requests counts once in the Total.
  const unloggedOnce = sum(
    result.pulls.filter(
      (p, at) => p.issue === null || result.pulls.findIndex((q) => q.issue === p.issue) === at
    ),
    (p) => p.unlogged
  )

  const issues = table(
    [
      'Issue',
      'Times returned at gate 1',
      'Gate 3 rounds',
      'Blocking findings',
      'Verifier mismatches',
      'False reds, gate 3',
      'False reds, gate 4',
    ],
    [
      ...result.issues.map((i) => [
        `#${i.number}`,
        i.returned,
        i.rounds,
        i.blocking,
        i.mismatches,
        i.falseRedsGate3,
        i.falseRedsGate4,
      ]),
      [
        'Total',
        sum(result.issues, (i) => i.returned),
        sum(result.issues, (i) => i.rounds),
        sum(result.issues, (i) => i.blocking),
        sum(result.issues, (i) => i.mismatches),
        sum(result.issues, (i) => i.falseRedsGate3),
        sum(result.issues, (i) => i.falseRedsGate4),
      ],
    ]
  )
  const pulls = table(
    [
      'Pull request',
      'Issue',
      'Changed lines',
      'Maintainer corrections',
      'Red required checks',
      'Findings with no log row (any kind)',
      'Defects after merge',
      'Minutes, diff',
      'Minutes, report',
      'Minutes, Docker or test',
      'Silent approvals',
      'Reports read first',
      'Tokens, by role',
    ],
    [
      ...result.pulls.map((p) => [
        `#${p.number}`,
        p.issue === null ? '—' : `#${p.issue}`,
        p.lines,
        p.corrections,
        p.redChecks,
        p.unlogged,
        p.defects,
        reading(p, 'diff'),
        reading(p, 'report'),
        p.time?.handsOn ?? '—',
        p.silentApprovals,
        reportFirst(p),
        tokensCell(p.tokens),
      ]),
      [
        'Total',
        '',
        sum(result.pulls, (p) => p.lines),
        sum(result.pulls, (p) => p.corrections),
        sum(result.pulls, (p) => p.redChecks),
        unloggedOnce,
        sum(result.pulls, (p) => p.defects),
        minutes('diff'),
        minutes('report'),
        minutes('handsOn'),
        sum(result.pulls, (p) => p.silentApprovals),
        sum(result.pulls, (p) => (reportFirst(p) === 1 ? 1 : 0)),
        '',
      ],
    ]
  )
  const categories = table(
    ['Category of the Blocking findings', 'Findings'],
    result.categories.length ? result.categories : [['none', 0]]
  )
  const learnings = table(
    ['Correction log rows', 'With a destination', 'Learnings converted'],
    [[result.log.rows, result.log.converted, result.learnings]]
  )
  const roles = table(
    ['Tokens of the milestone, by role', 'Input', 'Output', 'Cache reads', 'Input plus output'],
    result.milestoneTokens.length
      ? [
          ...result.milestoneTokens.map((t) => [
            t.role,
            t.input,
            t.output,
            t.cacheRead,
            t.input + t.output,
          ]),
          [
            'Total',
            sum(result.milestoneTokens, (t) => t.input),
            sum(result.milestoneTokens, (t) => t.output),
            sum(result.milestoneTokens, (t) => t.cacheRead),
            sum(result.milestoneTokens, (t) => t.input + t.output),
          ],
        ]
      : [['none', 0, 0, 0, 0]]
  )
  const { total, cleanPulls } = result.tokens
  const perPull =
    total === null || cleanPulls === 0
      ? '—'
      : `${Math.round(total / cleanPulls)} (${total} tokens over ${cleanPulls} merged pull requests without a defect after merge)`
  const summary = `**Tokens per merged pull request without a later fix:** ${perPull}`
  const withCache =
    total === null || cleanPulls === 0
      ? '—'
      : `${Math.round((total + result.cacheReads) / cleanPulls)} (${total + result.cacheReads} tokens over ${cleanPulls} merged pull requests without a defect after merge)`
  const summaryCache = `**Tokens per merged pull request without a later fix, with cache reads:** ${withCache}`
  return (
    [
      `**metrics** · "${result.milestone}" · ${date}`,
      issues,
      pulls,
      categories,
      learnings,
      roles,
      summary,
      summaryCache,
    ].join('\n\n') + '\n'
  )
}

/**
 * 1 when the pull request's `time:` line says `report`, 0 when it has a note that does not, `—`
 * when it has none.
 */
function reportFirst(pull: PullRow): 0 | 1 | '—' {
  if (pull.time === null) return '—'
  return pull.time.report === null ? 0 : 1
}

/** `worker 1500 (cache 5000), reviewer 800`: input plus output by role; `—` when none. */
function tokensCell(tokens: RoleTokens[]): string {
  if (tokens.length === 0) return '—'
  return tokens
    .map(
      (t) => `${t.role} ${t.input + t.output}${t.cacheRead > 0 ? ` (cache ${t.cacheRead})` : ''}`
    )
    .join(', ')
}

function table(header: string[], rows: (string | number)[][]): string {
  const line = (cells: (string | number)[]): string =>
    `| ${cells.map((cell) => String(cell).replaceAll('|', '\\|')).join(' | ')} |`
  return [line(header), line(header.map(() => '---')), ...rows.map(line)].join('\n')
}
