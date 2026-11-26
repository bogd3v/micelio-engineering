// What the Board tab shows, as plain data: the summary, the filters, and every issue of every space
// in the one column its last gate comment puts it in. The view of `views/board.js` only draws it. A
// function of its arguments: the time, the reads of GitHub and the agents are given by the caller.
//
// Colours are the names of `herdr/mod/design/tokens.json`, as in `lib/panel.js`.

import { catFile } from './cat.js'
import { dependsOn } from './issues.js'
import { parseGates } from './gates.js'
import {
  catState,
  formatAge,
  hourUtc,
  loadBars,
  onPair,
  pairReads,
  pairsOf,
  refOf,
  SPACE_COLOURS,
} from './panel.js'
import { toMs } from './time.js'

/** The seven columns of the design, left to right. */
const COLUMNS = [
  { key: 'ready', title: 'Ready' },
  { key: 'g2', title: 'G2 · Worker' },
  { key: 'g3', title: 'G3 · Review' },
  { key: 'g4', title: 'G4 · Verify' },
  { key: 'g5', title: 'G5 · Needs you' },
  { key: 'g6', title: 'G6 · CI' },
  { key: 'merged', title: 'Merged today' },
]

/** The lane filters, after "All lanes". */
const LANE_FILTERS = ['EXPRESS', 'NORMAL', 'FULL']

/** The agent each column shows first on a card. */
const COLUMN_ROLE = { g2: 'worker', g3: 'reviewer', g4: 'verifier', g5: 'master', g6: 'master' }

/**
 * The column of an open issue: where its last gate comment puts it. No gate comment is Ready; a gate
 * sent back, and a gate 2 comment that is red, is the worker's; a red gate 3 or 4 stays in its own
 * column; a gate that passed sends the issue to the next gate its lane does not omit and that has not
 * passed (G3 and G4 run together); the gate 5 comment of the pull request moves it to CI.
 *
 * @param {import('./gates.js').Gates} gates
 * @returns {'ready' | 'g2' | 'g3' | 'g4' | 'g5' | 'g6'}
 */
export function columnOf(gates) {
  const last = gates.rounds.at(-1)
  if (last === undefined) return 'ready'
  if (gates.marks[5] === 'running') return 'g6'
  if (last.outcome === 'sentBack') return 'g2'
  if (last.outcome === 'red')
    return last.gate === 1 ? 'ready' : last.gate === 2 ? 'g2' : last.gate === 3 ? 'g3' : 'g4'
  let gate = last.gate === 4 ? 3 : last.gate + 1
  while (gate < 5 && ['passed', 'omitted'].includes(gates.marks[gate - 1] ?? '')) gate += 1
  if (gate <= 2) return 'g2'
  return gate === 3 ? 'g3' : gate === 4 ? 'g4' : 'g5'
}

/**
 * A milestone as REST returns it, the fields the share reads.
 *
 * @typedef {{ number: number, title: string, open_issues: number, closed_issues: number }} RepoMilestone
 */

/**
 * The factory's share of a release line: the issues of the milestones whose front is `Foundations`
 * over the issues of every milestone of the same line, in the repositories of every pair of the spaces. A
 * milestone's issues are its `open_issues` and `closed_issues` as REST returns them. The line is that of the
 * first pair whose milestone is in `.github/project-fields.json`, the spaces and their pairs in order; the
 * front of a repository named in `frontByRepository` is that one's.
 *
 * @param {object} input
 * @param {Record<string, { releaseLine?: string, front?: string, frontByRepository?: Record<string, string> }>} input.fields `.github/project-fields.json`, by milestone title
 * @param {Record<string, RepoMilestone[]>} input.milestones each repository's milestones, `owner/name` to its list
 * @param {{ repo: string, milestone: number, pairs?: import('./panel.js').Pair[] }[]} input.spaces
 * @returns {{ line: string, foundations: number, total: number, percent: number } | null} `null` when no pair's milestone gives a line
 */
export function factoryShare({ fields, milestones, spaces }) {
  let line = null
  for (const pair of spaces.flatMap((space) => pairsOf(space))) {
    const own = milestones[pair.repo]?.find((m) => m.number === pair.milestone)
    const found = own === undefined ? undefined : fields[own.title]?.releaseLine
    if (found !== undefined) {
      line = found
      break
    }
  }
  if (line === null) return null
  let foundations = 0
  let total = 0
  for (const [repo, list] of Object.entries(milestones)) {
    const name = repo.split('/')[1] ?? repo
    for (const milestone of list) {
      const entry = fields[milestone.title]
      if (entry?.releaseLine !== line) continue
      const count = milestone.open_issues + milestone.closed_issues
      total += count
      if ((entry.frontByRepository?.[name] ?? entry.front) === 'Foundations') foundations += count
    }
  }
  return {
    line,
    foundations,
    total,
    percent: total === 0 ? 0 : Math.round((foundations / total) * 100),
  }
}

