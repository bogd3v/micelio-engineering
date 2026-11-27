// An issue's comments to its rounds, the six marks of its track, its lane and whether it is a
// calibration run. The `held` mark is read from the line that issue #303 defines; until then no
// issue is held. The comments are the master's, posted under the maintainer's login
// (`herdr/master.md`): only that login counts, as in `factory-tools metrics`.
//
// A later comment of a gate resets what the gates after it said: the mark of G2 to G4 is that of the
// gate's last comment posted after the last comment of every earlier gate (G3 and G4 run together, so
// G4 counts from after gates 1 and 2), and G5 is passed only by a pull request opened after the last
// gate comment.
//
// What a comment says is worked out once and kept, with its body, by the comment's `id` and
// `updated_at` (`fromBody`): a render parses the same comments many times, and each 10 minutes a read
// gives new objects of the same comments. A comment with no `id` or no `updated_at` is worked out at
// each call. Bound of what is kept: one version of each comment asked for during the current and the
// previous run of `KEPT_CALLS` calls of `parseGates`; a comment that no read returns any more is
// dropped after at most twice that many calls. It is memory only.

import { toMs } from './time.js'

/** The letter of each mark in a track string such as `pprrtt` (`Panel.dc.html`). */
const MARK_LETTER = {
  passed: 'p',
  running: 'r',
  needs: 'n',
  held: 'h',
  red: 'x',
  notReached: 't',
  omitted: 's',
}

/** The lanes, and the gates each one omits (`docs/factory.md`, `L.2`). @type {Gates['lane'][]} */
const LANES = ['express', 'normal', 'full']
const OMITTED = { express: [3, 4], normal: [], full: [] }

/**
 * The calls of `parseGates` that make one run of the kept parse: what was not asked for during a
 * whole run is dropped. A render calls it a few times for each issue read, well under one run.
 */
export const KEPT_CALLS = 2000

/**
 * A comment as REST returns it, the fields the model reads.
 *
 * @typedef {{ user?: { login?: string }, body?: string, created_at?: string, id?: number, updated_at?: string }} Comment
 */

/**
 * A comment's body and what was worked out from it, by the function that did.
 *
 * @typedef {{ updatedAt: string | undefined, body: string, said: Map<(body: string) => unknown, unknown> }} Kept
 */

/**
 * @typedef {object} Round
 * @property {number} gate 1 to 4
 * @property {number | null} round the `round K` of the comment, `null` when it has none
 * @property {'passed' | 'red' | 'sentBack'} outcome
 * @property {number | null} blocking the `K Blocking` of a Gate 3 comment
 * @property {number | null} mismatches the `M mismatches` of a Gate 4 comment
 * @property {number} at milliseconds since the epoch of the comment
 * @property {string} summary what the comment's first line says after `Gate N, round K (agent)`, `''` when it says nothing
 */

/**
 * @typedef {object} Said what one comment says, whoever reads it
 * @property {string} line its first line without markup
 * @property {number | null} gate the digit of a first line that starts `Gate N`
 * @property {{ lane: Gates['lane'], calibration: boolean } | null} lane the lane line of a Gate 1 comment
 * @property {boolean} opened a `Progress updated` comment with `pull request #N opened`
 * @property {Omit<Round, 'at'> | null} round the round of a Gate 1 to 4 comment
 */

/**
 * @typedef {object} Gates
 * @property {'express' | 'normal' | 'full'} lane `full` when no Gate 1 comment has a lane line
 * @property {boolean} calibration the lane line reads `(calibration: full)`
 * @property {Round[]} rounds the Gate 1 to 4 comments, oldest first
 * @property {number} round the highest round number any of them names, 0 with none
 * @property {string[]} marks one mark for each of G1 to G6: `passed`, `running`, `needs`, `held`, `red`, `notReached` or `omitted`, the seven of the design's legend (`herdr/mod/design/README.md`, rule 5)
 * @property {string} track the marks as letters, `pprrtt`
 * @property {string} label where the issue is: `G3-4·r1`, `G5`, `G2·r1 HELD`, `G4·r1 RED`
 * @property {number | null} since milliseconds since the epoch of the last gate comment
 */

