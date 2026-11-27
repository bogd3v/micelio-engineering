// What the panel does about GitHub's REST quota (5000 calls an hour for the account, shared by every tool
// on the host): the parser of a `gh api <endpoint> --include` reply, the pace of the slow read from the
// last `X-Ratelimit-*` headers, the rule that rereads an issue's comments only when it changed,
// whether a slow read happens at all, the pause of a secondary rate limit and when `rate_limit` is
// read for the GraphQL points. No program is run here (a read is an argument), and nothing is written:
// what `createRateLimitWatch` holds is in memory (ADR-0004, Decision 7: no token, and no ETag, body,
// quota or pause written to a file).

/** Comments and reviews are read again when the last read of them is this old. */
export const COMMENTS_MAX_AGE_MS = 10 * 60_000

/** The pace is `slow` while fewer calls than this remain. */
const SLOW_BELOW = 500

/** At the `slow` pace, at most one slow read in this time. */
const SLOW_EVERY_MS = 5 * 60_000

/** The first pause of a secondary limit that names no `Retry-After`; each further one doubles it. */
const BACKOFF_MS = 60_000

/** The longest pause a secondary limit with no `Retry-After` gives. */
const BACKOFF_MAX_MS = 15 * 60_000

/**
 * @typedef {object} Reply
 * @property {number | null} status the code of the status line (`HTTP/2.0 304 Not Modified`), `null` when there is none
 * @property {Record<string, string>} headers by lowercase name
 * @property {string} body what follows the empty line
 * @property {string | null} etag the `Etag` header
 * @property {number | null} remaining the `X-Ratelimit-Remaining` header
 * @property {number | null} reset the `X-Ratelimit-Reset` header: UTC epoch seconds
 * @property {number | null} retryAfter the `Retry-After` header: whole seconds
 */

/**
 * @typedef {object} Backoff
 * @property {number} until when the pause ends, milliseconds since the epoch
 * @property {number} streak how many secondary replies came in a row
 */

/**
 * @typedef {object} Quota
 * @property {number} remaining
 * @property {number} reset UTC epoch seconds
 */

/** @param {string | undefined} value @returns {number | null} */
const whole = (value) => {
  if (value === undefined || !/^\d+$/.test(value.trim())) return null
  return Number(value.trim())
}

/**
 * Splits the output of `gh api <endpoint> --include` into its status code, its headers (names compared
 * case-insensitively) and its body. Lines end in `\r\n`. An output with no status line is all body.
 *
 * @param {string} text
 * @returns {Reply}
 */
