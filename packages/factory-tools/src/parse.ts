/**
 * A `time:` note: the maintainer's minutes on one pull request. Each field is `null` when the note
 * does not give it.
 */
export interface TimeLine {
  /** Minutes reading the diff first. */
  diff: number | null
  /** Minutes reading the reports first. */
  report: number | null
  /** Minutes of the hands-on check, on Docker or as a test (`docker` or `test` in the note). */
  handsOn: number | null
}

/** A comment of the master that `metrics` counts, read from its first line. */
export type GateEvent =
  | { kind: 'returned' }
  | { kind: 'review'; round: number | null; blocking: number | null }
  | { kind: 'verification'; mismatches: number | null }

const TIME = /^\s*time:\s*(.*)$/i
const MINUTES = '(\\d{1,6})\\s*(?:m|mins?|minutes?)'
const SPENT = new RegExp(`^${MINUTES}\\s+(diff|report|docker|test)$`, 'i')
const CHECKED = new RegExp(`^maintainer's\\s+(?:docker|test)\\s+check\\s+${MINUTES}$`, 'i')
const NOT_GIVEN = /^(?:diff|report)\s+(?:read\s+)?(?:time\s+)?(?:was\s+)?not\s+(?:stated|given)$/i

/**
 * Reads one `time:` line, in the forms the maintainer writes: a comma-separated list of
 * `<n>m diff`, `<n>m report`, `<n>m docker` and `<n>m test` (the unit is `m`, `min`, `mins`,
 * `minute` or `minutes`), `diff read not stated` (or `not given`), and
 * `maintainer's Docker check <n>m`. A remark may follow in parentheses or after a full stop. Any
 * other clause, or no minutes at all, makes the line no note.
 */
