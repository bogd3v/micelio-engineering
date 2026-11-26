// What the panel shows, as plain data: every number, label, colour name and cat file of every
// section, from the state of `state.js` and the milestones read from GitHub. The views of
// `views/` only draw it. A function of its arguments: the time is one of them.
//
// Colours are the names of `herdr/mod/design/tokens.json` (`cyan`, `magenta`, `red`, `warn-fill`,
// `muted`, `fg`, …); a view resolves them in the theme it draws.

import { issueOfName } from './agents.js'
import { catFile } from './cat.js'
import { buildIssues } from './issues.js'
import { paceOf } from './quota.js'
import { ageMs, toMs } from './time.js'

/** @typedef {'machine' | 'slots' | 'workers' | 'milestones' | 'stacks' | 'orphans'} SectionName a collapsible section */

/** The collapsible sections of the panel, in the order of the design. */
export const SECTIONS = ['machine', 'slots', 'workers', 'milestones', 'stacks', 'orphans']

/** How far back the load of the Machine section goes. */
const HISTORY_MS = 15 * 60_000

/** How much of an orphan's command line "Show process" shows, in characters. */
const BRIEF_LENGTH = 120

/** The token that colours a space's badge, by the space's position in the layout's props. */
export const SPACE_COLOURS = ['space-m', 'space-f', 'space-p']

const ROLE_LETTER = {
  master: 'M',
  planner: 'P',
  worker: 'W',
  reviewer: 'R',
  verifier: 'V',
  scribe: 'S',
}

/**
 * How long ago, as the panel writes it: `4 s`, `3 min`, `2 h`. `—` when unknown.
 *
 * @param {number | null} ms
 * @returns {string}
 */
export function formatAge(ms) {
  if (ms === null) return '—'
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s} s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} min`
  return `${Math.floor(m / 60)} h`
}

/**
 * What the header's sync label adds while GitHub's quota is low: ` · quota <remaining> · slow <time to
 * reset>`, or ` · quota 0 · paused <time to reset>`; nothing while the pace is `normal`.
 *
 * @param {import('./quota.js').Quota | null} quota
 * @param {number} now milliseconds since the epoch
 * @returns {string}
 */
function paceNote(quota, now) {
  const pace = paceOf(quota, now)
  if (quota === null || pace === 'normal') return ''
  const left = formatAge(quota.reset * 1000 - now)
  return pace === 'stopped'
    ? ` · quota 0 · paused ${left}`
    : ` · quota ${quota.remaining} · slow ${left}`
}

/**
 * A span as `m:ss`.
 *
 * @param {number | null} ms
 * @returns {string}
 */
function formatClock(ms) {
  if (ms === null) return '—'
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/**
 * The hour of a timestamp as `HH:MM` UTC.
 *
 * @param {string | null | undefined} at
 * @returns {string}
 */
export function hourUtc(at) {
  const ms = toMs(at)
  return ms === null ? '—' : `${new Date(ms).toISOString().slice(11, 16)} UTC`
}

/**
 * The cat state of an agent from its Herdr status: `blocked` is the one that needs the maintainer.
 *
 * @param {string | null | undefined} status
 * @returns {'working' | 'needs' | 'idle' | 'red'}
 */
export function catState(status) {
  if (status === 'working') return 'working'
  if (status === 'blocked') return 'needs'
  if (status === 'error') return 'red'
  return 'idle'
}

/**
 * The load samples of the last 15 minutes, with a new one added.
 *
 * @param {{ at: number, load: number }[]} history
 * @param {number} now
 * @param {number | null} load
 * @returns {{ at: number, load: number }[]}
 */
export function pushLoad(history, now, load) {
  const kept = history.filter((s) => now - s.at < HISTORY_MS)
  return load === null ? kept : [...kept, { at: now, load }]
}

/**
 * The bars of the load of the last 15 minutes: each bar is the highest load of its slice of the
 * window, `null` where no sample fell.
 *
 * @param {{ at: number, load: number }[]} history
 * @param {number} now
 * @param {number} cores
 * @param {number} [count]
 * @returns {{ load: number | null, tone: string }[]}
 */
export function loadBars(history, now, cores, count = 30) {
  const width = HISTORY_MS / count
  /** @type {(number | null)[]} */
  const slices = Array.from({ length: count }, () => null)
  for (const sample of history) {
    const age = now - sample.at
    if (age < 0 || age >= HISTORY_MS) continue
    const at = count - 1 - Math.floor(age / width)
    const had = slices[at] ?? null
    slices[at] = had === null ? sample.load : Math.max(had, sample.load)
  }
  return slices.map((load) => ({
    load,
    tone: load === null ? 'track' : load > cores ? 'red' : load > cores * 0.75 ? 'magenta' : 'cyan',
  }))
}

/**
 * The stacks of `docker compose ls --format json`.
 *
 * @param {string} text
 * @returns {{ name: string, status: string }[]}
 */
export function parseStacks(text) {
  /** @type {unknown} */
  let rows
  try {
    rows = JSON.parse(text)
  } catch {
    return []
  }
  if (!Array.isArray(rows)) return []
  return rows
    .filter((r) => r !== null && typeof r === 'object' && typeof r.Name === 'string')
    .map((r) => ({ name: r.Name, status: typeof r.Status === 'string' ? r.Status : '' }))
}

/** The issue a pull request closes or refers to: `Closes #N`, `Fixes #N`, `Refs #N`. @param {string | null | undefined} body @returns {number | null} */
export function pullIssue(body) {
  const match = /\b(?:closes|fixes|resolves|refs)\s+#(\d+)/i.exec(body ?? '')
  return match === null ? null : Number(match[1])
}

