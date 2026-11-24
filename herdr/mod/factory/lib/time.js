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
