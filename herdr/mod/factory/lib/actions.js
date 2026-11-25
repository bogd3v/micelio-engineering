// What the panel's buttons do to the machine: pause and resume the workers, reserve and release the
// maintainer's heavy slot, arm a retry of a held check, bring down a stack that nothing owns and end an
// orphan's process group. A click never runs a removal: it asks for a confirmation that names the project
// or the process, and the confirmation runs it. Every program goes through the caller's `exec`
// (Herdr's), and every `docker` call through `dockerArgs` of `adapters.js`, so `down -v` reaches the
// engine the agents' stacks run on. Nothing here talks to a terminal: a retry is a line the caller sends.
// `disabled` (the panel reads recordings, `fixture` in its props) is the one guard under every action: no
// program is run and no retry is sent, whatever a click asks for; the buttons say so.

/** What a click says when the panel reads recordings. */
export const FIXTURE_NOTE = 'Fixture: nothing was run.'

import { dockerArgs } from '../adapters.js'
import { issueOfName } from './agents.js'
import { refText } from './time.js'

/** The exit status `factory-slot.sh hold` gives when no heavy slot is free. */
export const NO_FREE_SLOT = 75

/** A retry is armed when the 1-minute load falls under this share of the core count. */
export const RETRY_SHARE = 0.75

/**
 * The load a retry waits for: three quarters of the core count.
 *
 * @param {number} cores
 * @returns {number}
 */
export const retryBelow = (cores) => cores * RETRY_SHARE

/**
 * The threshold as the button writes it: `24` for 32 cores, `4.5` for 6.
 *
 * @param {number} cores
 * @returns {string}
 */
export function retryThreshold(cores) {
  const n = retryBelow(cores)
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}

/**
 * The label of the button that arms a retry, and of the one that cancels it. With no core count (the machine
 * could not be read) it names no number: a threshold of 0 would be wrong, and no retry is sent until the count is known.
 *
 * @param {number} cores
 * @param {boolean} armed
 * @returns {string}
 */
export const retryLabel = (cores, armed) =>
  armed
    ? 'Armed · cancel'
    : cores > 0
      ? `Retry when load < ${retryThreshold(cores)}`
      : 'Retry when load falls'

/**
 * The sentence under an armed retry.
 *
 * @param {number} cores
 * @returns {string}
 */
export const armedNote = (cores) =>
  `armed: the master reruns it once, in a slot, when the load ${cores > 0 ? `is under ${retryThreshold(cores)}` : 'falls'}.`

/**
 * The retries the maintainer armed, and the one send each gets. `check` is called with each reading of the
 * load: a retry whose master is known is sent once, when the load is under the threshold, and is then no
 * longer armed. It is `retry #N`, or `retry owner/repo#N` for an issue of another repository of the space.
 *
 * @param {object} deps
 * @param {(target: string, text: string) => unknown} deps.send the caller's `hc send`
 * @param {boolean} [deps.disabled] nothing is sent, and a retry stays armed
 */
export function createRetries({ send, disabled = false }) {
  /** @type {Map<string, { issue: number | string, master: string }>} */
  const armed = new Map()
  return {
    /** @param {string} key @param {number | string} issue its number, or its reference (`refOf` of `panel.js`) @param {string} master */
    arm(key, issue, master) {
      armed.set(key, { issue, master })
    },
    /** @param {string} key */
    cancel(key) {
      armed.delete(key)
    },
    /** @param {string} key */
    isArmed: (key) => armed.has(key),
    /** The armed keys, as `buildNeeds` takes them. @returns {Record<string, boolean>} */
    armed: () => Object.fromEntries([...armed.keys()].map((key) => [key, true])),
    /** Cancels each armed retry whose key is not in `keys`: its card is gone. @param {Set<string>} keys */
    keep(keys) {
      for (const key of [...armed.keys()]) if (!keys.has(key)) armed.delete(key)
    },
    /**
     * @param {number | null} load1 the 1-minute load
     * @param {number} cores
     * @returns {string[]} the lines sent
     */
    check(load1, cores) {
      if (disabled || load1 === null || cores <= 0 || !(load1 < retryBelow(cores))) return []
      /** @type {string[]} */
      const sent = []
      for (const [key, { issue, master }] of [...armed]) {
        armed.delete(key)
        const text = `retry ${refText(issue)}`
        send(master, text)
        sent.push(text)
      }
      return sent
    },
  }
}

/**
 * Whether a stack belongs to someone: a live agent of the issue its name ends in, or a worker lease of it.
 * A stack whose name has no number belongs to no issue, so no agent and no lease can own it. A name that
 * ends in `<tag><N>`, with a tag of the spaces' pairs, is issue N of that pair (`issueOfName`).
 *
 * @param {string} name the Compose project
 * @param {{ issue: number | null, tag?: string, role: string | null }[]} agents
 * @param {{ agent: string }[]} leases
 * @param {string[]} [tags] the tags of the spaces' pairs
 * @returns {boolean}
 */
export function stackOwned(name, agents, leases, tags = []) {
  const id = issueOfName(name, tags)
  if (id === null) return false
  const live = agents.some(
    (a) =>
      a.issue === id.issue &&
      (a.tag ?? '') === id.tag &&
      a.role !== 'master' &&
      a.role !== 'planner'
  )
  return (
    live ||
    leases.some((l) => {
      const of = issueOfName(l.agent, tags)
      return of !== null && of.issue === id.issue && of.tag === id.tag
    })
  )
}

/**
 * @typedef {object} Facts what the panel knows now
 * @property {{ issue: number | null, tag?: string, role: string | null }[]} agents the live agents
 * @property {string[]} [tags] the tags of the spaces' pairs
 * @property {{ agent: string }[]} leases the worker leases
 * @property {{ pid: number, cwd: string, command: string }[]} orphans what `status` lists as orphans
 * @property {{ name: string }[]} stacks the stacks `docker compose ls` lists
 */