/**
 * @typedef {object} BoardInput
 * @property {number} now milliseconds since the epoch
 * @property {{ sources: Record<string, { value: unknown, at?: string | null, stale?: boolean }> }} state
 * @property {import('./panel.js').Github | null} github
 * @property {{ spaces: import('./panel.js').SpaceConfig[], maintainer?: string }} config
 * @property {{ line: string, foundations: number, total: number, percent: number } | null} [share]
 * @property {{ space: string, lane: string }} [filter] `all` or a space's name; `all` or a lane tag
 * @property {'dark' | 'light'} [theme]
 */

/**
 * A card of the Board: one issue.
 *
 * @typedef {object} BoardCard
 * @property {string} space
 * @property {string} letter
 * @property {string} colour
 * @property {number} number
 * @property {string} id its reference (`refOf` of `panel.js`)
 * @property {string} repo
 * @property {string} lane
 * @property {string} round
 * @property {string} text
 * @property {string | null} agent
 * @property {string | null} cat a file of `cats/`
 * @property {string | null} [role]
 * @property {string | null} state
 * @property {string} time
 * @property {number} at when it merged, or how long it has waited
 * @property {string | null} mark
 */

/** The day of a timestamp, `YYYY-MM-DD`, UTC. @param {number} ms */
const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10)

/**
 * The Board: the summary, the filters and the columns.
 *
 * @param {BoardInput} input
 */