/**
 * An open pull request with what the maintainer wrote on it.
 *
 * @typedef {object} OpenPull
 * @property {number} number
 * @property {number | null} issue the issue its body names (`pullIssue`), read with it
 * @property {string} created_at
 * @property {string} [repo] its repository, when it is not the space's
 * @property {{ user?: { login?: string }, body?: string | null }[]} comments the conversation's comments
 * @property {{ user?: { login?: string }, body?: string | null }[]} reviews
 */

/**
 * What GitHub gave for each space, as rows. A space whose read failed keeps its last rows, stale.
 *
 * @typedef {Pick<SpaceConfig, 'name'> & Partial<SpaceConfig>} SpaceName a space of which only the name is sure
 *
 * @typedef {object} SpaceConfig
 * @property {string} name the space's name in Herdr
 * @property {string} repo `owner/name`, the repository of its first pair: the space's repository
 * @property {number} milestone the first pair's milestone
 * @property {number | null} [epic] the first pair's epic, left out of the rows
 * @property {Pair[]} [pairs] every `{ repo, milestone }` of the space, in the order of the layout; a config with none is its one pair (`pairsOf`)
 *
 * @typedef {object} Pair one milestone of a space
 * @property {string} repo `owner/name`
 * @property {number} milestone
 * @property {number | null} [epic] left out of the rows
 * @property {string} tag `''` for a pair of the space's repository; else the letters before the number of its agents (`worker-<tag><N>`) and of its recordings
 *
 * @typedef {{ issues: Parameters<typeof buildIssues>[0]['issues'], comments: Parameters<typeof buildIssues>[0]['comments'] }} PairRaw the issues and comments of one pair
 *
 * @typedef {object} SpaceMilestone
 * @property {{ issues: Parameters<typeof buildIssues>[0]['issues'], comments: Parameters<typeof buildIssues>[0]['comments'], maintainer: string, pulls: OpenPull[], others?: PairRaw[] } | null} raw the last good read, the epics and the pull requests left out: the first pair's issues and comments, `others` those of the next pairs, and the pull requests of every pair's repository; turned into rows by `milestoneRows` with the agents of the moment
 * @property {string | null} at when the last good read was made
 * @property {number | null} ageMs
 * @property {boolean} stale
 * @property {string | null} error
 *
 * @typedef {{ spaces: Record<string, SpaceMilestone> }} Github
 *
 * @typedef {{ at: string, issues: PairRaw['issues'], comments: PairRaw['comments'], maintainer: string, pulls?: OpenPull[], others?: PairRaw[] } | { error: string }} SpaceRead what one read of a space gave
 */

/**
 * The pairs of a space: its `pairs`, or, for a config made with none, the one of its `repo`,
 * `milestone` and `epic`.
 *
 * @param {{ repo: string, milestone?: number, epic?: number | null, pairs?: Pair[], name?: string }} space
 * @returns {Pair[]}
 */
