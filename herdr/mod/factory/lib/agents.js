// The agents, from the rows of Herdr's `terminals()`, never from `agents()`: `agents()` lists only
// the master and has no name field, and the workers started with `hc run --name` are sub-agents it
// leaves out (`herdr/mod/findings.md`, question 4). The state carries no context size and no model:
// no field of either call gives a context size, and the model is only an argument of the command.

/**
 * @typedef {object} Terminal a row of `terminals()`, the fields the model reads
 * @property {string} address
 * @property {string | null} [name]
 * @property {string | null} [parent]
 * @property {string} [status] `working`, `blocked`, `idle`, `done` or `error`
 * @property {{ argv?: string[] } | null} [foreground]
 * @property {Record<string, string>} [labels]
 */

/**
 * @typedef {object} Agent
 * @property {string} address
 * @property {string | null} name
 * @property {string | null} role `planner`, `master`, `worker`, `reviewer`, `verifier` or `scribe`; `null` for any other terminal
 * @property {string | null} status the terminal's `status`
 * @property {boolean} needsYou its status is `blocked`: it waits for the maintainer
 * @property {number | null} issue the issue number in its name (`worker-792`)
 * @property {{ id: string, name: string } | null} space the space of its root terminal, `null` when the root has no `herdr.space` label
 */

const NAMED = /^(worker|reviewer|verifier)-(\d+)(?:-r\d+)?$/

/**
 * The role and issue of a terminal's name (`worker-<N>`, `reviewer-<N>`, `reviewer-<N>-r<K>`,
 * `verifier-<N>`, `verifier-<N>-r<K>`, `scribe`), or, when it has no name, of `--agent master` or
 * `--agent planner` in its argv.
 *
 * @param {Terminal} terminal
 * @returns {{ role: string | null, issue: number | null }}
 */
function roleOf(terminal) {
  const name = terminal.name
  if (typeof name === 'string' && name !== '') {
    if (name === 'scribe') return { role: 'scribe', issue: null }
    const match = NAMED.exec(name)
    return match === null
      ? { role: null, issue: null }
      : { role: match[1] ?? null, issue: Number(match[2]) }
  }
  const argv = terminal.foreground?.argv ?? []
  const at = argv.indexOf('--agent')
  const which = at === -1 ? undefined : argv[at + 1]
  return { role: which === 'master' || which === 'planner' ? which : null, issue: null }
}

/**
 * Maps the rows of `terminals()` to agents.
 *
 * @param {Terminal[]} terminals
 * @returns {Agent[]}
 */
export function parseAgents(terminals) {
  const byAddress = new Map(terminals.map((t) => [t.address, t]))
  /**
   * The root terminal (the one with no `parent`) of a terminal.
   *
   * @param {Terminal} terminal
   * @returns {Terminal}
   */
  const rootOf = (terminal) => {
    let root = terminal
    const seen = new Set([root.address])
    for (;;) {
      const parent =
        root.parent === null || root.parent === undefined ? undefined : byAddress.get(root.parent)
      if (parent === undefined || seen.has(parent.address)) return root
      seen.add(parent.address)
      root = parent
    }
  }
  return terminals.map((terminal) => {
    const labels = rootOf(terminal).labels ?? {}
    const id = labels['herdr.space']
    const where = labels['where']
    const { role, issue } = roleOf(terminal)
    return {
      address: terminal.address,
      name: terminal.name ?? null,
      role,
      status: terminal.status ?? null,
      needsYou: terminal.status === 'blocked',
      issue,
      space:
        typeof id === 'string' && id !== ''
          ? { id, name: typeof where === 'string' ? (where.split(' / ')[0] ?? where) : id }
          : null,
    }
  })
}

/**
 * The model a terminal was started with: the argument after `--model` in its argv (`sonnet`,
 * `opus`), the only place the model is (`herdr/mod/findings.md`, question 4). `null` with none.
 *
 * @param {Terminal} terminal
 * @returns {string | null}
 */
export function modelOf(terminal) {
  const argv = terminal.foreground?.argv ?? []
  const at = argv.indexOf('--model')
  const model = at === -1 ? undefined : argv[at + 1]
  return typeof model === 'string' && model !== '' ? model : null
}
