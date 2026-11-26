// The calls the model is kept free of. Each read gives the shape `lib/state.js` and `lib/panel.js`
// take: `{ at, … }` when it worked, `{ error }` when it did not. Nothing here writes: the commands are
// `herdr/factory-slot.sh status`, `nproc`, `gh api` of a GET endpoint (`--include`, and at most one `--header If-None-Match: <etag>`: the only flags it takes), `docker -H <dockerHost> compose ls` and `docker -H <dockerHost> ps -a`, `ps -o etimes=,pcpu= -p <pid>` (every `docker` call goes through `dockerArgs`), Herdr's
// `terminals()` and files of `/proc`, `/sys` and the fixture folder.
//
// With `fixture` in the block's props (a folder, or a list of folders, the first that has a file
// giving it), everything is read from there and not from the machine, so a screen can be reproduced:
// `status.txt`, `loadavg`, `meminfo`, `hwmon.json`, `cores`, `terminals.json`, `issues.json`
// (`issues-<space>.json` first), `comments-<n>.json`, `docker-compose-ls.json`, `process-<pid>.json` (an orphan's cores and minutes), `stack-ages.json` (the minutes before `now.txt` each stack was created), `loadhistory.json`,
// `milestones-<space>.json` (`milestones.json`) and `project-fields.json` (the factory's share), `diffs.json` (the minutes before `now.txt` each issue's diff was opened), `forms.json` (what the "Log time" and correction forms hold), `pulls-<space>.json` (the open pull requests, with their comments and reviews), `commit-<n>.txt` (the commit message of an issue's packet), `worktree-<n>.json` (the branch and the lines changed of an issue's worktree), `now.txt` for the clock, `github-at.txt` for the time of the GitHub reads that work and
// `github-error.txt`: with it, the first GitHub read of each space works and every later one fails with
// its text, as a `gh` that stops answering does. A pair of a space tagged `<tag>` (`pairsOf` of
// `lib/panel.js`) has its own files, with the space and the tag, and the tag before an issue's number:
// `issues-<space>-<tag>.json`, `pulls-<space>-<tag>.json`, `milestones-<space>-<tag>.json`,
// `comments-<tag><n>.json`, `commit-<tag><n>.txt` and `worktree-<tag><n>.json`.

import { parseNumstat } from './lib/detail.js'
import { pairsOf, pullIssue } from './lib/panel.js'
import { commentsDue, parseReply } from './lib/quota.js'

/**
 * A pull request as GitHub gives it, and as a recording keeps it: the fields `readPulls` reads.
 *
 * @typedef {object} GithubPull
 * @property {number} number
 * @property {string | null} [body]
 * @property {string} created_at
 * @property {string} [updated_at]
 * @property {{ login?: string, type?: string } | null} [user] its author
 */

/** Whether a bot opened it: it never names a factory issue, since the master opens those under the maintainer's account. @param {GithubPull} pull */
const byBot = (pull) => pull.user?.type === 'Bot' || pull.user?.login?.endsWith('[bot]') === true

/** What is kept of a pull request: the issue it names, worked out here once, and not its body. @param {GithubPull} pull */
const named = ({ number, body, created_at }) => ({ number, issue: pullIssue(body), created_at })

/** The tag of a pair as a recording names it: `-<tag>` after the space's name, `''` for an untagged pair. @param {{ tag: string }} pair */
const tagged = (pair) => (pair.tag === '' ? '' : `-${pair.tag}`)

/** The hwmon folders looked at, `hwmon0` to `hwmon15`. */
const HWMON_FOLDERS = 16

/** At most this many `gh api` calls at once. */
const GH_AT_ONCE = 4

/**
 * The pairs of the layout's `spaces`, one space for each `name`: the entries that share a name are its
 * pairs, in the order of the file, and the first one's repository is the space's. An entry in another
 * repository needs a `tag` of one to three lowercase letters that no other pair of the space has, and is
 * left out without one; an entry in the space's own repository (another milestone) needs none, and
 * its tag is `''`.
 *
 * @param {unknown[]} entries
 * @returns {import('./lib/panel.js').SpaceConfig[]}
 */
