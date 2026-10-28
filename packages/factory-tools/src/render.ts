import type { Metrics, PullRow } from './metrics.js'

/**
 * The Markdown of a run of `metrics`: a header line, then the tables of the README; a totals row
 * ends the first two. A pull request without a `time:` line shows `—` in the three minutes columns;
 * with one, a column it does not give shows `—`, except that `diff` and `report` are alternatives,
 * so a note with one of them shows 0 in the other.
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
      'Minutes, Docker or test',
    ],
    [
      ...result.pulls.map((p) => [
        `#${p.number}`,
        p.issue === null ? '—' : `#${p.issue}`,
        p.lines,
        p.corrections,
        p.redChecks,
        p.defects,
        reading(p, 'diff'),
        reading(p, 'report'),
        p.time?.handsOn ?? '—',
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
        minutes('handsOn'),
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
