// The time limits of the mod's reads, and when the epics are read again (`readEpics`). A step that never
// settles ends as an error of its own source, and a read that never ends (its task cancelled, its
// `finally` never run) does not keep the next one from starting. No `herdr` or `gpui` import: the sleep
// is an argument (`cx.sleep` in `main.js`, a stub in the tests). ADR-0004 still holds: no command and no
// `exec` option is added here.

/** One step of the fast read: more than the longest `exec` timeout of that read (`docker`, 15 s). */
export const FAST_STEP_MS = 20_000
/** The fast read as a whole, after which the next one may start. */
export const FAST_READ_MS = 60_000
/** The slow read as a whole, after which the next one may start. */
export const SLOW_READ_MS = 600_000
/** One GitHub step of the slow read: more than `gh api`'s 30 s. */
export const SLOW_STEP_MS = 45_000
/** The epic of a space is asked for at most once in this time. */
export const EPIC_EVERY_MS = 60 * 60_000

/**
 * Waits for a promise for at most `ms`.
 *
 * @template T
 * @param {number} ms
 * @param {string} step the name the error carries
 * @param {Promise<T> | T} promise
 * @param {(ms: number) => Promise<unknown>} sleep
 * @returns {Promise<T | { error: string }>} the promise's value; `{ error }` when it did not settle in
 *   `ms` (`<step>: no answer in <s> s`) or rejected (`<step>: <first line of the message>`)
 */
export async function within(ms, step, promise, sleep) {
  /** @returns {Promise<{ value: T } | { error: string }>} */
  const settle = async () => {
    try {
      return { value: await promise }
    } catch (error) {
      return {
        error: `${step}: ${String(/** @type {{ message?: unknown } | undefined} */ (error)?.message ?? error).split('\n')[0]}`,
      }
    }
  }
  /** @returns {Promise<{ error: string }>} */
  const wait = async () => {
    await sleep(ms)
    return { error: `${step}: no answer in ${ms / 1000} s` }
  }
  const first = await Promise.race([settle(), wait()])
  return 'value' in first ? first.value : first
}

/**
 * Runs a step under `within`: a step that throws at once, before it returns a promise, is a rejection too.
 *
 * @template T
 * @param {number} ms
 * @param {string} step
 * @param {() => Promise<T>} run
 * @param {(ms: number) => Promise<unknown>} sleep
 * @returns {Promise<T | { error: string }>}
 */
export function limited(ms, step, run, sleep) {
  /** @type {Promise<T>} */
  let promise
  try {
    promise = run()
  } catch (error) {
    promise = Promise.reject(error)
  }
  return within(ms, step, promise, sleep)
}

/**
 * The steps of the fast read, each under `FAST_STEP_MS`: a step that ends with `{ error }` makes only
 * its own source fail.
 *
 * @template S, M, A, K
 * @param {{ now: () => Promise<number>, readSlots: () => Promise<S>, readMachine: () => Promise<M>, readAgents: () => Promise<A>, readStacks: () => Promise<K> }} adapters
 * @param {{ sleep: (ms: number) => Promise<unknown> }} options
 * @returns {Promise<{ now: number | null, slots: S | { error: string }, machine: M | { error: string }, agents: A | { error: string }, stacks: K | { error: string } }>}
 *   `now` is `null` when the clock step failed: the caller keeps its own
 */
export async function readFast(adapters, { sleep }) {
  /** @type {<T>(name: string, run: () => Promise<T>) => Promise<T | { error: string }>} */
  const step = (name, run) => limited(FAST_STEP_MS, name, run, sleep)
  const [now, slots, machine, agents, stacks] = await Promise.all([
    step('now', () => adapters.now()),
    step('readSlots', () => adapters.readSlots()),
    step('readMachine', () => adapters.readMachine()),
    step('readAgents', () => adapters.readAgents()),
    step('readStacks', () => adapters.readStacks()),
  ])
  return { now: typeof now === 'number' ? now : null, slots, machine, agents, stacks }
}