export function parseReply(text) {
  const empty = {
    status: null,
    headers: {},
    body: text,
    etag: null,
    remaining: null,
    reset: null,
    retryAfter: null,
  }
  const status = /^HTTP\/\S+\s+(\d{3})/.exec(text)
  if (status === null) return empty
  const end = /\r?\n\r?\n/.exec(text)
  const head = end === null ? text : text.slice(0, end.index)
  const body = end === null ? '' : text.slice(end.index + end[0].length)
  /** @type {Record<string, string>} */
  const headers = {}
  for (const line of head.split(/\r?\n/).slice(1)) {
    const colon = line.indexOf(':')
    if (colon > 0) headers[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim()
  }
  return {
    status: Number(status[1]),
    headers,
    body,
    etag: headers['etag'] ?? null,
    remaining: whole(headers['x-ratelimit-remaining']),
    reset: whole(headers['x-ratelimit-reset']),
    retryAfter: whole(headers['retry-after']),
  }
}

/** The `message` of a body GitHub answers an error with, `''` for any other body. @param {string} body */
const messageOf = (body) => {
  try {
    const message = /** @type {{ message?: unknown } | null} */ (JSON.parse(body))?.message
    return typeof message === 'string' ? message : ''
  } catch {
    // A body that is not JSON has no message: the status and the headers still tell the limit.
    return ''
  }
}

/**
 * Whether a reply is a secondary rate limit: a `429`, or a `403` with `Retry-After` or whose
 * `message` names a secondary rate limit. With `X-Ratelimit-Remaining: 0` it is the primary limit,
 * which `paceOf` stops on, and the answer is `false`.
 *
 * @param {Reply} reply
 * @returns {boolean}
 */
export function secondaryOf({ status, remaining, retryAfter, body }) {
  if (remaining === 0) return false
  if (status === 429) return true
  return status === 403 && (retryAfter !== null || /secondary rate limit/i.test(messageOf(body)))
}

/**
 * The pause after a reply. A secondary limit pauses for its `Retry-After`, or else for 60 s doubled on
 * each further secondary reply in a row, at most 15 minutes. A `200` or a `304` gives `null`; any
 * other reply gives `previous`.
 *
 * @param {Backoff | null} previous
 * @param {Reply} reply
 * @param {number} now milliseconds since the epoch
 * @returns {Backoff | null}
 */
export function backoffOf(previous, reply, now) {
  if (reply.status === 200 || reply.status === 304) return null
  if (!secondaryOf(reply)) return previous
  const streak = (previous?.streak ?? 0) + 1
  const wait =
    reply.retryAfter === null
      ? Math.min(BACKOFF_MS * 2 ** (streak - 1), BACKOFF_MAX_MS)
      : reply.retryAfter * 1000
  return { until: now + wait, streak }
}

/**
 * Whether the pause of a secondary limit still runs.
 *
 * @param {Backoff | null} backoff
 * @param {number} now milliseconds since the epoch
 * @returns {backoff is Backoff}
 */
export function isPaused(backoff, now) {
  return backoff !== null && now < backoff.until
}

/**
 * The pace of the slow read: `normal` every 60 s; `slow` while `remaining` is below 500 and the reset
 * is in the future; `stopped` while `remaining` is 0 and the reset is in the future. Once the reset
 * time has passed it is `normal` again, and so it is when no reply has given a quota yet.
 *
 * @param {Quota | null} quota the last `X-Ratelimit-Remaining` and `X-Ratelimit-Reset` any reply gave
 * @param {number} now milliseconds since the epoch
 * @returns {'normal' | 'slow' | 'stopped'}
 */
export function paceOf(quota, now) {
  if (quota === null || quota.reset * 1000 <= now) return 'normal'
  if (quota.remaining <= 0) return 'stopped'
  return quota.remaining < SLOW_BELOW ? 'slow' : 'normal'
}

/**
 * Whether the slow read of GitHub happens on this tick: never while the window is hidden
 * (`window()?.visible === false`) or the pace is `stopped`; at the `slow` pace, once every 5 minutes.
 *
 * @param {object} input
 * @param {'normal' | 'slow' | 'stopped'} input.pace
 * @param {number | null} input.lastAt when GitHub was last read, milliseconds since the epoch
 * @param {number} input.now
 * @param {boolean | undefined} input.visible `window()?.visible`
 * @returns {boolean}
 */
export function readsNow({ pace, lastAt, now, visible }) {
  if (visible === false || pace === 'stopped') return false
  if (pace === 'slow') return lastAt === null || now - lastAt >= SLOW_EVERY_MS
  return true
}

/**
 * Whether the comments of an issue or a pull request are read again: when its `updated_at` is not the
 * one seen at the last read of them, when none were read, or when the last read is 10 minutes old.
 *
 * @param {{ updatedAt: unknown, at: number } | undefined} seen what the last read of them recorded
 * @param {unknown} updatedAt the `updated_at` of its list now
 * @param {number} now milliseconds since the epoch
 * @returns {boolean}
 */
export function commentsDue(seen, updatedAt, now) {
  return seen === undefined || seen.updatedAt !== updatedAt || now - seen.at >= COMMENTS_MAX_AGE_MS
}

/**
 * The GraphQL points of the account.
 *
 * @typedef {object} Graphql
 * @property {number} remaining
 * @property {number} reset UTC epoch seconds
 */

/**
 * The GraphQL points the panel last read, and when it reads them again: with a slow read, at most once
 * every 5 minutes, never while a secondary limit pauses the reads or the window is hidden. A read
 * that fails keeps the last points.
 */
export function createRateLimitWatch() {
  /** @type {number | null} */
  let lastAt = null
  /** @type {Graphql | null} */
  let graphql = null
  return {
    /** The points of the last read that worked, `null` before one. */
    graphql: () => graphql,
    /**
     * Runs `read` when it is due.
     *
     * @param {object} input
     * @param {Backoff | null} input.backoff
     * @param {number} input.now milliseconds since the epoch
     * @param {boolean | undefined} input.visible `window()?.visible`
     * @param {() => Promise<{ graphql: Graphql } | { error: string }>} input.read
     */
    async tick({ backoff, now, visible, read }) {
      if (isPaused(backoff, now) || !readsNow({ pace: 'slow', lastAt, now, visible })) return
      lastAt = now
      const got = await read()
      if ('graphql' in got) graphql = got.graphql
    },
  }
}