export function pairsOf(space) {
  return Array.isArray(space.pairs) && space.pairs.length > 0
    ? space.pairs
    : [{ repo: space.repo, milestone: Number(space.milestone), epic: space.epic ?? null, tag: '' }]
}

/**
 * The tags of the pairs of every space.
 *
 * @param {{ repo: string, pairs?: Pair[] }[]} spaces
 * @returns {string[]}
 */
export const tagsOf = (spaces) =>
  spaces.flatMap((s) => pairsOf(s).map((p) => p.tag)).filter((t) => t !== '')

/**
 * The reference of an issue: `#N` in the space's repository, `owner/repo#N` in another repository of the
 * space. Every line the mod sends names the issue with it.
 *
 * @param {{ repo: string }} space
 * @param {{ repo: string }} pair
 * @param {number} number
 * @returns {string}
 */
export const refOf = (space, pair, number) =>
  pair.repo === space.repo ? `#${number}` : `${pair.repo}#${number}`

/**
 * The key of an issue in what the mod keeps per issue (the diffs opened, the forms, the commit
 * subjects): its number in the space's repository, as before, and its reference in another, so two
 * issues of the same number never share one.
 *
 * @param {{ repo: string }} space
 * @param {{ repo: string }} pair
 * @param {number} number
 * @returns {number | string}
 */
export const issueKey = (space, pair, number) =>
  pair.repo === space.repo ? number : refOf(space, pair, number)

/**
 * How a card names an issue: `<space>#N`, or `<space> owner/repo#N` for another repository.
 *
 * @param {{ name: string, repo: string }} space
 * @param {{ repo: string }} pair
 * @param {number} number
 * @returns {string}
 */
export function issueAt(space, pair, number) {
  const ref = refOf(space, pair, number)
  return ref.startsWith('#') ? `${space.name}${ref}` : `${space.name} ${ref}`
}

/**
 * Each pair of a space with what its last good read holds: its issues and comments, the maintainer, and
 * the open pull requests of its repository. Empty before a good read.
 *
 * @param {SpaceConfig} space
 * @param {SpaceMilestone | undefined} read
 * @returns {{ pair: Pair, raw: { issues: PairRaw['issues'], comments: PairRaw['comments'], maintainer: string, pulls: OpenPull[] } }[]}
 */
export function pairReads(space, read) {
  const raw = read?.raw
  if (raw == null) return []
  return pairsOf(space).flatMap((pair, i) => {
    const part = i === 0 ? raw : raw.others?.[i - 1]
    if (part == null) return []
    const pulls = (raw.pulls ?? []).filter((p) => (p.repo ?? space.repo) === pair.repo)
    return [
      {
        pair,
        raw: {
          issues: part.issues,
          comments: part.comments,
          maintainer: raw.maintainer,
          pulls,
        },
      },
    ]
  })
}

/**
 * Whether an agent works on an issue of a pair: its tag is the pair's.
 *
 * @param {{ tag?: string }} agent
 * @param {Pair} pair
 */
export const onPair = (agent, pair) => (agent.tag ?? '') === pair.tag

/**
 * @param {object} input
 * @param {number} input.now
 * @param {SpaceName[]} input.spaces
 * @param {Record<string, unknown>} input.reads each space's read, a `SpaceRead` of `readGithub`
 * @param {Github | null} [input.previous]
 * @returns {Github}
 */
export function buildGithub({ now, spaces, reads, previous = null }) {
  /** @type {Record<string, SpaceMilestone>} */
  const out = {}
  for (const space of /** @type {SpaceConfig[]} */ (spaces)) {
    const had = previous?.spaces[space.name]
    /** @type {SpaceMilestone} */
    const entry = had
      ? { ...had }
      : {
          raw: null,
          at: null,
          ageMs: null,
          stale: false,
          error: null,
        }
    const read = /** @type {SpaceRead | undefined} */ (reads[space.name])
    if (read !== undefined) {
      if ('error' in read) {
        entry.stale = true
        entry.error = read.error
      } else {
        const pairs = pairsOf(space)
        /** @param {PairRaw['issues']} issues @param {{ epic?: number | null | undefined } | undefined} pair */
        const own = (issues, pair) =>
          issues.filter((i) => (i.pull_request ?? null) === null && i.number !== pair?.epic)
        entry.raw = {
          issues: own(read.issues, { ...pairs[0], epic: space.epic ?? pairs[0]?.epic }),
          comments: read.comments,
          maintainer: read.maintainer,
          pulls: read.pulls ?? [],
          ...(read.others === undefined
            ? {}
            : {
                others: read.others.map((part, i) => ({
                  issues: own(part.issues, pairs[i + 1]),
                  comments: part.comments,
                })),
              }),
        }
        entry.at = read.at
        entry.stale = false
        entry.error = null
      }
    }
    entry.ageMs = ageMs(now, entry.at)
    out[space.name] = entry
  }
  return { spaces: out }
}

