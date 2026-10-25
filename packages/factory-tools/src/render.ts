import type { Metrics } from './metrics.js'

/**
 * The Markdown of a run of `metrics`: a header line, then the tables of the README; a totals row
 * ends the first two. A pull request without a `time:` line shows `—` in both minutes columns.
 *
 * @param date - The day of the run, `YYYY-MM-DD`.
 */
export function renderMetrics(result: Metrics, date: string): string {
  const sum = <T>(items: T[], pick: (item: T) => number): number =>
    items.reduce((total, item) => total + pick(item), 0)
  const minutes = (kind: 'diff' | 'report'): number =>
    sum(result.pulls, (pull) => (pull.time?.kind === kind ? pull.time.minutes : 0))

  const issues = table(
    [
      'Issue',
      'Times returned at gate 1',
      'Gate 3 rounds',
      'Blocking findings',
      'Verifier mismatches',
    ],
    [
      ...result.issues.map((i) => [`#${i.number}`, i.returned, i.rounds, i.blocking, i.mismatches]),
      [
        'Total',
        sum(result.issues, (i) => i.returned),
        sum(result.issues, (i) => i.rounds),
        sum(result.issues, (i) => i.blocking),
        sum(result.issues, (i) => i.mismatches),
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
      'Defects after merge',
      'Minutes, diff',
      'Minutes, report',
    ],
    [
      ...result.pulls.map((p) => [
        `#${p.number}`,
        p.issue === null ? '—' : `#${p.issue}`,
        p.lines,
        p.corrections,
        p.redChecks,
        p.defects,
        p.time === null ? '—' : p.time.kind === 'diff' ? p.time.minutes : 0,
        p.time === null ? '—' : p.time.kind === 'report' ? p.time.minutes : 0,
      ]),
      [
        'Total',
        '',
        sum(result.pulls, (p) => p.lines),
        sum(result.pulls, (p) => p.corrections),
        sum(result.pulls, (p) => p.redChecks),
        sum(result.pulls, (p) => p.defects),
        minutes('diff'),
        minutes('report'),
      ],
    ]
  )
  const categories = table(
    ['Category of the Blocking findings', 'Findings'],
    result.categories.length ? result.categories : [['none', 0]]
  )
  const learnings = table(
    ['Correction log rows', 'With a destination'],
    [[result.log.rows, result.log.converted]]
  )
  return (
    [`**metrics** · "${result.milestone}" · ${date}`, issues, pulls, categories, learnings].join(
      '\n\n'
    ) + '\n'
  )
}

function table(header: string[], rows: (string | number)[][]): string {
  const line = (cells: (string | number)[]): string =>
    `| ${cells.map((cell) => String(cell).replaceAll('|', '\\|')).join(' | ')} |`
  return [line(header), line(header.map(() => '---')), ...rows.map(line)].join('\n')
}
