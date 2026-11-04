import {
  acceptedFindings,
  blockingByCategory,
  countLog,
  hasFindings,
  mergeTime,
  parseEvent,
  passedByMaster,
  parseTime,
  parseTokenLines,
} from './parse.js'
import type { TokenLine } from './parse.js'
import type { TimeLine } from './parse.js'
import { MARKER } from './ready.js'
import type { Source } from './source.js'

/** What `metrics` is asked: the milestone, and who counts as the maintainer. */
export interface MetricsOptions {
  /** The title of the milestone, as GitHub shows it. */
  milestone: string
  /**
   * The login whose comments count: the master posts as the maintainer, and the maintainer's
   * `time:` lines and review comments are the ones measured. Defaults to the login that opened the
   * lowest-numbered issue of the milestone, its epic.
   */
  maintainer?: string
  /** The text of `docs/factory-log.md`. */
  log: string
}

/** What the agents of one role reported over all the rounds of an issue. */
export interface RoleTokens {
  role: string
  input: number
  output: number
  cacheRead: number
}

/** The per-issue numbers, from the master's comments on the issue. */
export interface IssueRow {
  number: number
  title: string
  /** Comments that sent the issue back at gate 1, or a `lint-issue` report with a failing rule. */
  returned: number
  /** The highest review round of gate 3. */
  rounds: number
  /** Blocking findings raised over all the rounds. */
  blocking: number
  /** Mismatches the verifier found, over all its reports. */
  mismatches: number
  /** Important findings the worker justified and the master accepted (`accepted: n`, gate 3). */
  falseRedsGate3: number
  /** `Gate 4` comments whose first line says `passed by the master`. */
  falseRedsGate4: number
  /** The master's `tokens |` records by role, in the order the roles first appear; none: `[]`. */
  tokens: RoleTokens[]
  /**
   * The `Gate 3` and `Gate 4` comments with findings, when the issue has no `factory-log |`
   * comment; 0 when it has one.
   */
  unlogged: number
}

/** The per-pull-request numbers. */
export interface PullRow {
  number: number
  title: string
  /** The issue of the milestone the pull request closes or refers to, or `null`. */
  issue: number | null
  /** Added plus deleted lines. */
  lines: number
  /** Review comments on the diff by the maintainer. */
  corrections: number
  /**
   * Required checks that ended red on a commit pushed after the pull request opened, counted once
   * per commit and check.
   */
  redChecks: number
  /** The `unlogged` of its issue (see `IssueRow`), or 0 when it has none. */
  unlogged: number
  /** `fix` issues that cite the pull request, when it was merged. */
  defects: number
  /** The maintainer's `time:` notes put together, or `null` when there is none. */
  time: TimeLine | null
  /** Whether the pull request was merged. */
  merged: boolean
  /** The maintainer's reviews with no text and no inline comment, on a pull request with no `time:` note. */
  silentApprovals: number
  /** The `tokens |` records of its issue (shared by the pull requests of one issue). */
  tokens: RoleTokens[]
}

/** Everything `renderMetrics` prints. */
export interface Metrics {
  milestone: string
  issues: IssueRow[]
  pulls: PullRow[]
  /** Blocking findings by category, most frequent first. */
  categories: [string, number][]
  /** Rows of the correction log, and those with a Destination. */
  log: { rows: number; converted: number }
  /**
   * The tokens of the milestone: `total` is input plus output over every `tokens |` record of its
   * issues (cache reads are not added), `null` when there is none; `cleanPulls` counts the merged
   * pull requests with no defect after merge.
   */
  tokens: { total: number | null; cleanPulls: number }
}

const RED = new Set(['failure', 'timed_out', 'cancelled', 'action_required', 'startup_failure'])
const CLOSES = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d{1,7})\b/gi
const REFS = /\brefs?\s+#(\d{1,7})\b/gi

/**
 * Computes the factory's metrics for one milestone (`docs/factory.md`, "Metrics").
 *
 * @remarks
 * The issues are those of the milestone. The pull requests are those with the milestone and those
 * whose body says `Closes`, `Fixes`, `Resolves` or `Refs` followed by the number of one of its
 * issues, unless they belong to another milestone. Nothing is written to GitHub.
 *
 * @throws `Error` when no milestone has that title.
 */
