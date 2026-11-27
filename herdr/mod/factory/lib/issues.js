// The issues of a milestone to rows: the track, the lane, the age of each wait and what blocks a
// blocked one.
//
// What is worked out from an issue's body (`dependsOn` here and in `board.js`, `parseProgress` of
// `detail.js` in `needs.js`) is kept, with the body, by the issue's repository, `number` and
// `updated_at` (`fromIssue`): a render asks for the same many times, and each read gives new objects
// of the same issues. An issue with no `updated_at`, or asked for with no repository, is worked out
// at each call. Bound of what is kept: one version of each issue asked for during the current and the
// previous run of `KEPT_ISSUE_CALLS` calls of `fromIssue`; an issue that no read returns any more is
// dropped after at most twice that many calls. It is memory only.

import { parseGates } from './gates.js'
import { ageMs } from './time.js'

/**
 * @typedef {object} IssueRow
 * @property {number} number
 * @property {string} title
 * @property {'express' | 'normal' | 'full'} lane
 * @property {boolean} calibration
 * @property {string[]} marks the six marks
 * @property {string} track the marks as letters
 * @property {string} label `G3-4·r1`, `BLOCKED` for a blocked issue
 * @property {boolean} needsYou a mark is `needs`
 * @property {number | null} waitMs how long the issue has waited since its last gate comment (its creation with none)
 * @property {number[]} blockedBy the open issues of the milestone its `## Depends on` names
 * @property {boolean} blocked an open issue with something that blocks it and no gate comment yet
 */

/**
 * An item of a milestone as REST returns it, the fields the model reads.
 *
 * @typedef {{ number: number, title?: string, state?: string, body?: string | null, created_at?: string, updated_at?: string, pull_request?: unknown }} Issue
 */

/**
 * The calls of `fromIssue` that make one run of what is kept: what was not asked for during a whole
 * run is dropped. A render calls it at most a few times for each open issue read, well under one run.
 */
export const KEPT_ISSUE_CALLS = 2000

/**
 * An issue's body and what was worked out from it, by the function that did.
 *
 * @typedef {{ updatedAt: string, body: unknown, said: Map<(body: unknown) => unknown, unknown> }} Kept
 */

/** What was asked for in this run, and in the run before it, by repository and number. */
let kept = /** @type {Map<string, Kept>} */ (new Map())
let before = /** @type {Map<string, Kept>} */ (new Map())
let calls = 0

/**
 * What `work` says of an issue's body. For an issue with an `updated_at`, of a repository, the body
 * is read and `work` run once: a later call for the same repository, number and `updated_at`, from
 * another object too, gives the same value without reading the body, so a caller must not change it.
 *
 * @template T
 * @param {Pick<Issue, 'number' | 'updated_at' | 'body'>} issue
 * @param {string | undefined} repo `owner/name`, `undefined` when the caller does not know it
 * @param {(body: unknown) => T} work a function declared once, not made at each call: the value is kept by it
 * @returns {T}
 */
export function fromIssue(issue, repo, work) {
  calls += 1
  if (calls >= KEPT_ISSUE_CALLS) {
    before = kept
    kept = new Map()
    calls = 0
  }
  const { number, updated_at: updatedAt } = issue
  if (repo === undefined || typeof updatedAt !== 'string') return work(issue.body)
  const key = `${repo}#${number}`
  let entry = kept.get(key) ?? before.get(key)
  if (entry === undefined || entry.updatedAt !== updatedAt) {
    entry = { updatedAt, body: issue.body, said: new Map() }
  }
  kept.set(key, entry)
  if (!entry.said.has(work)) entry.said.set(work, work(entry.body))
  return /** @type {T} */ (entry.said.get(work))
}

/**
 * The numbers of the issues a body's `## Depends on` section names (`- #296 (…)`).
 *
 * @param {unknown} body
 * @returns {number[]}
 */
export function dependsOn(body) {
  if (typeof body !== 'string') return []
  const section = /^##\s+Depends on\s*$([\s\S]*?)(?=^##\s|(?![\s\S]))/m.exec(body)
  if (section === null) return []
  return [...(section[1] ?? '').matchAll(/^\s*[-*]\s+#(\d+)\b/gm)].map((m) => Number(m[1]))
}

/**
 * Turns a milestone's issues into rows.
 *
 * @param {object} input
 * @param {Issue[]} input.issues the milestone's items as REST returns them; pull requests are left out
 * @param {Record<number, import('./gates.js').Comment[]>} input.comments each issue's comments
 * @param {string} input.maintainer the login whose comments count
 * @param {number} input.now milliseconds since the epoch
 * @param {{ issue: number | null, needsYou: boolean }[]} [input.agents] the agents (`parseAgents`)
 * @param {string} [input.repo] the repository of the issues, `owner/name`: with none, each body is read at each call
 * @returns {IssueRow[]}
 */
export function buildIssues({ issues, comments, maintainer, now, agents = [], repo }) {
  const own = issues.filter(
    (issue) => issue.pull_request === undefined || issue.pull_request === null
  )
  const open = new Set(own.filter((issue) => issue.state !== 'closed').map((issue) => issue.number))
  const waiting = new Set(agents.filter((a) => a.needsYou && a.issue !== null).map((a) => a.issue))
  return own
    .map((issue) => {
      const closed = issue.state === 'closed'
      const gates = parseGates({
        comments: comments[issue.number] ?? [],
        maintainer,
        closed,
        needsYou: waiting.has(issue.number),
      })
      const blockedBy = closed
        ? []
        : fromIssue(issue, repo, dependsOn).filter((n) => open.has(n) && n !== issue.number)
      const blocked = blockedBy.length > 0 && gates.rounds.length === 0
      const since = gates.since === null ? issue.created_at : new Date(gates.since).toISOString()
      return {
        number: issue.number,
        title: issue.title ?? '',
        lane: gates.lane,
        calibration: gates.calibration,
        marks: gates.marks,
        track: gates.track,
        label: blocked ? 'BLOCKED' : gates.label,
        needsYou: gates.marks.includes('needs'),
        waitMs: closed ? null : ageMs(now, since),
        blockedBy,
        blocked,
      }
    })
    .toSorted((a, b) => a.number - b.number)
}
