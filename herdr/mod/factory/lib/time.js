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
 *
 * @param {object} form
 * @param {'diff' | 'report'} form.read what was read first
 * @param {string | number} form.readMin its minutes
 * @param {'none' | 'stack' | 'test'} [form.hand] the hands-on check
 * @param {string | number} [form.handMin] its minutes
 * @param {string} [form.remark]
 * @param {'express' | 'normal' | 'full'} form.lane
 * @returns {{ line: string | null, error: string | null }}
 */
export function timeLine({ read, readMin, hand = 'none', handMin = '', remark = '', lane }) {
  const clauses = []
  if (!WHOLE.test(String(readMin).trim())) {
    return { line: null, error: 'Reading minutes: a whole number.' }
  }
  clauses.push(`${String(readMin).trim()}m ${read === 'report' ? 'report' : 'diff'}`)
  if (lane === 'full' && (hand === 'stack' || hand === 'test')) {
    if (!WHOLE.test(String(handMin).trim())) {
      return { line: null, error: 'Hands-on minutes: a whole number.' }
    }
    clauses.push(`${String(handMin).trim()}m ${hand}`)
  }
  const note = remark.replaceAll(/[()]/g, '').replaceAll(/\s+/g, ' ').trim()
  return { line: `time: ${clauses.join(', ')}${note === '' ? '' : ` (${note})`}`, error: null }
}