function readSpaces(entries) {
  /** @type {Map<string, import('./lib/panel.js').SpaceConfig & { pairs: import('./lib/panel.js').Pair[] }>} */
  const byName = new Map()
  for (const s of entries) {
    if (s === null || typeof s !== 'object') continue
    const e = /** @type {Record<string, unknown>} */ (s)
    if (typeof e['name'] !== 'string') continue
    const pair = {
      repo: typeof e['repo'] === 'string' ? e['repo'] : '',
      milestone: Number(e['milestone']),
      epic: e['epic'] === undefined || e['epic'] === null ? null : Number(e['epic']),
      tag: typeof e['tag'] === 'string' ? e['tag'] : '',
    }
    const space = byName.get(e['name'])
    if (space === undefined) {
      byName.set(e['name'], {
        name: e['name'],
        repo: pair.repo,
        milestone: pair.milestone,
        epic: pair.epic,
        pairs: [{ ...pair, tag: '' }],
      })
    } else if (pair.repo === space.repo) {
      space.pairs.push({ ...pair, tag: '' })
    } else if (/^[a-z]{1,3}$/.test(pair.tag) && !space.pairs.some((p) => p.tag === pair.tag)) {
      space.pairs.push(pair)
    }
  }
  return [...byName.values()]
}

/** What GitHub accepts as a login, the rule of `herdr/mod/install.sh`. */
const LOGIN = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/

/**
 * The block's props as the panel reads them. A `maintainer` that is not a GitHub login (empty, or the
 * layout template's `{{maintainer}}`) is `''`.
 *
 * @param {unknown} raw
 * @returns {{ checkout: string, maintainer: string, dockerHost: string, side: 'left' | 'right', fixture: string[] | null, spaces: import('./lib/panel.js').SpaceConfig[] }}
 */