function parseTimeLine(rest: string): TimeLine | null {
  const note: TimeLine = { diff: null, report: null, handsOn: null }
  let found = false
  const [clauses = ''] = rest.split(/\s*\(|\.(?:\s|$)/, 1)
  for (const clause of clauses.split(',').map((part) => part.trim())) {
    if (NOT_GIVEN.test(clause)) continue
    const spent = SPENT.exec(clause)
    const checked = CHECKED.exec(clause)
    const minutes = Number(spent?.[1] ?? checked?.[1])
    if (Number.isNaN(minutes)) return null
    const kind = (spent?.[2] ?? 'docker').toLowerCase()
    if (kind === 'diff' || kind === 'report') note[kind] = minutes
    else note.handsOn = (note.handsOn ?? 0) + minutes
    found = true
  }
  return found ? note : null
}

/**
 * Finds the `time:` line of a comment or review, such as `time: 10m diff`,
 * `time: 5 minutes report`, `time: 3m diff, 0m docker`, `time: 2m diff, 2m test (the admin page)`
 * or `time: diff read not stated, 2m test`. The line starts with `time:`, case does not matter.
 *
 * @returns The last such line of the text, or `null` when there is none. A line that gives a
 * diff or report time replaces the earlier ones; a line without it (`time: 2m docker`) keeps the
 * earlier diff or report time, and one that gives a hands-on time replaces the earlier one.
 */
export function parseTime(text: string): TimeLine | null {
  let found: TimeLine | null = null
  for (const line of text.split(/\r?\n/)) {
    const rest = TIME.exec(line)?.[1]
    const note = rest === undefined ? null : parseTimeLine(rest)
    if (note !== null) found = mergeTime(found, note)
  }
  return found
}

/** Puts a later note over an earlier one the way `parseTime` does with the lines of a text. */
export function mergeTime(earlier: TimeLine | null, later: TimeLine): TimeLine {
  const reading = later.diff !== null || later.report !== null ? later : earlier
  return {
    diff: reading?.diff ?? null,
    report: reading?.report ?? null,
    handsOn: later.handsOn ?? earlier?.handsOn ?? null,
  }
}

/**
 * Reads what a comment of the master reports from its first line, the way the master writes it:
 * `**Gate 1 …: not ready**` or `…held, not started` (the issue went back); `**Gate 3, round N …**`
 * with `K Blocking` (a review round; without `round N` its round is `null`); `**Gate 4 …**` with
 * `K mismatch(es)` (a verification, which may also be headed `# Gate 4 report: …`,
 * `# Verification report: …` or a `<details><summary><b>Gate 4 …` summary: the markup of the first
 * line is not read); and a
 * `**lint-issue** · … · K of 7 rules fail` report (the issue went back). A count that is not in the
 * first line is `null` for a review, and for a verification it is read from the report's
 * `**Mismatches: K.**` line.
 *
 * @returns `null` for any other comment.
 */
export function parseEvent(body: string): GateEvent | null {
  const first = (body.split(/\r?\n/, 1)[0] ?? '')
    .replaceAll(/<[^>]*>/g, '')
    .replaceAll('*', '')
    .replace(/^\s*#+\s*/, '')
  const lower = first.toLowerCase()
  if (lower.startsWith('lint-issue')) {
    return /\d+ of \d+ rules fail/.test(lower) ? { kind: 'returned' } : null
  }
  if (lower.startsWith('gate 1')) {
    return /\bnot (?:ready|started)\b|\bheld\b/.test(lower) ? { kind: 'returned' } : null
  }
  if (lower.startsWith('gate 3')) {
    const round = /\bround\s+(\d{1,4})\b/.exec(lower)?.[1]
    return {
      kind: 'review',
      round: round === undefined ? null : Number(round),
      blocking: count(lower, 'blocking'),
    }
  }
  if (lower.startsWith('gate 4') || lower.startsWith('verification report')) {
    return { kind: 'verification', mismatches: count(lower, 'mismatch') ?? mismatchLine(body) }
  }
  return null
}

function count(line: string, word: string): number | null {
  const match = new RegExp(`(\\d{1,6})\\s+${word}`).exec(line)
  return match?.[1] === undefined ? null : Number(match[1])
}

/** The `**Mismatches: N.**` line a verifier's report ends its comparison with, or `null`. */
function mismatchLine(body: string): number | null {
  for (const line of body.split(/\r?\n/)) {
    const match = /^\*\*mismatches:\s*(\d{1,6})\b/i.exec(line)
    if (match?.[1] !== undefined) return Number(match[1])
  }
  return null
}

const UNCATEGORISED = 'uncategorised'

/**
 * Counts the Blocking findings of a review report by category. A finding is a line that starts
 * `**B<n>.` and its category is the section 11 check that the `## ` heading above it starts with,
 * without its number (`## 1. Correctness and edge cases` is `Correctness`): `Correctness`,
 * `Contracts`, `Security`, `Tests`, `Documentation` (or `Docs`) and `Scope`. Any other heading, or
 * none, is `uncategorised`.
 */
export function blockingByCategory(body: string): Map<string, number> {
  const found = new Map<string, number>()
  let category = UNCATEGORISED
  for (const line of body.split(/\r?\n/)) {
    if (line.startsWith('## ')) {
      category = checkOf(line.slice(3))
    } else if (/^\*\*B\d+\./.test(line)) {
      found.set(category, (found.get(category) ?? 0) + 1)
    }
  }
  return found
}

const CHECKS: [RegExp, string][] = [
  [/^correctness/i, 'Correctness'],
  [/^contracts?/i, 'Contracts'],
  [/^security/i, 'Security'],
  [/^tests?\b/i, 'Tests'],
  [/^(?:documentation|docs?)\b/i, 'Documentation'],
  [/^scope/i, 'Scope'],
]

function checkOf(heading: string): string {
  const title = heading
    .replace(/^\d+\.\s*/, '')
    .replaceAll(/[`"*]/g, '')
    .trim()
  return CHECKS.find(([pattern]) => pattern.test(title))?.[1] ?? UNCATEGORISED
}

/** One `factory-log |` line. */
export interface LogLine {
  date: string
  issue: string
  what: string
  category: string
  /** The check, skill or rule it became; empty until the retro gives one (`-` in the line). */
  destination: string
}

/** The categories of `docs/factory-log.md`. */
const LOG_CATEGORIES = new Set(['lint', 'test', 'skill', 'standard', 'issue', 'docs'])

/**
 * Reads the lines of the form `factory-log | <date> | <issue> | <what> | <category> | <destination>`
 * out of a comment, where a `-` destination is empty. The older form without the destination is
 * read too: the last field is then the category. Other lines are ignored, and a `|` inside the
 * `what` is kept.
 */
export function parseLogLines(body: string): LogLine[] {
  const lines: LogLine[] = []
  for (const line of body.split(/\r?\n/)) {
    if (!line.startsWith('factory-log | ')) continue
    const [, date = '', issue = '', ...rest] = line.split(' | ').map((part) => part.trim())
    let destination = ''
    if (rest.length > 2 && LOG_CATEGORIES.has(rest.at(-2) ?? '')) {
      destination = rest.pop() ?? ''
      if (destination === '-') destination = ''
    }
    const category = rest.pop() ?? ''
    if (/^\d{4}-\d\d-\d\d$/.test(date) && rest.length > 0 && category !== '') {
      lines.push({ date, issue, what: rest.join(' | '), category, destination })
    }
  }
  return lines
}

/**
 * Counts the rows of `docs/factory-log.md` and those with a Destination. A row is a table line
 * that starts with a date; its Destination is the fifth cell.
 */
export function countLog(markdown: string): { rows: number; converted: number } {
  let rows = 0
  let converted = 0
  for (const line of markdown.split(/\r?\n/)) {
    if (!/^\|\s*\d{4}-\d\d-\d\d\s*\|/.test(line)) continue
    const cells = line
      .trim()
      .replace(/^\||\|$/g, '')
      .split(/(?<!\\)\|/)
    rows++
    if ((cells[4] ?? '').trim() !== '') converted++
  }
  return { rows, converted }
}
