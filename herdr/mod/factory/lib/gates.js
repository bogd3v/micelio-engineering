// An issue's comments to its rounds, the six marks of its track, its lane and whether it is a
// calibration run. The `held` mark is read from the line that issue #303 defines; until then no
// issue is held. The comments are the master's, posted under the maintainer's login
// (`herdr/master.md`): only that login counts, as in `factory-tools metrics`.

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

/** The lanes, and the gates each one omits (`docs/factory.md`, `L.2`). */
const LANES = ['express', 'normal', 'full']
const OMITTED = { express: [3, 4], normal: [], full: [] }

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

/**
 * The first line of a comment without its markup.
 *
 * @param {string} body
 * @returns {string}
 */
function firstLine(body) {
  return (body.split(/\r?\n/, 1)[0] ?? '')
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
 * @returns {{ lane: 'express' | 'normal' | 'full', calibration: boolean } | null}
 */
function laneOf(body) {
  if (!/^gate 1\b/i.test(firstLine(body))) return null
  /** @type {{ lane: 'express' | 'normal' | 'full', calibration: boolean } | null} */
  let found = null
  /** @param {string | undefined} word @param {string | undefined} mark */
  const take = (word, mark) => {
    const lane = LANES.find((name) => name === word?.toLowerCase())
    if (lane !== undefined) found = { lane, calibration: mark !== undefined && lane !== 'full' }
  }
  // The first line may carry it (`**Gate 1 (master)** · pass · lane: normal`).
  const inline = /\blane:\s*`?([a-z]+)`?(\s*\(calibration:\s*full\))?/i.exec(firstLine(body))
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
  if (/sent back/.test(lower)) outcome = 'sentBack'
  else if (/not ready|not started|\bheld\b/.test(lower)) outcome = 'red'
  else if (gate === 3 && blockingN !== null && blockingN > 0) outcome = 'red'
  else if (gate === 4 && mismatchesN !== null && mismatchesN > 0) outcome = 'red'
  else if (gate === 4 && /\bred\b/.test(lower)) outcome = 'red'
  return { outcome, blocking: blockingN, mismatches: mismatchesN }
}

/**
 * Reads an issue's comments.
 *
 * @param {object} input
 * @param {{ user?: { login?: string }, body?: string, created_at?: string, id?: number }[]} input.comments the issue's comments as REST returns them
 * @param {string} input.maintainer the login whose comments count
 * @param {boolean} [input.closed] the issue is closed: its pull request merged, so G5 and G6 passed
 * @param {boolean} [input.needsYou] an agent of the issue is blocked: the gate that runs needs the maintainer
 * @returns {Gates}
 */
export function parseGates({ comments, maintainer, closed = false, needsYou = false }) {
  const own = comments
    .filter((c) => c.user?.login === maintainer && typeof c.body === 'string')
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
    const body = comment.body ?? ''
    const at = toMs(comment.created_at) ?? 0
    const line = firstLine(body)
    const laneLine = laneOf(body)
    if (laneLine !== null) {
      lane = laneLine.lane
      calibration = laneLine.calibration
    }
    if (/pull request #\d+ opened/i.test(body) && /^progress updated/i.test(line)) opened = true
    const gate = /^gate (\d)\b/i.exec(line)
    if (gate === null) continue
    const n = Number(gate[1])
    if (n < 1 || n > 4) continue
    const round = /round (\d+)/i.exec(line)
    rounds.push({
      gate: n,
      round: round === null ? null : Number(round[1]),
      at,
      summary: summaryOf(line),
      ...outcomeOf(n, line),
    })
    since = at
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
    const verdicts = rounds.filter((r) => r.gate === gate && r.outcome !== 'sentBack')
    const last = verdicts.at(-1)
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
 * Marks what runs now: the first gates not reached after the last passed one run, and G5 needs the
 * maintainer once every gate before it has passed or is omitted. A blocked agent turns the running
 * gate into one that needs the maintainer.
 *
 * @param {string[]} marks changed in place
 * @param {Round[]} rounds
 * @param {boolean} needsYou
 */
function settle(marks, rounds, needsYou) {
  if (rounds.length === 0 || marks.includes('red')) return
  const live = marks.findIndex((m) => m === 'notReached')
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
  if (live === 2 && marks[3] === 'notReached') marks[3] = needsYou ? 'needs' : 'running'
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