/** What was asked for in this run, and in the run before it, by comment id. */
let kept = /** @type {Map<number, Kept>} */ (new Map())
let before = /** @type {Map<number, Kept>} */ (new Map())
let calls = 0

/**
 * What `work` says of a comment's body, `null` when the comment has no body. For a comment with an
 * `id` and an `updated_at` the body is read and `work` run once: a later call of the same two, from
 * another object too, gives the same value without reading the body, so a caller must not change it.
 *
 * @template T
 * @param {{ id?: number | undefined, updated_at?: string | undefined, body?: string | null | undefined }} comment
 * @param {(body: string) => T} work a function declared once, not made at each call: the value is kept by it
 * @returns {T | null}
 */
export function fromBody(comment, work) {
  const { id, updated_at: updatedAt } = comment
  const keyed = typeof id === 'number' && typeof updatedAt === 'string'
  let entry = keyed ? (kept.get(id) ?? before.get(id)) : undefined
  if (entry === undefined || entry.updatedAt !== updatedAt) {
    const body = comment.body
    if (typeof body !== 'string') return null
    entry = { updatedAt, body, said: new Map() }
  }
  if (keyed) kept.set(id, entry)
  if (!entry.said.has(work)) entry.said.set(work, work(entry.body))
  return /** @type {T} */ (entry.said.get(work))
}

/** Counts a call of `parseGates`, and starts a new run after `KEPT_CALLS` of them. */
function countCall() {
  calls += 1
  if (calls < KEPT_CALLS) return
  before = kept
  kept = new Map()
  calls = 0
}

/**
 * The first line of a comment without its markup. Nothing after the first line break is read.
 *
 * @param {string} body
 * @returns {string}
 */
function firstLine(body) {
  const end = body.indexOf('\n')
  const line = end === -1 ? body : body.slice(0, body[end - 1] === '\r' ? end - 1 : end)
  return line
    .replaceAll(/<[^>]*>/g, '')
    .replaceAll('*', '')
    .replace(/^\s*#+\s*/, '')
    .trim()
}

/**
 * What a gate comment's first line says of its gate: the line without `Gate N`, `, round K` and the
 * agent in parentheses, and without the separator that follows them.
 *
 * @param {string} line the first line without markup
 * @returns {string}
 */
export function summaryOf(line) {
  return line
    .replace(/^gate \d\b/i, '')
    .replace(/^[\s,]*round \d+/i, '')
    .replace(/^\s*\([^)]*\)/, '')
    .replace(/^[\s·:,–—-]+/, '')
    .trim()
}

/**
 * The lane of a Gate 1 comment: the last `lane: <lane>` line, with or without `(calibration: full)`.
 *
 * @param {string} body
 * @param {string} first its first line without markup
 * @returns {{ lane: 'express' | 'normal' | 'full', calibration: boolean } | null}
 */
function laneOf(body, first) {
  /** @type {{ lane: 'express' | 'normal' | 'full', calibration: boolean } | null} */
  let found = null
  /** @param {string | undefined} word @param {string | undefined} mark */
  const take = (word, mark) => {
    const lane = LANES.find((name) => name === word?.toLowerCase())
    if (lane !== undefined) found = { lane, calibration: mark !== undefined && lane !== 'full' }
  }
  // The first line may carry it (`**Gate 1 (master)** · pass · lane: normal`).
  const inline = /\blane:\s*`?([a-z]+)`?(\s*\(calibration:\s*full\))?/i.exec(first)
  take(inline?.[1], inline?.[2])
  // A later line of its own wins; a fenced block is a tool's output (`lint-lane` prints `lane:`), not the master's.
  let fenced = false
  for (const line of body.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced
      continue
    }
    if (fenced) continue
    const match = /^\s*(?:[-*]\s+)?lane:\s*`?([a-z]+)`?(\s*\(calibration:\s*full\))?\s*$/i.exec(
      line
    )
    take(match?.[1], match?.[2])
  }
  return found
}

