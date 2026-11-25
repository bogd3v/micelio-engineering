// All of it: the slots, the machine, the issues and the agents in one state, with an age for each
// source and a `stale` mark on the one whose last read failed. A function of its arguments only:
// the time, the texts and the fetched JSON are given by the caller (the calls are the mod's).

import { parseAgents } from './agents.js'
import { buildIssues } from './issues.js'
import { parseMachine } from './machine.js'
import { parseSlots } from './slots.js'
import { ageMs } from './time.js'

/** The four sources of the state. */
const SOURCES = ['slots', 'machine', 'agents', 'issues']

/**
 * @typedef {object} Source
 * @property {unknown} value what the last good read gave, `null` before the first
 * @property {string | null} at when that read was made (ISO 8601), `null` before the first
 * @property {number | null} ageMs how long ago, `null` before the first good read
 * @property {boolean} stale the latest read failed
 * @property {string | null} error why it failed
 */

/**
 * @typedef {object} Fetched what the caller read in this round: for each source, the raw input and
 * when it was read, or `error` when the read failed. A source left out was not read in this round and
 * keeps its last value, not stale.
 * @property {{ at: string, text: string, error?: undefined } | { error: string }} [slots]
 * @property {{ at: string, loadavg: string, meminfo: string, hwmon: { name: string, temp1_input: string | null }[], cores: number } | { error: string }} [machine]
 * @property {{ at: string, terminals: import('./agents.js').Terminal[] } | { error: string }} [agents]
 * @property {{ at: string, issues: Parameters<typeof buildIssues>[0]['issues'], comments: Parameters<typeof buildIssues>[0]['comments'], maintainer: string } | { error: string }} [issues]
 */

/** @returns {Source} */
const empty = () => ({ value: null, at: null, ageMs: null, stale: false, error: null })

/**
 * Builds the state.
 *
 * @param {object} input
 * @param {number} input.now milliseconds since the epoch
 * @param {Fetched} input.fetched this round's reads
 * @param {{ sources: Record<string, Source> } | null} [input.previous] the state of the last round
 * @returns {{ now: number, stale: boolean, sources: Record<string, Source> }}
 */
export function buildState({ now, fetched, previous = null }) {
  /** @type {Record<string, Source>} */
  const sources = {}
  for (const name of SOURCES) sources[name] = { ...(previous?.sources[name] ?? empty()) }
  /**
   * @param {string} name
   * @param {{ at?: string, error?: string }} read
   * @param {() => unknown} parse
   */
  const take = (name, read, parse) => {
    const source = /** @type {Source} */ (sources[name])
    if (typeof read.error === 'string') {
      source.stale = true
      source.error = read.error
    } else {
      source.value = parse()
      source.at = read.at ?? null
      source.stale = false
      source.error = null
    }
  }
  if (fetched.slots !== undefined) {
    const read = fetched.slots
    take('slots', read, () => parseSlots('text' in read ? read.text : ''))
  }
  if (fetched.machine !== undefined) {
    const read = fetched.machine
    take('machine', read, () => ('loadavg' in read ? parseMachine(read) : null))
  }
  if (fetched.agents !== undefined) {
    const read = fetched.agents
    take('agents', read, () => ('terminals' in read ? parseAgents(read.terminals) : []))
  }
  const agents = /** @type {import('./agents.js').Agent[]} */ (sources['agents']?.value ?? [])
  if (fetched.issues !== undefined) {
    const read = fetched.issues
    take('issues', read, () => ('issues' in read ? buildIssues({ ...read, now, agents }) : []))
  }
  for (const source of Object.values(sources)) source.ageMs = ageMs(now, source.at)
  return { now, stale: Object.values(sources).some((s) => s.stale), sources }
}