/**
 * The GitHub steps of the slow read, each under `SLOW_STEP_MS`: the read of each space (`readGithub`,
 * then `readPulls`) and the clock. A `readGithub` that does not answer ends as the `{ error }` of its
 * space, which `buildGithub` marks stale with the step's name; a `readPulls` that does not answer
 * leaves the space's read good, with no pull requests.
 *
 * @template {{ name: string }} P
 * @template {object} R
 * @param {{ now: () => Promise<number>, readGithub: (space: P) => Promise<R>, readPulls: (space: P) => Promise<unknown> }} adapters
 * @param {P[]} spaces
 * @param {{ sleep: (ms: number) => Promise<unknown> }} options
 * @returns {Promise<{ now: number | null, reads: Record<string, unknown> }>}
 *   `now` is `null` when the clock step failed: the caller keeps its own
 */
export async function readSlow(adapters, spaces, { sleep }) {
  /** @type {<T>(name: string, run: () => Promise<T>) => Promise<T | { error: string }>} */
  const step = (name, run) => limited(SLOW_STEP_MS, name, run, sleep)
  /** @type {Record<string, unknown>} */
  const reads = {}
  for (const space of spaces) {
    const read = await step('readGithub', () => adapters.readGithub(space))
    if ('error' in read) {
      reads[space.name] = read
      continue
    }
    const pulls = await step('readPulls', () => adapters.readPulls(space))
    // The pull requests never fail the read of the milestone (`readPulls` of `adapters.js`): a step
    // that does not answer leaves the space with none, as a failed read of them does there.
    reads[space.name] = { ...read, pulls: Array.isArray(pulls) ? pulls : [] }
  }
  const now = await step('now', () => adapters.now())
  return { now: typeof now === 'number' ? now : null, reads }
}

/**
 * The epic of each space that has one, each read under `SLOW_STEP_MS`: when it was never tried, or the
 * last try is `EPIC_EVERY_MS` old. A try that fails counts too, and keeps the last good answer. Nothing
 * is read, and nothing counts, while `remote` is false (the pace of `lib/quota.js`, a hidden window, or
 * a copy of the mod that shows no banner).
 *
 * @template {{ name: string, epic?: number | null }} P
 * @param {{ readEpic: (space: P) => Promise<{ issue: import('./spaces.js').EpicIssue } | { error: string }> }} adapters
 * @param {P[]} spaces
 * @param {object} options
 * @param {(ms: number) => Promise<unknown>} options.sleep
 * @param {number} options.now milliseconds since the epoch
 * @param {boolean} options.remote
 * @param {import('./spaces.js').EpicReads} options.previous
 * @returns {Promise<import('./spaces.js').EpicReads>}
 */
export async function readEpics(adapters, spaces, { sleep, now, remote, previous }) {
  if (!remote) return previous
  const epics = { ...previous }
  for (const space of spaces) {
    if (space.epic == null) continue
    const last = previous[space.name]
    if (last !== undefined && now - last.at < EPIC_EVERY_MS) continue
    const read = await limited(SLOW_STEP_MS, 'readEpic', () => adapters.readEpic(space), sleep)
    epics[space.name] = { at: now, issue: 'issue' in read ? read.issue : (last?.issue ?? null) }
  }
  return epics
}

/**
 * Tells which read is the newest and whether the last one still holds the gate.
 *
 * @param {number} limitMs how long a read holds the gate: after that the next one may start
 */
export function createGate(limitMs) {
  let latest = 0
  /** @type {{ generation: number, since: number } | null} */
  let running = null
  return {
    /**
     * @param {number} now milliseconds since the epoch
     * @returns {number | null} the new generation, or `null` while a read started less than `limitMs`
     *   ago is still running
     */
    start(now) {
      if (running !== null && now - running.since < limitMs) return null
      latest += 1
      running = { generation: latest, since: now }
      return latest
    },
    /** @param {number | null} generation */
    isCurrent(generation) {
      return generation === latest
    },
    /** @param {number | null} generation */
    end(generation) {
      if (running?.generation === generation) running = null
    },
  }
}