export function readConfig(raw) {
  const props =
    raw !== null && typeof raw === 'object' ? /** @type {Record<string, unknown>} */ (raw) : {}
  const fixture = props['fixture']
  const spaces = Array.isArray(props['spaces']) ? props['spaces'] : []
  return {
    checkout: typeof props['checkout'] === 'string' ? props['checkout'] : '',
    maintainer:
      typeof props['maintainer'] === 'string' && LOGIN.test(props['maintainer'])
        ? props['maintainer']
        : '',
    dockerHost: typeof props['dockerHost'] === 'string' ? props['dockerHost'] : '',
    /** The side `install.sh --side` put the panel on: Customize shows it and never changes it. */
    side: props['side'] === 'left' ? 'left' : 'right',
    fixture:
      typeof fixture === 'string'
        ? [fixture]
        : Array.isArray(fixture)
          ? fixture.filter((f) => typeof f === 'string')
          : null,
    spaces: readSpaces(spaces),
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
 * @param {import('../types/views.js').Exec} deps.exec
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
      /** @param {string} path @returns {Promise<string | null>} */
      const sensor = async (path) => {
        try {
          return await readTextFile(path)
        } catch {
          return null
        }
      }
      for (let i = 0; i < HWMON_FOLDERS; i += 1) {
        // A sensor that fails to read is left out as if it were absent: the rest of the machine is read.
        const name = await sensor(`/sys/class/hwmon/hwmon${i}/name`)
        if (name === null) continue
        hwmon.push({
          name: name.trim(),
          temp1_input: await sensor(`/sys/class/hwmon/hwmon${i}/temp1_input`),
        })
      }
      return { at, loadavg, meminfo, hwmon, cores: Number(cores.stdout.trim()) || 1 }
    } catch (error) {
      return { error: reason(error) }
    }
  }

  /**
   * The rows of `terminals()`, the fields the model reads.
   *
   * @returns {Promise<{ at: string, terminals: import('herdr').TerminalRow[], error?: undefined } | { error: string, at?: undefined, terminals?: undefined }>}
   */
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

  /** The `Etag` and the parsed body of the last `200` of each endpoint; in memory, one for each copy of the mod. @type {Map<string, { etag: string, body: unknown }>} */
  const replies = new Map()
  /** The last `X-Ratelimit-Remaining` and `X-Ratelimit-Reset` any reply gave. @type {import('./lib/quota.js').Quota | null} */
  let quota = null
  /** When the comments of each issue or pull request were last read, and its `updated_at` then. @type {Map<string, { updatedAt: unknown, at: number, value: unknown }>} */
  const seenComments = new Map()

  /**
   * One `gh api` GET: the JSON it printed. The call is `gh api <endpoint> --include`, with the `Etag` of
   * the endpoint's last `200` as `--header If-None-Match: <etag>`; a `304` (for which `gh` exits 1 with
   * `gh: HTTP 304`) gives the body of that `200`. Any other non-zero exit is a failure.
   *
   * @param {string} endpoint
   * @returns {Promise<unknown>}
   */
  async function gh(endpoint) {
    const kept = replies.get(endpoint)
    const args = ['api', endpoint, '--include']
    if (kept !== undefined) args.push('--header', `If-None-Match: ${kept.etag}`)
    const run = await exec('gh', args, { timeout: 30_000 })
    const reply = parseReply(run.stdout)
    if (reply.remaining !== null && reply.reset !== null) {
      quota = { remaining: reply.remaining, reset: reply.reset }
    }
    if (reply.status === 304 && kept !== undefined) return kept.body
    if (run.code !== 0) throw new Error(run.stderr.trim() || `gh exit ${run.code}`)
    const body = JSON.parse(reply.body)
    if (reply.etag !== null) replies.set(endpoint, { etag: reply.etag, body })
    return body
  }

  /**
   * The comments (or the comments and reviews) of an issue or a pull request: read when `commentsDue`
   * says so, the last ones otherwise.
   *
   * @template T
   * @param {string} key
   * @param {unknown} updatedAt the `updated_at` of its list
   * @param {number} at milliseconds since the epoch
   * @param {() => Promise<T>} read
   * @returns {Promise<T>}
   */
  async function commentsOf(key, updatedAt, at, read) {
    const seen = seenComments.get(key)
    if (seen !== undefined && !commentsDue(seen, updatedAt, at))
      return /** @type {T} */ (seen.value)
    const value = await read()
    seenComments.set(key, { updatedAt, at, value })
    return value
  }

  /**
   * The issues of each pair's milestone and the comments of each open one, each in its pair's repository:
   * the first pair's as `issues` and `comments`, the next pairs' in `others`, in the order of the pairs (a
   * space of one pair has no `others`). A read that fails for one pair fails for the space.
   *
   * @param {import('./lib/panel.js').SpaceConfig} space
   * @returns {Promise<import('./lib/panel.js').SpaceRead>}
   */
  async function readGithub(space) {
    let at = iso(await now())
    try {
      const pairs = pairsOf(space)
      /** @type {import('./lib/panel.js').PairRaw[]} */
      const parts = []
      if (dirs !== null) {
        githubReads[space.name] = (githubReads[space.name] ?? 0) + 1
        const failure = await fixtureText('github-error.txt')
        if (failure !== null && /** @type {number} */ (githubReads[space.name]) > 1)
          return { error: failure.trim() }
        const stamp = await fixtureText('github-at.txt')
        if (stamp !== null) at = stamp.trim()
        const today = iso(await now()).slice(0, 10)
        for (const pair of pairs) {
          const name = `issues-${space.name}${tagged(pair)}.json`
          const issues =
            pair === pairs[0]
              ? ((await fixtureJson(name)) ?? (await fixtureJson('issues.json')))
              : await fixtureJson(name)
          if (!Array.isArray(issues)) {
            return { error: `no ${pair === pairs[0] ? 'issues.json' : name} in the fixture` }
          }
          /** @type {import('./lib/panel.js').PairRaw['comments']} */
          const comments = {}
          for (const issue of issues) {
            if (issue.state === 'closed' && !closedOn(issue, today)) continue
            comments[issue.number] = /** @type {import('./lib/gates.js').Comment[]} */ (
              (await fixtureJson(`comments-${pair.tag}${issue.number}.json`)) ?? []
            )
          }
          parts.push({ issues, comments })
        }
      } else {
        for (const pair of pairs) {
          const issues = await gh(
            `repos/${pair.repo}/issues?milestone=${pair.milestone}&state=all&per_page=100`
          )
          if (!Array.isArray(issues)) throw new Error('gh api: not a list of issues')
          const at = await now()
          const today = iso(at).slice(0, 10)
          // The open issues, and the ones closed today: the Board's "Merged today" shows each one's lane.
          const open = issues.filter(
            (i) => (i.state !== 'closed' || closedOn(i, today)) && i.pull_request == null
          )
          /** @type {import('./lib/panel.js').PairRaw['comments']} */
          const comments = {}
          for (let i = 0; i < open.length; i += GH_AT_ONCE) {
            const batch = open.slice(i, i + GH_AT_ONCE)
            const got = await Promise.all(
              batch.map((issue) => {
                const endpoint = `repos/${pair.repo}/issues/${issue.number}/comments?per_page=100`
                return commentsOf(
                  endpoint,
                  issue.updated_at,
                  at,
                  () => /** @type {Promise<import('./lib/gates.js').Comment[]>} */ (gh(endpoint))
                )
              })
            )
            batch.forEach((issue, k) => {
              comments[issue.number] = /** @type {import('./lib/gates.js').Comment[]} */ (got[k])
            })
          }
          parts.push({ issues, comments })
        }
      }
      const [first, ...others] = parts
      return {
        at,
        issues: first?.issues ?? [],
        comments: first?.comments ?? {},
        maintainer: config.maintainer,
        ...(others.length === 0 ? {} : { others }),
      }
    } catch (error) {
      return { error: reason(error) }
    }
  }

  /**
   * The open pull requests of each repository of a space's pairs, each with its comments and its reviews,
   * so that "Needs you" can tell which has no `time:` note of the maintainer. A pull request of another
   * repository than the space's carries its `repo`. A failed read of the pull requests is no pull
   * requests: it never fails the read of the milestone. Each carries the issue its body names (`pullIssue`)
   * and not the body; a bot's pull request is left out, and its comments and reviews are not read.
   *
   * @param {{ repo: string, milestone?: number, epic?: number | null, pairs?: import('./lib/panel.js').Pair[], name?: string }} space
   * @returns {Promise<import('./lib/panel.js').OpenPull[]>}
   */
  async function readPulls(space) {
    try {
      /** @type {import('./lib/panel.js').OpenPull[]} */
      const out = []
      const seen = new Set()
      for (const pair of pairsOf(space)) {
        if (seen.has(pair.repo)) continue
        seen.add(pair.repo)
        const own = pair.repo === space.repo
        /** @param {import('./lib/panel.js').OpenPull} pull */
        const mark = (pull) => (own ? pull : { ...pull, repo: pair.repo })
        if (dirs !== null) {
          const found = await fixtureJson(`pulls-${space.name}${tagged(pair)}.json`)
          if (Array.isArray(found)) {
            const recorded =
              /** @type {(GithubPull & Pick<import('./lib/panel.js').OpenPull, 'comments' | 'reviews'>)[]} */ (
                found
              )
            out.push(
              ...recorded
                .filter((p) => !byBot(p))
                .map((p) => mark({ ...named(p), comments: p.comments, reviews: p.reviews }))
            )
          }
          continue
        }
        const list = await gh(`repos/${pair.repo}/pulls?state=open&per_page=100`)
        if (!Array.isArray(list)) continue
        const open = /** @type {GithubPull[]} */ (list).filter((p) => !byBot(p))
        const at = await now()
        for (let i = 0; i < open.length; i += GH_AT_ONCE) {
          const got = await Promise.all(
            open.slice(i, i + GH_AT_ONCE).map(async (pull) => ({
              ...named(pull),
              ...(await commentsOf(
                `${pair.repo}#${pull.number}`,
                pull.updated_at,
                at,
                async () => ({
                  comments: /** @type {import('./lib/panel.js').OpenPull['comments']} */ (
                    await gh(`repos/${pair.repo}/issues/${pull.number}/comments?per_page=100`)
                  ),
                  reviews: /** @type {import('./lib/panel.js').OpenPull['reviews']} */ (
                    await gh(`repos/${pair.repo}/pulls/${pull.number}/reviews?per_page=100`)
                  ),
                })
              )),
            }))
          )
          out.push(...got.map(mark))
        }
      }
      return out
    } catch {
      return []
    }
  }

  /**
   * The milestones of the repository of each pair of each space, for the factory's share:
   * `gh api repos/<repo>/milestones` (`milestones-<space>.json`, `milestones-<space>-<tag>.json` for a
   * tagged pair, then `milestones.json`, in a fixture), one read for each repository.
   *
   * @param {import('./lib/panel.js').SpaceConfig[]} spaces
   */
  async function readMilestones(spaces) {
    const at = iso(await now())
    try {
      /** @type {Record<string, import('./lib/board.js').RepoMilestone[]>} */
      const byRepo = {}
      for (const space of spaces) {
        for (const pair of pairsOf(space)) {
          if (pair.repo in byRepo) continue
          const list =
            dirs !== null
              ? ((await fixtureJson(`milestones-${space.name}${tagged(pair)}.json`)) ??
                (await fixtureJson('milestones.json')))
              : await gh(`repos/${pair.repo}/milestones?state=all&per_page=100`)
          if (!Array.isArray(list)) return { error: `no milestones for ${pair.repo}` }
          byRepo[pair.repo] = /** @type {import('./lib/board.js').RepoMilestone[]} */ (list)
        }
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
   * @param {string} [tag] the tag of the issue's pair: its recording is `worktree-<tag><n>.json`
   * @returns {Promise<{ branch?: string, added?: number, removed?: number, error?: string }>}
   */
  async function readWorktree(issue, path, tag = '') {
    try {
      if (dirs !== null) {
        const name = `worktree-${tag}${issue}.json`
        const found = await fixtureJson(name)
        return found === null
          ? { error: `no ${name} in the fixture` }
          : /** @type {{ branch: string, added: number, removed: number }} */ (found)
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
   * `commit-<tag><issue>.txt` of the fixture. `null` when there is none.
   *
   * @param {number} issue
   * @param {string} packet the packet directory
   * @param {string} [tag] the tag of the issue's pair
   * @returns {Promise<string | null>}
   */
  async function readCommit(issue, packet, tag = '') {
    try {
      const text =
        dirs !== null
          ? await fixtureText(`commit-${tag}${issue}.txt`)
          : await readTextFile(`${packet.replace(/\/+$/, '')}/commit-message.txt`)
      const line = text?.split(/\r?\n/, 1)[0]?.trim()
      return line === undefined || line === '' ? null : line
    } catch {
      return null
    }
  }

  /**
   * With a fixture, the diffs the maintainer is taken to have opened: `diffs.json`, the minutes before
   * `now.txt` that each issue's diff was opened, by the issue's key (`issueKey` of `lib/panel.js`: `"5"`,
   * or `"owner/repo#5"` for an issue of another repository of the space). Nothing is read from a real run, where the maintainer's
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
    const obj =
      found !== null && typeof found === 'object'
        ? /** @type {{ time?: Record<string, Record<string, unknown>>, log?: Record<string, string> | null }} */ (
            found
          )
        : {}
    return { time: obj.time ?? {}, log: obj.log ?? null }
  }

  return {
    now,
    /** The last quota any reply gave, `null` before the first. */
    quota: () => quota,
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
