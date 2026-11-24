// The calls the model is kept free of. Each read gives the shape `lib/state.js` and `lib/panel.js`
// take: `{ at, … }` when it worked, `{ error }` when it did not. Nothing here writes: the commands are
// `herdr/factory-slot.sh status`, `nproc`, `gh api` of a GET endpoint, `docker compose ls`, Herdr's
// `terminals()` and files of `/proc`, `/sys` and the fixture folder.
//
// With `fixture` in the block's props (a folder, or a list of folders, the first that has a file
// giving it), everything is read from there and not from the machine, so a screen can be reproduced:
// `status.txt`, `loadavg`, `meminfo`, `hwmon.json`, `cores`, `terminals.json`, `issues.json`
// (`issues-<space>.json` first), `comments-<n>.json`, `docker-compose-ls.json`, `loadhistory.json`,
// `now.txt` for the clock, `github-at.txt` for the time of the GitHub reads that work and
// `github-error.txt`: with it, the first GitHub read of each space works and every later one fails with
// its text, as a `gh` that stops answering does.

/** The hwmon folders looked at, `hwmon0` to `hwmon15`. */
const HWMON_FOLDERS = 16

/** At most this many `gh api` calls at once. */
const GH_AT_ONCE = 4

/**
 * The block's props as the panel reads them.
 *
 * @param {unknown} raw
 * @returns {{ checkout: string, maintainer: string, fixture: string[] | null, spaces: import('./lib/panel.js').SpaceConfig[] }}
 */
export function readConfig(raw) {
  const props =
    raw !== null && typeof raw === 'object' ? /** @type {Record<string, unknown>} */ (raw) : {}
  const fixture = props['fixture']
  const spaces = Array.isArray(props['spaces']) ? props['spaces'] : []
  return {
    checkout: typeof props['checkout'] === 'string' ? props['checkout'] : '',
    maintainer: typeof props['maintainer'] === 'string' ? props['maintainer'] : '',
    fixture:
      typeof fixture === 'string'
        ? [fixture]
        : Array.isArray(fixture)
          ? fixture.filter((f) => typeof f === 'string')
          : null,
    spaces: spaces
      .filter((s) => s !== null && typeof s === 'object' && typeof s.name === 'string')
      .map((s) => ({
        name: s.name,
        repo: typeof s.repo === 'string' ? s.repo : '',
        milestone: Number(s.milestone),
        epic: s.epic === undefined || s.epic === null ? null : Number(s.epic),
      })),
  }
}

/**
 * @param {unknown} error
 * @returns {string}
 */
const reason = (error) =>
  (error instanceof Error ? error.message : String(error)).split('\n')[0] ?? ''

/**
 * @param {object} deps
 * @param {typeof import('herdr').exec} deps.exec
 * @param {typeof import('herdr').readTextFile} deps.readTextFile
 * @param {typeof import('herdr').terminals} deps.terminals
 * @param {ReturnType<typeof readConfig>} deps.config
 * @param {() => number} [deps.clock] milliseconds since the epoch
 */
