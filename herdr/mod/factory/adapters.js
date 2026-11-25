// The calls the model is kept free of. Each read gives the shape `lib/state.js` and `lib/panel.js`
// take: `{ at, … }` when it worked, `{ error }` when it did not. Nothing here writes: the commands are
// `herdr/factory-slot.sh status`, `nproc`, `gh api` of a GET endpoint, `docker -H <dockerHost> compose ls` and `docker -H <dockerHost> ps -a`, `ps -o etimes=,pcpu= -p <pid>` (every `docker` call goes through `dockerArgs`), Herdr's
// `terminals()` and files of `/proc`, `/sys` and the fixture folder.
//
// With `fixture` in the block's props (a folder, or a list of folders, the first that has a file
// giving it), everything is read from there and not from the machine, so a screen can be reproduced:
// `status.txt`, `loadavg`, `meminfo`, `hwmon.json`, `cores`, `terminals.json`, `issues.json`
// (`issues-<space>.json` first), `comments-<n>.json`, `docker-compose-ls.json`, `process-<pid>.json` (an orphan's cores and minutes), `stack-ages.json` (the minutes before `now.txt` each stack was created), `loadhistory.json`,
// `milestones-<space>.json` (`milestones.json`) and `project-fields.json` (the factory's share), `diffs.json` (the minutes before `now.txt` each issue's diff was opened), `forms.json` (what the "Log time" and correction forms hold), `pulls-<space>.json` (the open pull requests, with their comments and reviews), `commit-<n>.txt` (the commit message of an issue's packet), `worktree-<n>.json` (the branch and the lines changed of an issue's worktree), `now.txt` for the clock, `github-at.txt` for the time of the GitHub reads that work and
// `github-error.txt`: with it, the first GitHub read of each space works and every later one fails with
// its text, as a `gh` that stops answering does.

import { parseNumstat } from './lib/detail.js'

/** The hwmon folders looked at, `hwmon0` to `hwmon15`. */
const HWMON_FOLDERS = 16

/** At most this many `gh api` calls at once. */
const GH_AT_ONCE = 4

/**
 * The block's props as the panel reads them.
 *
 * @param {unknown} raw
 * @returns {{ checkout: string, maintainer: string, dockerHost: string, fixture: string[] | null, spaces: import('./lib/panel.js').SpaceConfig[] }}
 */
