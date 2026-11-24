// The machine: the 1-minute load, the memory in use and a CPU temperature, from the texts of
// /proc/loadavg, /proc/meminfo and the hwmon files (`herdr/mod/findings.md`, question 3).

/** The hwmon names of a CPU sensor, in the order they are preferred. */
const CPU_SENSORS = ['k10temp', 'coretemp', 'zenpower']

/**
 * @typedef {object} Machine
 * @property {number | null} load1 the 1-minute load
 * @property {number} cores
 * @property {boolean} saturated the 1-minute load is above the core count
 * @property {number | null} memUsedKb `MemTotal` minus `MemAvailable`
 * @property {number | null} memTotalKb
 * @property {number | null} tempC a CPU's temperature, `null` when no hwmon names one
 */

/**
 * @param {string} meminfo
 * @param {string} key
 * @returns {number | null}
 */
function kb(meminfo, key) {
  const match = new RegExp(`^${key}:\\s+(\\d+)\\s*kB`, 'm').exec(meminfo)
  return match === null ? null : Number(match[1])
}

/**
 * Reads the machine's texts.
 *
 * @param {object} input
 * @param {string} input.loadavg the text of /proc/loadavg
 * @param {string} input.meminfo the text of /proc/meminfo
 * @param {{ name: string, temp1_input: string | null }[]} input.hwmon each hwmon's `name` and `temp1_input` (millidegrees)
 * @param {number} input.cores the machine's thread count
 * @returns {Machine}
 */
export function parseMachine({ loadavg, meminfo, hwmon, cores }) {
  const first = Number(loadavg.trim().split(/\s+/)[0])
  const load1 = Number.isFinite(first) && loadavg.trim() !== '' ? first : null
  const total = kb(meminfo, 'MemTotal')
  const available = kb(meminfo, 'MemAvailable')
  const sensor = CPU_SENSORS.map((name) => hwmon.find((h) => h.name === name)).find(
    (h) => h !== undefined && h.temp1_input !== null && Number.isFinite(Number(h.temp1_input))
  )
  return {
    load1,
    cores,
    saturated: load1 !== null && load1 > cores,
    memUsedKb: total !== null && available !== null ? total - available : null,
    memTotalKb: total,
    tempC: sensor === undefined ? null : Number(sensor.temp1_input) / 1000,
  }
}