/**
 * What a Gate comment says of its gate, from its first line.
 *
 * @param {number} gate
 * @param {string} line the first line without markup
 * @returns {Pick<Round, 'outcome' | 'blocking' | 'mismatches'>}
 */
function outcomeOf(gate, line) {
  const lower = line.toLowerCase()
  const blocking = /(\d+)\s+blocking/.exec(lower)
  const mismatches = /(\d+)\s+mismatch/.exec(lower)
  const blockingN = blocking === null ? null : Number(blocking[1])
  const mismatchesN = mismatches === null ? null : Number(mismatches[1])
  /** @type {Round['outcome']} */
  let outcome = 'passed'
  if ((gate === 2 || gate === 3) && /^red\b/i.test(summaryOf(line))) outcome = 'red'
  else if (/sent back/.test(lower)) outcome = 'sentBack'
  else if (/not ready|not started|\bheld\b/.test(lower)) outcome = 'red'
  else if (gate === 3 && blockingN !== null && blockingN > 0) outcome = 'red'
  else if (gate === 4 && mismatchesN !== null && mismatchesN > 0) outcome = 'red'
  else if (gate === 4 && /\bred\b/.test(lower)) outcome = 'red'
  return { outcome, blocking: blockingN, mismatches: mismatchesN }
}

/**
 * What a comment says to the gates and to the other readers of its first line. The body is read past
 * its first line only for a Gate 1 comment (its lane line) and a `Progress updated` comment (its
 * `pull request #N opened`).
 *
 * @param {string} body
 * @returns {Said}
 */
export function saidOf(body) {
  const line = firstLine(body)
  const number = /^gate (\d)\b/i.exec(line)
  const gate = number === null ? null : Number(number[1])
  const round = /round (\d+)/i.exec(line)
  return {
    line,
    gate,
    lane: gate === 1 ? laneOf(body, line) : null,
    opened: /^progress updated/i.test(line) && /pull request #\d+ opened/i.test(body),
    round:
      gate === null || gate < 1 || gate > 4
        ? null
        : {
            gate,
            round: round === null ? null : Number(round[1]),
            summary: summaryOf(line),
            ...outcomeOf(gate, line),
          },
  }
}

/**
 * Reads an issue's comments. The mark of each of G2 to G4 is that of the gate's last comment, a
 * `sent back` one included (it runs), among those posted after the last comment of every earlier
 * gate, except that G4 counts from after the last comment of gates 1 and 2, not of gate 3; a gate
 * with none is not reached. G5 is passed by a `Progress updated … pull request #N opened` comment
 * posted after the last comment of gates 1 to 4.
 *
 * @param {object} input
 * @param {Comment[]} input.comments the issue's comments as REST returns them
 * @param {string} input.maintainer the login whose comments count
 * @param {boolean} [input.closed] the issue is closed: its pull request merged, so G5 and G6 passed
 * @param {boolean} [input.needsYou] an agent of the issue is blocked: the gate that runs needs the maintainer
 * @returns {Gates}
 */