export async function metrics(source: Source, options: MetricsOptions): Promise<Metrics> {
  const milestones = (await source.milestones()).map(object)
  const milestone = milestones.find((m) => m.title === options.milestone)
  if (milestone === undefined) {
    const titles = milestones.map((m) => `"${text(m.title)}"`).join(', ')
    throw new Error(`no milestone "${options.milestone}"; the repository has ${titles || 'none'}`)
  }
  const items = (await source.milestoneIssues(Number(milestone.number))).map(object)
  const issues = items.filter((item) => item.pull_request == null)
  const maintainer =
    options.maintainer ??
    text(object(issues.toSorted((a, b) => Number(a.number) - Number(b.number))[0]?.user).login)
  const numbers = new Set(issues.map((issue) => Number(issue.number)))

  const categories = new Map<string, number>()
  const issueRows: IssueRow[] = []
  for (const issue of issues) {
    const row: IssueRow = {
      number: Number(issue.number),
      title: text(issue.title),
      returned: 0,
      rounds: 0,
      blocking: 0,
      mismatches: 0,
      falseRedsGate3: 0,
      falseRedsGate4: 0,
      tokens: [],
      unlogged: 0,
    }
    let reviews = 0
    let findings = 0
    let logged = false
    for (const comment of (await source.comments(row.number)).map(object)) {
      const login = text(object(comment.user).login)
      if (login !== maintainer) {
        row.returned += await botReturns(source, login, comment)
        continue
      }
      const body = text(comment.body)
      if (/^factory-log \| /m.test(body)) logged = true
      const event = parseEvent(body)
      for (const line of parseTokenLines(body)) addTokens(row.tokens, line)
      if (hasFindings(body)) findings++
      if (event?.kind === 'returned') row.returned++
      if (event?.kind === 'verification') {
        row.mismatches += event.mismatches ?? 0
        if (passedByMaster(body)) row.falseRedsGate4++
      }
      if (event?.kind === 'review') {
        reviews++
        row.falseRedsGate3 += acceptedFindings(body)
        row.rounds = Math.max(row.rounds, event.round ?? 0, reviews)
        const found = blockingByCategory(body)
        const listed = [...found.values()].reduce((sum, n) => sum + n, 0)
        const total = event.blocking ?? listed
        row.blocking += total
        for (const [category, n] of found)
          categories.set(category, (categories.get(category) ?? 0) + n)
        if (total > listed) {
          categories.set('uncategorised', (categories.get('uncategorised') ?? 0) + total - listed)
        }
      }
    }
    row.unlogged = logged ? 0 : findings
    issueRows.push(row)
  }

  const fixes = (await source.allIssues())
    .map(object)
    .filter((item) => item.pull_request == null && /^fix\b/.test(text(item.title)))
  const required = new Map<string, Set<string>>()
  const pullRows: PullRow[] = []
  for (const listed of (await source.pulls()).map(object)) {
    const number = Number(listed.number)
    const other = object(listed.milestone).title
    const closes = issueOf(text(listed.body), numbers)
    if (other === undefined || other === null ? closes === undefined : other !== options.milestone)
      continue
    const detail = object(await source.pull(number))
    const branch = text(object(listed.base).ref) || 'main'
    if (!required.has(branch)) required.set(branch, new Set(await source.requiredChecks(branch)))
    const merged = typeof listed.merged_at === 'string'
    const time = await timeOf(source, number, maintainer)
    pullRows.push({
      number,
      title: text(listed.title),
      issue: closes ?? null,
      lines: Number(detail.additions ?? 0) + Number(detail.deletions ?? 0),
      corrections: (await source.reviewComments(number))
        .map(object)
        .filter((c) => text(object(c.user).login) === maintainer).length,
      redChecks: await redChecks(
        source,
        number,
        text(listed.created_at),
        required.get(branch) ?? new Set()
      ),
      unlogged: issueRows.find((row) => row.number === closes)?.unlogged ?? 0,
      defects: merged ? fixes.filter((fix) => cites(text(fix.body), number)).length : 0,
      time,
      merged,
      silentApprovals: await silentApprovals(source, number, maintainer, time),
      tokens: issueRows.find((row) => row.number === closes)?.tokens ?? [],
    })
  }
  const recorded = issueRows.flatMap((row) => row.tokens)
  return {
    milestone: options.milestone,
    issues: issueRows.toSorted((a, b) => a.number - b.number),
    pulls: pullRows.toSorted((a, b) => a.number - b.number),
    categories: [...categories].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
    log: (({ rows, converted }) => ({ rows, converted }))(countLog(options.log)),
    tokens: {
      total: recorded.length === 0 ? null : recorded.reduce((n, r) => n + r.input + r.output, 0),
      cleanPulls: pullRows.filter((pull) => pull.merged && pull.defects === 0).length,
    },
  }
}

/**
 * The maintainer's reviews, `APPROVED` or `COMMENTED`, with no text and no inline comment, on a pull
 * request with no `time:` note of the maintainer in any comment or review (`time` is `null`). A
 * review whose only text is a `time:` line has text, and gives the pull request a note: it is not
 * silent.
 */