export function createAdapters({ exec, readTextFile, terminals, config, clock = Date.now }) {
  const dirs =
    config.fixture === null
      ? null
      : config.fixture.map((d) => (d.startsWith('/') ? d : `${config.checkout}/${d}`))
  /** @param {string} name @returns {Promise<string | null>} */
  const fixtureText = async (name) => {
    for (const dir of dirs ?? []) {
      const text = await readTextFile(`${dir}/${name}`)
      if (text !== null) return text
    }
    return null
  }
  /** @param {string} name @returns {Promise<unknown>} */
  const fixtureJson = async (name) => {
    const text = await fixtureText(name)
    return text === null ? null : JSON.parse(text)
  }
  /** @returns {Promise<number>} */
  const now = async () => {
    const text = await fixtureText('now.txt')
    const ms = text === null ? NaN : Date.parse(text.trim())
    return Number.isNaN(ms) ? clock() : ms
  }
  /** How many times each space's GitHub was read in a fixture. @type {Record<string, number>} */
  const githubReads = {}
  /** @param {number} ms */
  const iso = (ms) => new Date(ms).toISOString()

  /** The text of `factory-slot.sh status`. */
  async function readSlots() {
    const at = iso(await now())
    try {
      if (dirs !== null) {
        const text = await fixtureText('status.txt')
        return text === null ? { error: 'no status.txt in the fixture' } : { at, text }
      }
      const run = await exec('bash', [`${config.checkout}/herdr/factory-slot.sh`, 'status'], {
        cwd: config.checkout,
        timeout: 15_000,
      })
      return run.code === 0
        ? { at, text: run.stdout }
        : { error: run.stderr.trim() || `exit ${run.code}` }
    } catch (error) {
      return { error: reason(error) }
    }
  }

  /** The load, the memory, the temperatures and the core count. */
  async function readMachine() {
    const at = iso(await now())
    try {
      if (dirs !== null) {
        const [loadavg, meminfo, hwmon, cores] = await Promise.all([
          fixtureText('loadavg'),
          fixtureText('meminfo'),
          fixtureJson('hwmon.json'),
          fixtureText('cores'),
        ])
        if (loadavg === null || meminfo === null)
          return { error: 'no loadavg or meminfo in the fixture' }
        return {
          at,
          loadavg,
          meminfo,
          hwmon: Array.isArray(hwmon) ? hwmon : [],
          cores: Number(cores ?? '1'),
        }
      }
      const [loadavg, meminfo, cores] = await Promise.all([
        readTextFile('/proc/loadavg'),
        readTextFile('/proc/meminfo'),
        exec('nproc', [], { timeout: 5000 }),
      ])
      if (loadavg === null || meminfo === null) return { error: 'cannot read /proc' }
      const hwmon = []
      for (let i = 0; i < HWMON_FOLDERS; i += 1) {
        const name = await readTextFile(`/sys/class/hwmon/hwmon${i}/name`)
        if (name === null) continue
        hwmon.push({
          name: name.trim(),
          temp1_input: await readTextFile(`/sys/class/hwmon/hwmon${i}/temp1_input`),
        })
      }
      return { at, loadavg, meminfo, hwmon, cores: Number(cores.stdout.trim()) || 1 }
    } catch (error) {
      return { error: reason(error) }
    }
  }

  /** The rows of `terminals()`, the fields the model reads. */
  async function readAgents() {
    const at = iso(await now())
    try {
      const rows = dirs !== null ? await fixtureJson('terminals.json') : terminals()
      if (!Array.isArray(rows)) return { error: 'no terminals' }
      return {
        at,
        terminals: rows.map((t) => ({
          address: t.address,
          name: t.name ?? null,
          parent: t.parent ?? null,
          status: t.status,
          foreground: t.foreground ?? null,
          labels: t.labels ?? {},
        })),
      }
    } catch (error) {
      return { error: reason(error) }
    }
  }

  /**
   * One `gh api` GET: the JSON it printed.
   *
   * @param {string} endpoint
   * @returns {Promise<unknown>}
   */
  async function gh(endpoint) {
    const run = await exec('gh', ['api', endpoint], { timeout: 30_000 })
    if (run.code !== 0) throw new Error(run.stderr.trim() || `gh exit ${run.code}`)
    return JSON.parse(run.stdout)
  }

  /**
   * The issues of a space's milestone and the comments of each open one.
   *
   * @param {import('./lib/panel.js').SpaceConfig} space
   */
  async function readGithub(space) {
    let at = iso(await now())
    try {
      if (dirs !== null) {
        githubReads[space.name] = (githubReads[space.name] ?? 0) + 1
        const failure = await fixtureText('github-error.txt')
        if (failure !== null && githubReads[space.name] > 1) return { error: failure.trim() }
        const stamp = await fixtureText('github-at.txt')
        if (stamp !== null) at = stamp.trim()
        const issues =
          (await fixtureJson(`issues-${space.name}.json`)) ?? (await fixtureJson('issues.json'))
        if (!Array.isArray(issues)) return { error: 'no issues.json in the fixture' }
        /** @type {Record<number, unknown>} */
        const comments = {}
        for (const issue of issues) {
          if (issue.state === 'closed') continue
          comments[issue.number] = (await fixtureJson(`comments-${issue.number}.json`)) ?? []
        }
        return { at, issues, comments, maintainer: config.maintainer }
      }
      const issues = await gh(
        `repos/${space.repo}/issues?milestone=${space.milestone}&state=all&per_page=100`
      )
      if (!Array.isArray(issues)) throw new Error('gh api: not a list of issues')
      const open = issues.filter((i) => i.state !== 'closed' && i.pull_request == null)
      /** @type {Record<number, unknown>} */
      const comments = {}
      for (let i = 0; i < open.length; i += GH_AT_ONCE) {
        const batch = open.slice(i, i + GH_AT_ONCE)
        const got = await Promise.all(
          batch.map((issue) =>
            gh(`repos/${space.repo}/issues/${issue.number}/comments?per_page=100`)
          )
        )
        batch.forEach((issue, k) => {
          comments[issue.number] = got[k]
        })
      }
      return { at, issues, comments, maintainer: config.maintainer }
    } catch (error) {
      return { error: reason(error) }
    }
  }

  /** The stacks `docker compose ls` lists. */
  async function readStacks() {
    const at = iso(await now())
    try {
      if (dirs !== null) {
        const text = await fixtureText('docker-compose-ls.json')
        return { at, text: text ?? '[]' }
      }
      const run = await exec('docker', ['compose', 'ls', '--format', 'json'], { timeout: 15_000 })
      return run.code === 0
        ? { at, text: run.stdout }
        : { error: run.stderr.trim() || `exit ${run.code}` }
    } catch (error) {
      return { error: reason(error) }
    }
  }

  /** The loads of the last 15 minutes the fixture holds, oldest first, 30 s apart. */
  async function readHistory() {
    const loads = await fixtureJson('loadhistory.json')
    if (!Array.isArray(loads)) return []
    const end = await now()
    return loads.map((load, i) => ({
      at: end - (loads.length - 1 - i) * 30_000,
      load: Number(load),
    }))
  }

  return { now, readSlots, readMachine, readAgents, readGithub, readStacks, readHistory }
}
