// The text of `herdr/factory-slot.sh status` as slots, queue, leases, orphans, the pause and the hold.
//
// One line per entry, fields separated by a tab:
//   paused
//   heavy    <slot> <agent> <pid|-> <start> <command|hold> <alive|dead|held>
//   workers  <agent> <agent> - <start> - -
//   queue    <agent> <agent> - <start> <command> -     (the script prints none today; read when it does)
//   orphan   <pid> <cwd> <command>

import { toMs } from './time.js'

/** The heavy slots and worker leases of the script's defaults (`FACTORY_HEAVY_SLOTS`, `FACTORY_WORKER_SLOTS`). */
export const DEFAULT_TOTALS = { heavy: 3, workers: 6 }

/**
 * @typedef {object} HeavySlot
 * @property {number} slot the slot's number
 * @property {string} agent who holds it
 * @property {number | null} pid
 * @property {number | null} since milliseconds since the epoch of its start
 * @property {string} command the command it runs, `hold` for the maintainer's hold
 * @property {boolean} held a hold of the maintainer (`factory-slot.sh hold`), not a command
 * @property {boolean} alive its process is alive (a hold has none, and is `true`)
 */

/**
 * @typedef {object} Slots
 * @property {boolean} paused `factory-slot.sh pause` is in effect: no new worker
 * @property {{ used: number, total: number, slots: HeavySlot[] }} heavy
 * @property {{ used: number, total: number, leases: { agent: string, since: number | null }[] }} leases
 * @property {{ agent: string, since: number | null, command: string }[]} queue
 * @property {{ pid: number, cwd: string, command: string }[]} orphans
 */

/**
 * @param {string} field
 * @returns {number | null}
 */
function whole(field) {
  return /^\d+$/.test(field) ? Number(field) : null
}

/**
 * Reads the output of `factory-slot.sh status`.
 *
 * @param {string} text
 * @param {{ heavy?: number, workers?: number }} [totals] the pools' sizes; the script's defaults when absent
 * @returns {Slots}
 */
export function parseSlots(text, totals = {}) {
  /** @type {Slots} */
  const slots = {
    paused: false,
    heavy: { used: 0, total: totals.heavy ?? DEFAULT_TOTALS.heavy, slots: [] },
    leases: { used: 0, total: totals.workers ?? DEFAULT_TOTALS.workers, leases: [] },
    queue: [],
    orphans: [],
  }
  for (const line of text.split('\n')) {
    if (line === '') continue
    const f = line.split('\t')
    switch (f[0]) {
      case 'paused':
        slots.paused = true
        break
      case 'heavy': {
        const held = f[6] === 'held'
        slots.heavy.slots.push({
          slot: whole(f[1] ?? '') ?? 0,
          agent: f[2] ?? '',
          pid: whole(f[3] ?? ''),
          since: toMs(f[4]),
          command: f[5] ?? '',
          held,
          alive: held || f[6] === 'alive',
        })
        break
      }
      case 'workers':
        slots.leases.leases.push({ agent: f[1] ?? '', since: toMs(f[4]) })
        break
      case 'queue':
        slots.queue.push({ agent: f[1] ?? '', since: toMs(f[4]), command: f[5] ?? '' })
        break
      case 'orphan':
        slots.orphans.push({
          pid: whole(f[1] ?? '') ?? 0,
          cwd: f[2] ?? '',
          command: (f[3] ?? '').trim(),
        })
        break
      default:
        break
    }
  }
  slots.heavy.slots.sort((a, b) => a.slot - b.slot)
  slots.heavy.used = slots.heavy.slots.length
  slots.leases.used = slots.leases.leases.length
  return slots
}