async function silentApprovals(
  source: Source,
  number: number,
  maintainer: string,
  time: TimeLine | null
): Promise<number> {
  if (time !== null) return 0
  const inline = new Set(
    (await source.reviewComments(number)).map(object).map((c) => c.pull_request_review_id)
  )
  return (await source.reviews(number))
    .map(object)
    .filter(
      (r) =>
        text(object(r.user).login) === maintainer &&
        (r.state === 'APPROVED' || r.state === 'COMMENTED') &&
        text(r.body).trim() === '' &&
        !(r.id !== undefined && inline.has(r.id))
    ).length
}

/** Adds a `tokens |` record to the total of its role, keeping the order the roles first appear. */
function addTokens(into: RoleTokens[], line: TokenLine): void {
  const found = into.find((r) => r.role === line.role)
  if (found === undefined) {
    into.push({
      role: line.role,
      input: line.input,
      output: line.output,
      cacheRead: line.cacheRead,
    })
    return
  }
  found.input += line.input
  found.output += line.output
  found.cacheRead += line.cacheRead
}

/**
 * How often the `issue-ready` workflow's report went from passing, or from not existing, to
 * failing. The workflow posts one `lint-issue` comment and edits it in place, so the comment holds
 * only its last state; its edit history (GraphQL `userContentEdits`) holds the others. Each
 * version that fails when the one before it did not counts once: fail → pass counts 1 and
 * fail → pass → fail counts 2. The current text is the last version, in case the history lacks it.
 * Only an app's comment (a login ending `[bot]`, which no person can have) that starts with the
 * workflow's marker is read, so the bot's login is not needed; its `Gate` lines, if any, are not.
 */
async function botReturns(
  source: Source,
  login: string,
  comment: Record<string, unknown>
): Promise<number> {
  const current = text(comment.body)
  if (!login.endsWith('[bot]') || !current.startsWith(MARKER)) return 0
  const id = comment.node_id
  const edits = typeof id === 'string' ? (await source.commentEdits(id)).map(object) : []
  const versions = edits
    .toSorted((a, b) => text(a.editedAt).localeCompare(text(b.editedAt)))
    .map((edit) => text(edit.diff))
  let returns = 0
  let failing = false
  for (const body of [...versions, current]) {
    const fails = failingReport(body)
    if (fails && !failing) returns++
    failing = fails
  }
  return returns
}

/** Whether a body is the marker, then a `lint-issue` report with failing rules. */
function failingReport(body: string): boolean {
  if (!body.startsWith(MARKER)) return false
  const report = body.slice(MARKER.length).replace(/^\r?\n/, '')
  return (
    report.replaceAll('*', '').toLowerCase().startsWith('lint-issue') &&
    parseEvent(report)?.kind === 'returned'
  )
}

/**
 * The (commit, check) pairs that ended red among the commits pushed after `opened`, for the
 * required checks only. When the branch requires none, every check counts.
 */
async function redChecks(
  source: Source,
  number: number,
  opened: string,
  required: Set<string>
): Promise<number> {
  const red = new Set<string>()
  for (const item of (await source.commits(number)).map(object)) {
    const sha = text(item.sha)
    if (text(object(object(item.commit).committer).date) <= opened) continue
    for (const run of (await source.checkRuns(sha)).map(object)) {
      const name = text(run.name)
      if (RED.has(text(run.conclusion)) && (required.size === 0 || required.has(name))) {
        red.add(`${sha} ${name}`)
      }
    }
  }
  return red.size
}

/**
 * The `time:` lines the maintainer wrote in the pull request's comments or reviews, put together
 * with `mergeTime`: the latest over the earlier.
 */
async function timeOf(
  source: Source,
  number: number,
  maintainer: string
): Promise<TimeLine | null> {
  const written = [...(await source.comments(number)), ...(await source.reviews(number))]
    .map(object)
    .filter((item) => text(object(item.user).login) === maintainer)
    .sort((a, b) =>
      text(a.created_at ?? a.submitted_at).localeCompare(text(b.created_at ?? b.submitted_at))
    )
  let time: TimeLine | null = null
  for (const item of written) {
    const note = parseTime(text(item.body))
    if (note !== null) time = mergeTime(time, note)
  }
  return time
}

/** The issue of the set a body closes, or else refers to; `Closes` wins over `Refs`. */
function issueOf(body: string, numbers: Set<number>): number | undefined {
  for (const pattern of [CLOSES, REFS]) {
    const found = [...body.matchAll(pattern)].map((m) => Number(m[1])).find((n) => numbers.has(n))
    if (found !== undefined) return found
  }
  return undefined
}

function cites(body: string, pull: number): boolean {
  return [...body.matchAll(/(?<![\w/])#(\d{1,7})\b|\/pull\/(\d{1,7})\b/g)].some(
    (m) => Number(m[1] ?? m[2]) === pull
  )
}

function object(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}