/**
 * The rows of a space's milestone from its last good read and the agents of this moment, so a worker
 * that starts, stops or is blocked shows at once and not at the next read of GitHub.
 *
 * @param {Pick<SpaceMilestone, 'raw'> | undefined} read
 * @param {number} now
 * @param {import('./agents.js').Agent[]} agents the agents of the space
 * @returns {{ rows: import('./issues.js').IssueRow[], counts: { closed: number, total: number } }}
 */
export function milestoneRows(read, now, agents) {
  if (read?.raw == null) return { rows: [], counts: { closed: 0, total: 0 } }
  const all = buildIssues({ ...read.raw, now, agents })
  const rows = all.filter((r) => r.waitMs !== null)
  return { rows, counts: { closed: all.length - rows.length, total: all.length } }
}

/**
 * The rows of every pair of a space, in the order of its pairs, each with its pair, its reference and
 * its key; the agents of each pair are those of its tag.
 *
 * @param {SpaceConfig} space
 * @param {SpaceMilestone | undefined} read
 * @param {number} now
 * @param {import('./agents.js').Agent[]} agents the agents of the space
 * @returns {{ rows: (import('./issues.js').IssueRow & { pair: Pair, ref: string, key: number | string })[], counts: { closed: number, total: number } }}
 */
function spaceRows(space, read, now, agents) {
  const rows = []
  const counts = { closed: 0, total: 0 }
  for (const { pair, raw } of pairReads(space, read)) {
    const got = milestoneRows(
      { raw },
      now,
      agents.filter((a) => onPair(a, pair))
    )
    counts.closed += got.counts.closed
    counts.total += got.counts.total
    for (const row of got.rows) {
      rows.push({
        ...row,
        pair,
        ref: refOf(space, pair, row.number),
        key: issueKey(space, pair, row.number),
      })
    }
  }
  return { rows, counts }
}

/** @typedef {{ value: unknown, at: string | null, ageMs: number | null, stale: boolean, error: string | null }} Source */

/** @typedef {{ value: unknown } & Partial<Omit<Source, 'value'>>} SourceInput a source as the panel reads it: a field it lacks is as before the first read */

/**
 * The note of a local source (the machine, the slots or the agents) whose latest read failed: the
 * same text as Milestones gives a stale GitHub. `null` while it is live.
 *
 * @param {SourceInput | undefined} source
 * @returns {string | null}
 */
export const notLive = (source) =>
  source?.stale === true ? `as of ${hourUtc(source.at)} · not live` : null

/**
 * @param {SourceInput | undefined} source
 * @returns {SourceInput}
 */
const orEmpty = (source) =>
  source ?? { value: null, at: null, ageMs: null, stale: false, error: null }

/**
 * The tone of an issue's label: the most urgent of its marks.
 *
 * @param {string[]} marks
 * @param {boolean} blocked
 * @returns {string}
 */
function labelTone(marks, blocked) {
  if (blocked) return 'muted'
  if (marks.includes('red')) return 'red'
  if (marks.includes('needs')) return 'magenta'
  if (marks.includes('held')) return 'fg'
  if (marks.includes('running')) return 'cyan'
  return 'muted'
}

const MARK_NAME = {
  passed: 'passed',
  running: 'running',
  needs: 'needs you',
  held: 'held',
  red: 'red',
  notReached: 'not reached',
  omitted: 'omitted by lane',
}

/**
 * The note under an issue: what it waits for, or its title.
 *
 * @param {import('./issues.js').IssueRow} row
 * @param {import('./agents.js').Agent[]} onIt
 * @returns {string}
 */
