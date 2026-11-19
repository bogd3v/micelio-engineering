import { readFile } from 'node:fs/promises'
import { errorLine } from './errors.js'
import { LOG_CATEGORIES, parseLogLines } from './parse.js'

/** A `factory-log |` line that breaks the format, and why. */
export interface LogProblem {
  /** The line, trimmed at the end. */
  line: string
  /** The 1-based number of the line in the text. */
  number: number
  /** What is wrong with it. */
  reason: string
}

/** The outcome of `runLintLog`: 0 when every line is right, 1 when one breaks the format, 2 on a usage or read error. */
export interface LintLogResult {
  code: 0 | 1 | 2
  stdout: string
  stderr: string
}

/** A `YYYY-MM-DD` that is a real calendar date. */
const isDate = (text: string): boolean => {
  if (!/^\d{4}-\d\d-\d\d$/.test(text)) return false
  const date = new Date(`${text}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(text)
}

const FORMAT = 'factory-log | <date> | <issue> | <what> | <category> | <destination>'

/**
 * Checks each line of a comment that starts `factory-log |` against the format of the correction
 * log in `herdr/master.md`: date, issue, what, category and destination, separated by ` | `. A line
 * breaks it when its date is not a `YYYY-MM-DD` date, its issue or its what is empty, its category (the
 * field before the last) is not one of `LOG_CATEGORIES`, its last field is empty (`-` is the
 * destination until the retro gives one), or `parseLogLines` would not read the same date, issue,
 * category and destination because a `|` lacks a space on a side. A `|` inside the what is kept. Other lines are ignored.
 *
 * @returns One problem per reason per line, in the order of the text; none when every line is right.
 */
export function lintLog(body: string): LogProblem[] {
  const problems: LogProblem[] = []
  const lines = body.split(/\r?\n/)
  lines.forEach((raw, index) => {
    if (!raw.startsWith('factory-log |')) return
    const line = raw.trimEnd()
    const before = problems.length
    const add = (reason: string): void => {
      problems.push({ line, number: index + 1, reason })
    }
    if (line.endsWith('|')) return add(`the last field is empty; write - for no destination`)
    // split on each `|`, not on ` | `: two neighbours share their spaces in `| |`
    const fields = line.split('|').map((part) => part.trim())
    if (fields.length < 6) {
      return add(
        `has ${fields.length - 1} fields after "factory-log |", at least 5 are needed (${FORMAT})`
      )
    }
    const [, date = '', issue = '', ...rest] = fields
    const destination = rest.pop() ?? ''
    const category = rest.pop() ?? ''
    if (!isDate(date)) add(`the date "${date}" is not YYYY-MM-DD`)
    if (issue === '') add('the issue is empty')
    if (rest.every((part) => part === '')) add('the what is empty')
    if (!LOG_CATEGORIES.has(category)) {
      add(
        `the category "${category}" is not one of ${[...LOG_CATEGORIES].join(', ')}; it is the field before the last`
      )
    }
    if (problems.length > before) return
    // the scribe and `metrics` read the line with `parseLogLines`, which splits on " | ": it must read the same fields
    const row = parseLogLines(line)[0]
    if (
      row?.date !== date ||
      row.issue !== issue ||
      row.category !== category ||
      row.destination !== (destination === '-' ? '' : destination)
    ) {
      add('the fields must be separated by " | " (a space on each side of every |)')
    }
  })
  return problems
}

/**
 * `factory-tools lint-log --file <path>`: reads a comment body and prints each `factory-log |` line
 * that breaks the format with its reason. Exit 0 when every such line is right (or there is none),
 * 1 when one breaks it, 2 on bad arguments or an unreadable file.
 */
export async function runLintLog(
  argv: string[],
  readText: (path: string) => Promise<string> = (path) => readFile(path, 'utf8')
): Promise<LintLogResult> {
  const args = argv.slice(1)
  const usage = (why: string): LintLogResult => ({
    code: 2,
    stdout: '',
    stderr: `${why}\nusage: factory-tools lint-log --file <path>\n`,
  })
  if (args.length !== 2 || args[0] !== '--file' || args[1] === undefined || args[1] === '') {
    return usage('give --file <path> and nothing else')
  }
  let body: string
  try {
    body = await readText(args[1])
  } catch (error) {
    return { code: 2, stdout: '', stderr: `cannot read ${args[1]}: ${errorLine(error)}\n` }
  }
  const problems = lintLog(body)
  if (problems.length === 0)
    return { code: 0, stdout: 'every factory-log line is right\n', stderr: '' }
  const out = problems.map((p) => `line ${p.number}: ${p.reason}\n  ${p.line}\n`).join('')
  return { code: 1, stdout: `${problems.length} problem(s)\n${out}`, stderr: '' }
}