/**
 * @typedef {object} Confirmation
 * @property {'stack' | 'process'} kind
 * @property {string} target the project, or the pid
 * @property {string} title the question, naming the project or the process
 * @property {string} detail what confirming runs
 */

/**
 * The buttons' actions.
 *
 * @param {object} deps
 * @param {typeof import('herdr').exec} deps.exec
 * @param {{ checkout: string, dockerHost: string }} deps.config
 * @param {() => Facts} deps.facts read when a removal is asked for and again when it is confirmed
 * @param {boolean} [deps.disabled] run nothing: every action answers `FIXTURE_NOTE`
 */
export function createActions({ exec, config, facts, disabled = false }) {
  /** @type {Confirmation | null} */
  let pending = null
  const script = `${config.checkout}/herdr/factory-slot.sh`

  /**
   * One verb of the slot script.
   *
   * @param {string[]} args
   * @returns {Promise<{ ok: boolean, code: number, note: string | null }>}
   */
  async function slot(args) {
    if (disabled) return { ok: false, code: -1, note: FIXTURE_NOTE }
    try {
      const run = await exec('bash', [script, ...args], { cwd: config.checkout, timeout: 15_000 })
      return {
        ok: run.code === 0,
        code: run.code,
        note: run.code === 0 ? null : run.stderr.trim() || `exit ${run.code}`,
      }
    } catch (error) {
      return {
        ok: false,
        code: -1,
        note: (error instanceof Error ? error.message : String(error)).split('\n')[0] ?? '',
      }
    }
  }

  /**
   * @param {string} name
   * @returns {string | null} why it cannot be removed
   */
  function stackRefusal(name) {
    const f = facts()
    if (!f.stacks.some((s) => s.name === name)) return `${name} is not a stack that runs`
    if (stackOwned(name, f.agents, f.leases, f.tags)) return `${name} has a live agent or a lease`
    return null
  }

  /**
   * @param {number} pid
   * @returns {string | null}
   */
  function processRefusal(pid) {
    return facts().orphans.some((o) => o.pid === pid) ? null : `pid ${pid} is no longer an orphan`
  }

  return {
    /** "Pause new workers". */
    pause: () => slot(['pause']),
    /** "Resume workers". */
    resume: () => slot(['resume']),
    /** "Reserve a slot": a hold that exits 75 holds nothing. */
    async reserve() {
      const run = await slot(['hold', '--agent', 'maintainer'])
      return run.code === NO_FREE_SLOT ? { ...run, note: 'no free slot' } : run
    },
    /** "Release my slot". */
    release: () => slot(['release', '--agent', 'maintainer']),

    /** The confirmation that waits for an answer, `null` when none does. */
    pending: () => pending,

    /**
     * "Bring down …": asks for the confirmation, runs nothing.
     *
     * @param {string} project
     * @returns {{ ok: boolean, note: string | null }}
     */
    askBringDown(project) {
      const refusal = stackRefusal(project)
      if (refusal !== null) return { ok: false, note: refusal }
      pending = {
        kind: 'stack',
        target: project,
        title: `Bring down ${project}?`,
        detail: `docker compose -p ${project} down -v removes its containers and volumes.`,
      }
      return { ok: true, note: null }
    },

    /**
     * "Terminate…": asks for the confirmation, runs nothing.
     *
     * @param {number} pid
     * @returns {{ ok: boolean, note: string | null }}
     */
    askTerminate(pid) {
      const refusal = processRefusal(pid)
      if (refusal !== null) return { ok: false, note: refusal }
      const o = facts().orphans.find((x) => x.pid === pid)
      pending = {
        kind: 'process',
        target: String(pid),
        title: `Terminate pid ${pid}${o === undefined ? '' : ` (${o.command.split(/\s+/)[0]})`}?`,
        detail: 'Ends its process group with SIGTERM.',
      }
      return { ok: true, note: null }
    },

    /** Drops the confirmation: nothing runs. */
    cancel() {
      pending = null
    },

    /**
     * Runs what the confirmation asked for, after the same check as when it was asked: the facts may have
     * changed since.
     *
     * @returns {Promise<{ ok: boolean, note: string | null }>}
     */
    async confirm() {
      const asked = pending
      pending = null
      if (asked === null) return { ok: false, note: 'nothing to confirm' }
      if (disabled) return { ok: false, note: FIXTURE_NOTE }
      try {
        if (asked.kind === 'stack') {
          const refusal = stackRefusal(asked.target)
          if (refusal !== null) return { ok: false, note: refusal }
          const run = await exec(
            'docker',
            dockerArgs(config, ['compose', '-p', asked.target, 'down', '-v']),
            { timeout: 120_000 }
          )
          return run.code === 0
            ? { ok: true, note: `${asked.target} is down` }
            : { ok: false, note: run.stderr.trim() || `docker exit ${run.code}` }
        }
        const pid = Number(asked.target)
        const refusal = processRefusal(pid)
        if (refusal !== null) return { ok: false, note: refusal }
        const run = await exec(
          'sh',
          [
            '-c',
            'pg=$(ps -o pgid= -p "$1" | tr -d " ") && [ -n "$pg" ] && kill -TERM -- "-$pg"',
            'terminate',
            String(pid),
          ],
          { timeout: 15_000 }
        )
        return run.code === 0
          ? { ok: true, note: `pid ${pid} ended` }
          : { ok: false, note: run.stderr.trim() || `exit ${run.code}` }
      } catch (error) {
        return {
          ok: false,
          note: (error instanceof Error ? error.message : String(error)).split('\n')[0] ?? '',
        }
      }
    },
  }
}
