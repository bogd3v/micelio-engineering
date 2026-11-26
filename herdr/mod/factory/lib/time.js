// Time helpers of the model. No function of the model reads the clock: `now` is always an argument.

/**
 * The milliseconds since the epoch of a timestamp as `gh api` or `factory-slot.sh status` prints it
 * (`2026-11-24T10:32:35Z`, or `2026-11-24T10:32:35-0500` with an offset of no colon).
 * `null` for anything that is not a timestamp.
 *
 * @param {unknown} text
 * @returns {number | null}
 */
export function toMs(text) {
  if (typeof text !== 'string') return null
  const ms = Date.parse(text.replace(/([+-]\d\d)(\d\d)$/, '$1:$2'))
  return Number.isNaN(ms) ? null : ms
}

/**
 * How long ago a timestamp was, in milliseconds, never below 0. `null` when `since` is not a
 * timestamp.
 *
 * @param {number} now milliseconds since the epoch
 * @param {unknown} since a timestamp
 * @returns {number | null}
 */
export function ageMs(now, since) {
  const at = toMs(since)
  return at === null ? null : Math.max(0, now - at)
}

/** How long a sign-off or an answer waits, and can be undone, before it is sent (ADR-0004, decision 4). */
export const SEND_DELAY_MS = 10_000

/**
 * The whole minutes since the diff was opened, never below 1: the time form's first value.
 *
 * @param {number} now milliseconds since the epoch
 * @param {number | null | undefined} openedAt when the diff was opened
 * @returns {number | null} `null` when it was not opened
 */
export function minutesSince(now, openedAt) {
  if (openedAt === null || openedAt === undefined) return null
  return Math.max(1, Math.floor((now - openedAt) / 60_000))
}

const WHOLE = /^\d{1,3}$/

/**
 * The `time:` line of the time form (`herdr/master.md`, "Lines from the mod"): `time: <minutes>m
 * diff|report[, <minutes>m stack|test][ (<remark>)]`. The hands-on check is only in `full`, and a
 * remark loses its parentheses and its line breaks, so the line stays one line the master can read back.
 * `read: 'none'` (the log form's "Noted": the diff or the reports were noted before) leaves the
 * reading clause out, and a line with no clause at all is an error.
 *
 * @param {object} form
 * @param {string} form.read what was read first: `none`, `diff` or `report`
 * @param {string | number} [form.readMin] its minutes
 * @param {string} [form.hand] the hands-on check: `none`, `stack` or `test`
 * @param {string | number} [form.handMin] its minutes
 * @param {string} [form.remark]
 * @param {string} form.lane `express`, `normal` or `full`
 * @returns {{ line: string | null, error: string | null }}
 */
export function timeLine({ read, readMin = '', hand = 'none', handMin = '', remark = '', lane }) {
  const clauses = []
  if (read !== 'none') {
    if (!WHOLE.test(String(readMin).trim())) {
      return { line: null, error: 'Reading minutes: a whole number.' }
    }
    clauses.push(`${String(readMin).trim()}m ${read === 'report' ? 'report' : 'diff'}`)
  }
  if (lane === 'full' && (hand === 'stack' || hand === 'test')) {
    if (!WHOLE.test(String(handMin).trim())) {
      return { line: null, error: 'Hands-on minutes: a whole number.' }
    }
    clauses.push(`${String(handMin).trim()}m ${hand}`)
  }
  if (clauses.length === 0) return { line: null, error: 'Give at least one time.' }
  const note = remark.replaceAll(/[()]/g, '').replaceAll(/\s+/g, ' ').trim()
  return { line: `time: ${clauses.join(', ')}${note === '' ? '' : ` (${note})`}`, error: null }
}

/**
 * How a line names an issue: `#N` for a number, the reference itself (`#N` or `owner/repo#N`) for a string.
 *
 * @param {number | string} issue
 * @returns {string}
 */
export const refText = (issue) => (typeof issue === 'number' ? `#${issue}` : issue)

/**
 * The line the log form sends: `time #N: <the time line>` (`time owner/repo#N: …` for an issue of
 * another repository of the space).
 *
 * @param {number | string} issue the issue the pull request closes: its number, or its reference
 * @param {string} line a line `time: …`
 * @returns {string}
 */
export const timeMessage = (issue, line) => `time ${refText(issue)}: ${line}`

/**
 * The whole minutes a hands-on timer ran, added to what the field held, never below 1 for a run.
 *
 * @param {string | number} held the field's minutes
 * @param {number} startedAt when the timer started, milliseconds since the epoch
 * @param {number} now
 * @returns {string}
 */
export function stopTimer(held, startedAt, now) {
  const before = WHOLE.test(String(held).trim()) ? Number(String(held).trim()) : 0
  return String(before + Math.max(1, Math.floor((now - startedAt) / 60_000)))
}

/**
 * The timer's label: `START TIMER`, or `STOP · m:ss` while it runs.
 *
 * @param {number | null} startedAt
 * @param {number} now
 * @returns {string}
 */
export function timerLabel(startedAt, now) {
  if (startedAt === null) return 'START TIMER'
  const s = Math.max(0, Math.floor((now - startedAt) / 1000))
  return `STOP · ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

const MINUTES = String.raw`\d{1,6}\s*(?:m|mins?|minutes?)`
const CLAUSE = new RegExp(
  `^(?:${MINUTES}\\s+(?:diff|report|stack|docker|test)|maintainer's\\s+(?:stack|docker|test)\\s+check\\s+${MINUTES}|(?:diff|report)\\s+(?:read\\s+)?(?:time\\s+)?(?:was\\s+)?not\\s+(?:stated|given))$`,
  'i'
)

/**
 * Whether a comment or review holds a `time:` note, as `factory-tools metrics` reads one
 * (`packages/factory-tools/src/parse.ts`): a line that starts `time:` whose clauses, before a remark in
 * parentheses or after a full stop, are all minutes with a kind and give at least one minute.
 *
 * @param {string | null | undefined} text
 * @returns {boolean}
 */
export function hasTimeNote(text) {
  for (const line of (text ?? '').split(/\r?\n/)) {
    const rest = /^\s*time:\s*(.*)$/i.exec(line)?.[1]
    if (rest === undefined) continue
    const [clauses = ''] = rest.split(/\s*\(|\.(?:\s|$)/, 1)
    const parts = clauses.split(',').map((part) => part.trim())
    if (parts.every((c) => CLAUSE.test(c)) && parts.some((c) => !/^(?:diff|report)\s/i.test(c))) {
      return true
    }
  }
  return false
}