function noteOf(row, onIt, ref = (/** @type {number} */ n) => `#${n}`) {
  if (row.blocked) return `blocked by ${row.blockedBy.map(ref).join(', ')}`
  const waiting = onIt.find((a) => a.needsYou)
  if (waiting) return `${waiting.role ?? 'agent'} is blocked: it may need you`
  if (row.marks[4] === 'needs') return 'waits for your sign-off'
  const running = onIt.filter((a) => a.status === 'working').map((a) => a.role)
  if (running.length > 0) return [...new Set(running)].join(' + ')
  return row.title
}

/**
 * The cats on an issue: the issue's agents (`worker-<N>`, `reviewer-<N>`, `verifier-<N>`) and, where
 * the issue waits for the maintainer with no agent asking, its master.
 *
 * @param {import('./issues.js').IssueRow} row
 * @param {import('./agents.js').Agent[]} onIt
 * @param {import('./agents.js').Agent | null} master
 * @param {string} theme
 */
function catsOf(row, onIt, master, theme) {
  const held = row.marks.includes('held')
  /** @type {{ name: string, role: string, state: string, file: string | undefined }[]} */
  const cats = onIt
    .filter((a) => a.role !== null)
    .map((a) => {
      const state = held ? 'held' : catState(a.status)
      return {
        name: a.name ?? a.address,
        role: a.role ?? '',
        state,
        file: catFile(a.role, state, 16, theme),
      }
    })
  if (row.needsYou && !onIt.some((a) => a.needsYou) && master !== null) {
    cats.unshift({
      name: 'master',
      role: 'master',
      state: 'needs',
      file: catFile('master', 'needs', 16, theme),
    })
  }
  return cats
}

/**
 * A row of "Heavy slots": a free slot, or one an agent or the maintainer holds.
 *
 * @typedef {{ n: number, free: true }} FreeSlot
 * @typedef {{ n: number, free: false, held: boolean, agent: string, role: string | null, badge: { letter: string, colour: string }, command: string, time: string }} TakenSlot
 */

/**
 * Everything the panel draws.
 *
 * @param {object} input
 * @param {number} input.now milliseconds since the epoch
 * @param {{ stale: boolean, sources: Record<string, SourceInput> }} input.state
 * @param {Github | null} input.github
 * @param {{ value: { name: string, status: string }[], at: string | null, stale: boolean, error: string | null }} [input.stacks]
 * @param {Record<string, number>} [input.stackAges] when each unowned stack was created (milliseconds since the epoch), by project
 * @param {{ at: number, load: number }[]} [input.history]
 * @param {{ spaces: SpaceConfig[], maintainer?: string }} input.config with `maintainer` `''` the panel says no login is named
 * @param {'dark' | 'light'} [input.theme] the theme the cat files are named for
 * @param {Record<string, boolean>} [input.open] the sections the maintainer opened or closed
 * @param {import('./quota.js').Quota | null} [input.quota] the last quota GitHub reported: the header says so while the pace is not `normal`
 */