export function readConfig(raw) {
  const props =
    raw !== null && typeof raw === 'object' ? /** @type {Record<string, unknown>} */ (raw) : {}
  const fixture = props['fixture']
  const spaces = Array.isArray(props['spaces']) ? props['spaces'] : []
  return {
    checkout: typeof props['checkout'] === 'string' ? props['checkout'] : '',
    maintainer: typeof props['maintainer'] === 'string' ? props['maintainer'] : '',
    dockerHost: typeof props['dockerHost'] === 'string' ? props['dockerHost'] : '',
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
 * The arguments of a `docker` call: Herdr's `exec` takes no environment, so the engine's socket goes
 * in the CLI's global `-H` flag, with the `dockerHost` the install wrote in the layout.
 *
 * @param {{ dockerHost: string }} config
 * @param {string[]} args
 * @returns {string[]}
 */
export function dockerArgs(config, args) {
  return config.dockerHost === '' ? args : ['-H', config.dockerHost, ...args]
}

/**
 * The creation time of the oldest container of a project, from the `CreatedAt` of each one
 * (`2026-11-24 10:32:45 -0500 EST`, with or without fractions of a second).
 *
 * @param {string} text one `CreatedAt` for each line
 * @returns {number | null} milliseconds since the epoch
 */
export function oldestCreated(text) {
  /** @type {number[]} */
  const times = []
  for (const line of text.split('\n')) {
    const m = /^(\d{4}-\d\d-\d\d) (\d\d:\d\d:\d\d)(\.\d+)? ([+-]\d\d)(\d\d)/.exec(line.trim())
    if (m === null) continue
    const ms = Date.parse(`${m[1]}T${m[2]}${m[3] ?? ''}${m[4]}:${m[5]}`)
    if (!Number.isNaN(ms)) times.push(ms)
  }
  return times.length === 0 ? null : Math.min(...times)
}

/**
 * Whether a closed issue was closed on `day` (`YYYY-MM-DD`, UTC).
 *
 * @param {{ closed_at?: unknown }} issue
 * @param {string} day
 */
const closedOn = (issue, day) =>
  typeof issue.closed_at === 'string' && issue.closed_at.startsWith(day)

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
        const today = iso(await now()).slice(0, 10)
        /** @type {Record<number, unknown>} */
        const comments = {}
        for (const issue of issues) {
          if (issue.state === 'closed' && !closedOn(issue, today)) continue
          comments[issue.number] = (await fixtureJson(`comments-${issue.number}.json`)) ?? []
        }
        return { at, issues, comments, maintainer: config.maintainer }
      }
      const issues = await gh(
        `repos/${space.repo}/issues?milestone=${space.milestone}&state=all&per_page=100`
      )
      if (!Array.isArray(issues)) throw new Error('gh api: not a list of issues')
      const today = iso(await now()).slice(0, 10)
      // The open issues, and the ones closed today: the Board's "Merged today" shows each one's lane.
      const open = issues.filter(
        (i) => (i.state !== 'closed' || closedOn(i, today)) && i.pull_request == null
      )
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

  /**
   * The open pull requests of a space's repository, each with its comments and its reviews, so that
   * "Needs you" can tell which has no `time:` note of the maintainer. A failed read of the pull requests
   * is no pull requests: it never fails the read of the milestone.
   *
   * @param {import('./lib/panel.js').SpaceConfig} space
   * @returns {Promise<import('./lib/panel.js').OpenPull[]>}
   */
  async function readPulls(space) {
    try {
      if (dirs !== null) {
        const found = await fixtureJson(`pulls-${space.name}.json`)
        return Array.isArray(found) ? found : []
      }
      const open = await gh(`repos/${space.repo}/pulls?state=open&per_page=100`)
      if (!Array.isArray(open)) return []
      const out = []
      for (let i = 0; i < open.length; i += GH_AT_ONCE) {
        const got = await Promise.all(
          open.slice(i, i + GH_AT_ONCE).map(async (pull) => ({
            number: pull.number,
            body: pull.body ?? null,
            created_at: pull.created_at,
            comments: await gh(`repos/${space.repo}/issues/${pull.number}/comments?per_page=100`),
            reviews: await gh(`repos/${space.repo}/pulls/${pull.number}/reviews?per_page=100`),
          }))
        )
        out.push(...got)
      }
      return out
    } catch {
      return []
    }
  }

  /**
   * The milestones of each space's repository, for the factory's share: `gh api repos/<repo>/milestones`
   * (`milestones-<space>.json`, then `milestones.json`, in a fixture), one read for each repository.
   *
   * @param {import('./lib/panel.js').SpaceConfig[]} spaces
   */
  async function readMilestones(spaces) {
    const at = iso(await now())
    try {
      /** @type {Record<string, unknown>} */
      const byRepo = {}
      for (const space of spaces) {
        if (space.repo in byRepo) continue
        const list =
          dirs !== null
            ? ((await fixtureJson(`milestones-${space.name}.json`)) ??
              (await fixtureJson('milestones.json')))
            : await gh(`repos/${space.repo}/milestones?state=all&per_page=100`)
        if (!Array.isArray(list)) return { error: `no milestones for ${space.repo}` }
        byRepo[space.repo] = list
      }
      return { at, byRepo }
    } catch (error) {
      return { error: reason(error) }
    }
  }

  /** `.github/project-fields.json` of the checkout: the Release line and the Front of each milestone. */
  async function readProjectFields() {
    const at = iso(await now())
    try {
      const text =
        (dirs !== null ? await fixtureText('project-fields.json') : null) ??
        (await readTextFile(`${config.checkout}/.github/project-fields.json`))
      if (text === null) return { error: 'no .github/project-fields.json' }
      return { at, fields: JSON.parse(text) }
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
      const run = await exec('docker', dockerArgs(config, ['compose', 'ls', '--format', 'json']), {
        timeout: 15_000,
      })
      return run.code === 0
        ? { at, text: run.stdout }
        : { error: run.stderr.trim() || `exit ${run.code}` }
    } catch (error) {
      return { error: reason(error) }
    }
  }

  /**
   * When a stack was created: the oldest of its containers, `docker ps -a` filtered by the Compose project
   * label (`stack-ages.json` of a fixture: the minutes before `now.txt`). `null` when unknown.
   *
   * @param {string} project
   * @returns {Promise<number | null>} milliseconds since the epoch
   */
  async function readStackAge(project) {
    try {
      if (dirs !== null) {
        const found = /** @type {Record<string, number> | null} */ (
          await fixtureJson('stack-ages.json')
        )
        const minutes = found?.[project]
        return typeof minutes === 'number' ? (await now()) - minutes * 60_000 : null
      }
      const run = await exec(
        'docker',
        dockerArgs(config, [
          'ps',
          '-a',
          '--filter',
          `label=com.docker.compose.project=${project}`,
          '--format',
          '{{.CreatedAt}}',
        ]),
        { timeout: 15_000 }
      )
      return run.code === 0 ? oldestCreated(run.stdout) : null
    } catch {
      return null
    }
  }

  /**
   * The cores and the age of a process, read with `ps` (`process-<pid>.json` of a fixture: `cores`, `minutes`).
   *
   * @param {number} pid
   * @returns {Promise<{ cores: number, ageMs: number } | null>}
   */
  async function readProcess(pid) {
    try {
      if (dirs !== null) {
        const found = /** @type {{ cores: number, minutes: number } | null} */ (
          await fixtureJson(`process-${pid}.json`)
        )
        return found === null ? null : { cores: found.cores, ageMs: found.minutes * 60_000 }
      }
      const run = await exec('ps', ['-o', 'etimes=,pcpu=', '-p', String(pid)], { timeout: 5000 })
      const [etimes, pcpu] = run.stdout.trim().split(/\s+/)
      if (run.code !== 0 || etimes === undefined || pcpu === undefined) return null
      return { cores: Math.round(Number(pcpu) / 10) / 10, ageMs: Number(etimes) * 1000 }
    } catch {
      return null
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

  /**
   * The branch of an issue's worktree and the lines it changes against `origin/main`, read with
   * `git rev-parse`, `git merge-base` and `git diff --numstat`: none of them writes, and a file that
   * is not tracked yet is not counted.
   *
   * @param {number} issue
   * @param {string} path the worktree
   */
  async function readWorktree(issue, path) {
    try {
      if (dirs !== null) {
        const found = await fixtureJson(`worktree-${issue}.json`)
        return found === null ? { error: `no worktree-${issue}.json in the fixture` } : found
      }
      /** @param {string[]} args */
      const git = async (args) => {
        const run = await exec('git', ['-C', path, ...args], { timeout: 15_000 })
        if (run.code !== 0) throw new Error(run.stderr.trim() || `git exit ${run.code}`)
        return run.stdout.trim()
      }
      const branch = await git(['rev-parse', '--abbrev-ref', 'HEAD'])
      const base = await git(['merge-base', 'HEAD', 'origin/main'])
      const { added, removed } = parseNumstat(await git(['diff', '--numstat', base]))
      return { branch, added, removed }
    } catch (error) {
      return { error: reason(error) }
    }
  }

  /**
   * The first line of an issue's commit message, the subject: `<packet>/commit-message.txt`, or
   * `commit-<issue>.txt` of the fixture. `null` when there is none.
   *
   * @param {number} issue
   * @param {string} packet the packet directory
   * @returns {Promise<string | null>}
   */
  async function readCommit(issue, packet) {
    try {
      const text =
        dirs !== null
          ? await fixtureText(`commit-${issue}.txt`)
          : await readTextFile(`${packet.replace(/\/+$/, '')}/commit-message.txt`)
      const line = text?.split(/\r?\n/, 1)[0]?.trim()
      return line === undefined || line === '' ? null : line
    } catch {
      return null
    }
  }

  /**
   * With a fixture, the diffs the maintainer is taken to have opened: `diffs.json`, the minutes before
   * `now.txt` that each issue's diff was opened. Nothing is read from a real run, where the maintainer's
   * click opens them.
   *
   * @returns {Promise<Record<string, number>>}
   */
  async function readDiffs() {
    const found = dirs === null ? null : await fixtureJson('diffs.json')
    return found !== null && typeof found === 'object'
      ? /** @type {Record<string, number>} */ (found)
      : {}
  }

  /**
   * With a fixture, what the forms hold, since nobody types in a recording: `forms.json`,
   * `{ "time": { "<issue>": <the fields of the "Log time" form> }, "log": { "issue", "what", "category" } }`.
   * Nothing is read from a real run.
   *
   * @returns {Promise<{ time: Record<string, Record<string, unknown>>, log: Record<string, string> | null }>}
   */
  async function readForms() {
    const found = dirs === null ? null : await fixtureJson('forms.json')
    const obj = found !== null && typeof found === 'object' ? /** @type {any} */ (found) : {}
    return { time: obj.time ?? {}, log: obj.log ?? null }
  }

  return {
    now,
    readCommit,
    readDiffs,
    readForms,
    readSlots,
    readMachine,
    readAgents,
    readGithub,
    readPulls,
    readMilestones,
    readProjectFields,
    readStacks,
    readStackAge,
    readProcess,
    readHistory,
    readWorktree,
  }
}