export function buildBoard({
  now,
  state,
  github,
  config,
  share = null,
  filter = { space: 'all', lane: 'all' },
  theme = 'dark',
}) {
  const slots = /** @type {import('./slots.js').Slots | null} */ (
    state.sources['slots']?.value ?? null
  )
  const machine = /** @type {import('./machine.js').Machine | null} */ (
    state.sources['machine']?.value ?? null
  )
  const agents = /** @type {import('./agents.js').Agent[]} */ (state.sources['agents']?.value ?? [])
  const cores = machine?.cores ?? 0
  const load = machine?.load1 ?? null
  const loadTone = load === null ? 'fg' : loadBars([{ at: now, load }], now, cores, 1)[0]?.tone
  const summary = [
    {
      key: 'load',
      label: 'LOAD',
      value: load === null ? '—' : `${load.toFixed(1)}/${cores}`,
      tone: loadTone === 'cyan' ? 'fg' : (loadTone ?? 'fg'),
    },
    {
      key: 'heavy',
      label: 'HEAVY',
      value: `${slots?.heavy.used ?? 0}/${slots?.heavy.total ?? 0}`,
      tone: 'fg',
    },
    {
      key: 'workers',
      label: 'WORKERS',
      value: `${slots?.leases.used ?? 0}/${slots?.leases.total ?? 0}`,
      tone: 'fg',
    },
    { key: 'queue', label: 'QUEUE', value: String(slots?.queue.length ?? 0), tone: 'fg' },
    {
      key: 'orphans',
      label: 'ORPHANS',
      value: String(slots?.orphans.length ?? 0),
      tone: (slots?.orphans.length ?? 0) > 0 ? 'red' : 'fg',
    },
    {
      key: 'share',
      label: 'FACTORY SHARE',
      value: share === null ? '—' : `${share.percent}%`,
      tone: 'fg',
    },
  ]

  /** @type {Record<string, BoardCard[]>} */
  const columns = Object.fromEntries(COLUMNS.map((c) => [c.key, []]))
  /** @type {{ key: string, label: string, letter: string, colour: string, merged: string }[]} */
  const spaceFilters = []
  config.spaces.forEach((space, at) => {
    const letter = (space.name[0] ?? '?').toUpperCase()
    const colour = SPACE_COLOURS[at % SPACE_COLOURS.length] ?? 'muted'
    const reads = pairReads(space, github?.spaces[space.name])
    const inSpace = agents.filter((a) => a.space?.name === space.name)
    const master = inSpace.find((a) => a.role === 'master') ?? null
    const all = reads.flatMap((r) => r.raw.issues)
    const closed = all.filter((i) => i.state === 'closed').length
    spaceFilters.push({
      key: space.name,
      label: space.name.toUpperCase(),
      letter,
      colour,
      merged: reads.length === 0 ? '—' : `${closed}/${all.length}`,
    })
    if (filter.space !== 'all' && filter.space !== space.name) return
    for (const { pair, raw } of reads) {
      const ofPair = inSpace.filter((a) => onPair(a, pair))
      const issues = raw.issues
      const open = new Set(issues.filter((i) => i.state !== 'closed').map((i) => i.number))
      for (const issue of issues) {
        const isClosed = issue.state === 'closed'
        const gates = parseGates({
          comments: raw.comments[issue.number] ?? [],
          maintainer: raw.maintainer,
          closed: isClosed,
          needsYou: ofPair.some((a) => a.needsYou && a.issue === issue.number),
        })
        const lane = gates.lane.toUpperCase()
        if (filter.lane !== 'all' && filter.lane !== lane) continue
        const base = {
          space: space.name,
          letter,
          colour,
          number: issue.number,
          id: refOf(space, pair, issue.number),
          repo: pair.repo,
          lane,
        }
        if (isClosed) {
          const closedAt = toMs(/** @type {{ closed_at?: string }} */ (issue).closed_at)
          if (closedAt === null || dayOf(closedAt) !== dayOf(now)) continue
          columns['merged']?.push({
            ...base,
            round: '',
            text: 'Merged today',
            agent: null,
            cat: null,
            state: null,
            time: `${new Date(closedAt).toISOString().slice(11, 16)}`,
            at: closedAt,
            mark: null,
          })
          continue
        }
        const labels = /** @type {{ labels?: { name?: string }[] }} */ (issue).labels ?? []
        const column = columnOf(gates)
        // Status Ready is the `ready` label that `issue-ready` sets with it; an open issue with no gate comment and no label is still Todo.
        if (column === 'ready' && !labels.some((l) => l.name === 'ready')) continue
        const onIt = ofPair.filter((a) => a.issue === issue.number && a.role !== null)
        const wanted = COLUMN_ROLE[/** @type {keyof typeof COLUMN_ROLE} */ (column)]
        const agent =
          onIt.find((a) => a.role === wanted) ??
          (wanted === 'master' ? master : null) ??
          (column === 'ready' ? null : (onIt[0] ?? null))
        const blockedBy = dependsOn(issue.body).filter((n) => open.has(n) && n !== issue.number)
        const needs = gates.marks.includes('needs') || onIt.some((a) => a.needsYou)
        const held = gates.marks.includes('held')
        const red = gates.marks.includes('red') || (column === 'ready' && gates.rounds.length > 0)
        const mark = red ? 'red' : needs ? 'needs' : held ? 'held' : null
        const since = gates.since ?? toMs(issue.created_at)
        const age = since === null ? null : Math.max(0, now - since)
        const last = gates.rounds.at(-1)
        const text =
          blockedBy.length > 0 && gates.rounds.length === 0
            ? `Blocked by ${blockedBy.map((n) => refOf(space, pair, n)).join(', ')}`
            : onIt.some((a) => a.needsYou)
              ? `${onIt.find((a) => a.needsYou)?.role} is blocked: it may need you`
              : column === 'g5'
                ? 'Waits for your sign-off'
                : mark === 'red' && last?.summary
                  ? last.summary
                  : (issue.title ?? '')
        const state =
          agent === null
            ? 'idle'
            : mark === 'needs'
              ? 'needs'
              : mark === 'held'
                ? 'held'
                : mark === 'red'
                  ? 'red'
                  : catState(agent.status)
        const lead = mark === 'needs' ? 'waiting ' : mark === 'held' ? 'held ' : ''
        columns[column]?.push({
          ...base,
          round: gates.round > 0 ? `r${gates.round}${mark === 'held' ? ' · HELD' : ''}` : '',
          text,
          agent:
            agent === null
              ? null
              : (agent.name ?? (agent.role === 'master' ? 'master' : agent.address)),
          cat: agent === null ? null : (catFile(agent.role, state, 16, theme) ?? null),
          role: agent?.role ?? null,
          state,
          time: age === null ? '—' : `${lead}${formatAge(age)}`,
          at: age ?? 0,
          mark,
        })
      }
    }
  })
  // The oldest wait of the maintainer first, the newest merge first, the rest by space and number.
  columns['g5']?.sort((a, b) => b.at - a.at)
  columns['merged']?.sort((a, b) => b.at - a.at)

  const stale = github !== null && Object.values(github.spaces).some((s) => s.stale)
  // A local source whose read failed shows its last value: the note says since when.
  const notLive = ['machine', 'slots', 'agents'].filter((n) => state.sources[n]?.stale === true)
  const since = notLive
    .map((n) => toMs(state.sources[n]?.at))
    .filter((ms) => ms !== null)
    .toSorted((a, b) => a - b)[0]
  const notes = [
    config.maintainer === '' ? 'No maintainer login: the gates are not read' : null,
    stale ? 'GitHub is stale: the cards are as of the last good read' : null,
    notLive.length === 0
      ? null
      : `Not live since ${hourUtc(since === undefined ? null : new Date(since).toISOString())}: ${notLive.join(', ')}`,
  ].filter((n) => n !== null)
  return {
    summary,
    note: notes.length === 0 ? null : notes.join(' · '),
    filters: {
      spaces: [
        {
          key: 'all',
          label: 'ALL SPACES',
          pressed: filter.space === 'all',
          colour: null,
          letter: null,
        },
        ...spaceFilters.map((s) => ({
          key: s.key,
          label: `${s.label} · ${s.merged}`,
          pressed: filter.space === s.key,
          colour: s.colour,
          letter: s.letter,
        })),
      ],
      lanes: [
        { key: 'all', label: 'ALL LANES', pressed: filter.lane === 'all' },
        ...LANE_FILTERS.map((l) => ({ key: l, label: l, pressed: filter.lane === l })),
      ],
    },
    columns: COLUMNS.map((c) => ({
      key: c.key,
      title: c.title,
      count: (columns[c.key] ?? []).length,
      yours: c.key === 'g5',
      cards: columns[c.key] ?? [],
    })),
  }
}