export function buildPanel({
  now,
  state,
  github,
  stacks = { value: [], at: null, stale: false, error: null },
  stackAges = {},
  history = [],
  config,
  theme = 'dark',
  open = {},
  quota = null,
}) {
  const slots = /** @type {import('./slots.js').Slots | null} */ (
    orEmpty(state.sources['slots']).value
  )
  const machine = /** @type {import('./machine.js').Machine | null} */ (
    orEmpty(state.sources['machine']).value
  )
  const agents = /** @type {import('./agents.js').Agent[]} */ (
    orEmpty(state.sources['agents']).value ?? []
  )
  const withRole = agents.filter((a) => a.role !== null)
  const spaceIndex = (/** @type {string | undefined} */ name) =>
    config.spaces.findIndex((s) => s.name === name)
  /** @param {string} name */
  const colourOf = (name) => {
    const at = spaceIndex(name)
    return at === -1 ? 'muted' : (SPACE_COLOURS[at % SPACE_COLOURS.length] ?? 'muted')
  }
  /**
   * @param {import('./agents.js').Agent | undefined} agent
   * @returns {{ letter: string, colour: string }}
   */
  const badgeOf = (agent) =>
    agent?.space
      ? { letter: (agent.space.name[0] ?? '?').toUpperCase(), colour: colourOf(agent.space.name) }
      : { letter: '?', colour: 'muted' }
  /** @param {string} name */
  const agentNamed = (name) => agents.find((a) => a.name === name)

  const machineNote = notLive(state.sources['machine'])
  const slotsNote = notLive(state.sources['slots'])
  const agentsNote = notLive(state.sources['agents'])
  const saturated = machine?.saturated === true
  const cores = machine?.cores ?? 0
  const heavyUsed = slots?.heavy.used ?? 0
  const heavyTotal = slots?.heavy.total ?? 0
  const leasesUsed = slots?.leases.used ?? 0
  const leasesTotal = slots?.leases.total ?? 0
  const paused = slots?.paused === true

  const githubStale = github !== null && Object.values(github.spaces).some((s) => s.stale)
  const staleAges = github
    ? Object.values(github.spaces)
        .filter((s) => s.stale)
        .map((s) => s.ageMs)
        .filter((n) => n !== null)
    : []
  const staleSince = github
    ? (Object.values(github.spaces)
        .filter((s) => s.stale)
        .map((s) => s.at)
        .filter((a) => a !== null)
        .toSorted()[0] ?? null)
    : null
  const staleError = github
    ? (Object.values(github.spaces).find((s) => s.stale)?.error ?? null)
    : null
  const staleAge = staleAges.length > 0 ? Math.max(...staleAges) : null

  // The strip.
  const milestone = Object.fromEntries(
    config.spaces.map((space) => [
      space.name,
      spaceRows(
        space,
        github?.spaces[space.name],
        now,
        agents.filter((a) => a.space?.name === space.name)
      ),
    ])
  )
  const rows = config.spaces.flatMap((space) => milestone[space.name]?.rows ?? [])
  const needsCount =
    rows.filter((r) => r.needsYou).length +
    withRole.filter((a) => a.needsYou && a.issue === null).length
  const strip = [
    {
      key: 'load',
      label: 'LOAD',
      value: machine?.load1 == null ? '—' : String(Math.round(machine.load1)),
      tone: saturated ? 'warn-fg' : 'cyan',
      fill: saturated ? 'warn-fill' : null,
    },
    { key: 'heavy', label: 'HEAVY', value: `${heavyUsed}/${heavyTotal}`, tone: 'fg', fill: null },
    {
      key: 'workers',
      label: 'WORKERS',
      value: `${leasesUsed}/${leasesTotal}`,
      tone: paused ? 'magenta' : 'fg',
      fill: null,
    },
    {
      key: 'needs',
      label: 'NEEDS',
      value: String(needsCount),
      tone: 'magenta',
      fill: 'magenta-bg',
    },
    {
      key: 'orphans',
      label: 'ORPHANS',
      value: String(slots?.orphans.length ?? 0),
      tone: 'red',
      fill: null,
    },
  ]

  // The header.
  // The age of each source is made from `now` and its `at` here, so that the label grows while no read lands.
  const fresh = Object.values(state.sources)
    .map((s) => ageMs(now, s.at))
    .filter((n) => n !== null)
  const reserved = slots?.heavy.slots.some((s) => s.held) === true
  const header = {
    pause: { on: paused, label: paused ? 'Resume workers' : 'Pause new workers' },
    reserve: { on: reserved, label: reserved ? 'Release my slot' : 'Reserve a slot' },
    sync: githubStale
      ? {
          text: `GH STALE ${formatAge(staleAge).toUpperCase()}${paceNote(quota, now)}`,
          stale: true,
        }
      : {
          text: `sync ${formatAge(fresh.length === 0 ? null : Math.min(...fresh))}${paceNote(quota, now)}`,
          stale: false,
        },
  }

  // The banners.
  const banners = {
    maintainer:
      config.maintainer === ''
        ? {
            title: 'No maintainer login.',
            text: "Gates, time notes, held checks, decisions and tokens count only the maintainer's comments, and this layout names none. Run herdr/mod/install.sh --maintainer <login>.",
          }
        : null,
    saturated: saturated
      ? {
          title: `Load ${machine?.load1?.toFixed(0) ?? '—'} / ${cores} threads.`,
          text: 'Tests time out at this load. Heavy commands wait their turn; a check that fails only on timeouts is held, not red.',
        }
      : null,
    stale: githubStale
      ? {
          title: `GitHub: no data for ${formatAge(staleAge)}.`,
          text: `Gates and pull requests below are as of ${hourUtc(staleSince)} (${staleError ?? 'unknown error'}). The machine, slots and stacks are live.`,
        }
      : null,
    paused: paused
      ? 'paused: masters start no new worker. Running agents and gates continue.'
      : null,
  }

  // Machine.
  const machineOpen = open['machine'] ?? saturated
  const gb = (/** @type {number | null | undefined} */ kb) =>
    kb == null ? '—' : String(Math.round(kb / 1_048_576))
  const machineModel = {
    open: machineOpen,
    dim: machineNote !== null,
    note: machineNote,
    saturated,
    pill: saturated ? 'SATURATED' : 'NOMINAL',
    load: machine?.load1 == null ? '—' : machine.load1.toFixed(1),
    cores,
    fraction: machine?.load1 == null || cores === 0 ? 0 : Math.min(1, machine.load1 / cores),
    ram: `${gb(machine?.memUsedKb)}/${gb(machine?.memTotalKb)}`,
    temp: machine?.tempC == null ? '—' : `${Math.round(machine.tempC)} °C`,
    agents: withRole.length,
    bars: loadBars(history, now, cores),
    tone: saturated ? 'red' : 'cyan',
  }

  // Heavy slots and the queue.
  const slotRows = Array.from(
    { length: heavyTotal },
    /** @returns {FreeSlot | TakenSlot} */ (_, i) => {
      const slot = slots?.heavy.slots.find((s) => s.slot === i + 1)
      if (slot === undefined) return { n: i + 1, free: true }
      if (slot.held) {
        return {
          n: i + 1,
          free: false,
          held: true,
          agent: 'you',
          role: null,
          badge: { letter: 'Y', colour: 'warn-fill' },
          command: 'held for your hands-on test',
          time: formatClock(slot.since === null ? null : Math.max(0, now - slot.since)),
        }
      }
      const agent = agentNamed(slot.agent)
      return {
        n: i + 1,
        free: false,
        held: false,
        agent: slot.agent,
        role: agent?.role ?? null,
        badge: badgeOf(agent),
        command: `$ ${slot.command}`,
        time: formatClock(slot.since === null ? null : Math.max(0, now - slot.since)),
      }
    }
  )
  const queue = (slots?.queue ?? []).map((q, i) => {
    const agent = agentNamed(q.agent)
    return {
      pos: String(i + 1).padStart(2, '0'),
      agent: q.agent,
      role: agent?.role ?? null,
      badge: badgeOf(agent),
      command: `$ ${q.command}`,
      wait: formatClock(q.since === null ? null : Math.max(0, now - q.since)),
    }
  })

  // Worker leases.
  const leaseCells = Array.from({ length: leasesTotal }, (_, i) => {
    const lease = slots?.leases.leases[i]
    if (lease === undefined) {
      return {
        free: true,
        label: paused ? '||' : '--',
        title: paused ? 'paused' : 'free',
        colour: null,
      }
    }
    const badge = badgeOf(agentNamed(lease.agent))
    return { free: false, label: badge.letter, title: lease.agent, colour: badge.colour }
  })

  // Milestones.
  const dim = githubStale
  const spaces = config.spaces.map((space) => {
    const read = github?.spaces[space.name]
    const inSpace = agents.filter((a) => a.space?.name === space.name)
    const master = inSpace.find((a) => a.role === 'master') ?? null
    return {
      name: space.name,
      letter: (space.name[0] ?? '?').toUpperCase(),
      colour: colourOf(space.name),
      master: master === null ? null : catState(master.status),
      masterFile:
        master === null ? null : (catFile('master', catState(master.status), 24, theme) ?? null),
      merged: read
        ? `${milestone[space.name]?.counts.closed}/${milestone[space.name]?.counts.total}`
        : '—',
      stale: read?.stale === true,
      issues: (milestone[space.name]?.rows ?? []).map((row) => {
        const onIt = inSpace.filter((a) => a.issue === row.number && onPair(a, row.pair))
        return {
          number: row.number,
          id: row.ref,
          repo: row.pair.repo,
          marks: row.marks,
          aria: row.marks
            .map((m, i) => `G${i + 1} ${MARK_NAME[/** @type {keyof typeof MARK_NAME} */ (m)] ?? m}`)
            .join(', '),
          label: row.label,
          tone: labelTone(row.marks, row.blocked),
          lane: row.lane.toUpperCase(),
          note: noteOf(row, onIt, (n) => refOf(space, row.pair, n)),
          needsYou: row.needsYou,
          cats: catsOf(row, onIt, master, theme),
        }
      }),
    }
  })

  // Stacks up: a name that ends in `<tag><N>` is issue N of the pair with that tag, and only its agents
  // and its lease own it.
  const tags = tagsOf(config.spaces)
  const owners = (/** @type {string} */ name) => {
    const id = issueOfName(name, tags)
    if (id === null) return []
    return withRole
      .filter(
        (a) =>
          a.issue === id.issue &&
          (a.tag ?? '') === id.tag &&
          a.role !== 'master' &&
          a.role !== 'planner'
      )
      .map((a) => a.name ?? a.address)
  }
  /** The worker lease of the issue a stack's name ends in. */
  const leaseOf = (/** @type {string} */ name) => {
    const id = issueOfName(name, tags)
    if (id === null) return null
    return (
      (slots?.leases.leases ?? []).find((l) => {
        const of = issueOfName(l.agent, tags)
        return of !== null && of.issue === id.issue && of.tag === id.tag
      })?.agent ?? null
    )
  }
  const stackRows = stacks.value.map((s) => {
    // The first of an empty list is `undefined`, so the lease decides, and it can be `null`.
    const owner = /** @type {string | null} */ (owners(s.name)[0] ?? leaseOf(s.name))
    const since = stackAges[s.name]
    return {
      name: s.name,
      status: s.status,
      owner,
      // No live agent and no lease: the only stack that can be brought down.
      removable: owner === null,
      age: owner === null && since !== undefined ? formatAge(Math.max(0, now - since)) : null,
    }
  })

  // Orphans. A command line can be a thousand characters long: the card shows the program and
  // "Show process" a cut of the command.
  const orphans = (slots?.orphans ?? []).map((o) => ({
    pid: o.pid,
    command: o.command,
    cwd: o.cwd,
    title: `${/** @type {string} */ (o.command.split(/\s+/)[0]).split('/').pop()} · ${o.cwd}`,
    brief: o.command.length > BRIEF_LENGTH ? `${o.command.slice(0, BRIEF_LENGTH)}…` : o.command,
    line: `pid ${o.pid} · no slot · no owner`,
  }))

  const sections = {
    machine: machineModel,
    slots: {
      open: open['slots'] ?? true,
      dim: slotsNote !== null,
      note: slotsNote,
      count: `${heavyUsed}/${heavyTotal}`,
      rows: slotRows,
      queueTitle: queue.length > 0 ? 'queue, arrival order' : 'queue empty',
      queue,
    },
    workers: {
      open: open['workers'] ?? true,
      dim: slotsNote !== null,
      note: slotsNote,
      count: `${leasesUsed}/${leasesTotal}${leasesUsed >= leasesTotal && leasesTotal > 0 ? ' · next worker waits' : ''}${paused ? ' · PAUSED' : ''}`,
      cells: leaseCells,
      paused,
    },
    milestones: {
      open: open['milestones'] ?? true,
      dim,
      note: dim ? `as of ${hourUtc(staleSince)} · not live` : null,
      // The cats come from the agents: a stale agents source dims them.
      catsDim: agentsNote !== null,
      catsNote: agentsNote,
      spaces,
    },
    stacks: {
      open: open['stacks'] ?? true,
      count: `${stackRows.length}${stackRows.some((s) => s.owner === null) ? ` · ${stackRows.filter((s) => s.owner === null).length} unowned` : ''}`,
      unowned: stackRows.filter((s) => s.owner === null).length,
      rows: stackRows,
      error: stacks.stale ? stacks.error : null,
    },
    orphans: {
      open: open['orphans'] ?? true,
      dim: slotsNote !== null,
      note: slotsNote,
      count: String(orphans.length),
      rows: orphans,
    },
  }

  return {
    header,
    strip,
    banners,
    // Also a record, so a section can be asked for by a name that is only known at run time.
    sections: /** @type {typeof sections & Record<string, unknown>} */ (sections),
    roleLetter: ROLE_LETTER,
  }
}
