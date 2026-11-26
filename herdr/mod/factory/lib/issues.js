// The issues of a milestone to rows: the track, the lane, the age of each wait and what blocks a
// blocked one.

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
 * @typedef {{ number: number, title?: string, state?: string, body?: string | null, created_at?: string, pull_request?: unknown }} Issue
 */

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
 * @returns {IssueRow[]}
 */
export function buildIssues({ issues, comments, maintainer, now, agents = [] }) {
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
        : dependsOn(issue.body).filter((n) => open.has(n) && n !== issue.number)
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