export function parseGates({ comments, maintainer, closed = false, needsYou = false }) {
  countCall()
  const own = comments
    .filter((c) => c.user?.login === maintainer)
    .toSorted(
      (a, b) => (toMs(a.created_at) ?? 0) - (toMs(b.created_at) ?? 0) || (a.id ?? 0) - (b.id ?? 0)
    )
  let lane = /** @type {Gates['lane']} */ ('full')
  let calibration = false
  let opened = false
  /** @type {number | null} */
  let since = null
  /** @type {Round[]} */
  const rounds = []
  for (const comment of own) {
    const said = fromBody(comment, saidOf)
    if (said === null) continue
    if (said.lane !== null) {
      lane = said.lane.lane
      calibration = said.lane.calibration
    }
    if (said.opened) opened = true
    if (said.round === null) continue
    const at = toMs(comment.created_at) ?? 0
    rounds.push({ ...said.round, at })
    since = at
    opened = false
  }
  const omitted = calibration ? [] : OMITTED[lane]
  /** @type {string[]} */
  const marks = []
  let blocked = false
  for (let gate = 1; gate <= 6; gate++) {
    if (omitted.includes(gate)) {
      marks.push('omitted')
      continue
    }
    // `rounds` is in the order posted: what came before the last comment of an earlier gate is stale.
    const stale = rounds.findLastIndex((r) => r.gate < Math.min(gate, 3))
    const last = rounds
      .slice(stale + 1)
      .findLast((r) => r.gate === gate && (gate > 1 || r.outcome !== 'sentBack'))
    /** @type {string} */
    let mark
    if (closed) mark = 'passed'
    else if (gate <= 4) {
      if (last === undefined) mark = 'notReached'
      else mark = { passed: 'passed', red: 'red', sentBack: 'running' }[last.outcome]
    } else if (gate === 5) mark = opened ? 'passed' : 'notReached'
    else mark = 'notReached'
    if (blocked && !closed) mark = mark === 'omitted' ? mark : 'notReached'
    if (mark === 'red') blocked = true
    marks.push(mark)
  }
  if (!closed) settle(marks, rounds, needsYou)
  return {
    lane,
    calibration,
    rounds,
    round: Math.max(0, ...rounds.map((r) => r.round ?? 0)),
    marks,
    track: marks.map((m) => MARK_LETTER[/** @type {keyof typeof MARK_LETTER} */ (m)]).join(''),
    label: labelOf(marks, rounds),
    since,
  }
}

/**
 * Marks what runs now: the first gates not reached or sent back after the last passed one run, and
 * G5 needs the maintainer once every gate before it has passed or is omitted. A gate whose comments
 * all came before a later comment of an earlier gate is not reached, and is marked as any other. A
 * blocked agent turns the running gate into one that needs the maintainer.
 *
 * @param {string[]} marks changed in place
 * @param {Round[]} rounds
 * @param {boolean} needsYou
 */
function settle(marks, rounds, needsYou) {
  if (rounds.length === 0 || marks.includes('red')) return
  const live = marks.findIndex((m) => m === 'notReached' || m === 'running')
  if (live === -1) return
  const before = marks.slice(0, live).every((m) => m === 'passed' || m === 'omitted')
  if (!before) return
  if (live === 4) {
    marks[4] = 'needs'
    return
  }
  if (live === 5) {
    marks[5] = 'running'
    return
  }
  marks[live] = needsYou ? 'needs' : 'running'
  // Gates 3 and 4 run together (`pprrtt`): the reviewer and the verifier start in the same round.
  if (live === 2 && (marks[3] === 'notReached' || marks[3] === 'running')) marks[3] = marks[live]
}

/**
 * The label of where an issue is.
 *
 * @param {string[]} marks
 * @param {Round[]} rounds
 * @returns {string}
 */
function labelOf(marks, rounds) {
  const live = marks
    .map((m, i) => (['running', 'needs', 'held', 'red'].includes(m) ? i + 1 : 0))
    .filter((g) => g > 0)
  if (live.length === 0) return ''
  const first = live[0] ?? 0
  const last = live.at(-1) ?? first
  const span = first === last ? `G${first}` : `G${first}-${last}`
  const round = Math.max(0, ...rounds.map((r) => r.round ?? 0))
  const suffix = first <= 4 && round > 0 ? `·r${round}` : ''
  const tag = marks.includes('held') ? ' HELD' : marks.includes('red') ? ' RED' : ''
  return `${span}${suffix}${tag}`
}
