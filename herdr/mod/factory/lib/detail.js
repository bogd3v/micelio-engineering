// The issue detail as plain data: the header, the rounds with their six cells, the agents with the
// tokens summed from the `tokens |` lines, and the packet's paths from the issue's `### Progress`.
// A function of its arguments: the time, the issue, its comments and the terminals are given by the
// caller. `views/detail.js` only draws it.

import { issueOfName, modelOf } from './agents.js'
import { catFile } from './cat.js'
import { parseGates } from './gates.js'
import { parseDecision } from './decision.js'
import { catState, formatAge } from './panel.js'

/** The six columns of "Gates by round". */
export const GATE_NAMES = ['G1 READY', 'G2 WORKER', 'G3 REVIEW', 'G4 SCRIPT', 'G5 YOU', 'G6 CI']

/** The closing sentence of the overlay. */
export const CLOSING = "The worker's pane opens read-only. Answers always go through the master."

/** The role whose agent runs G2, G3 and G4. */
const GATE_ROLE = ['worker', 'reviewer', 'verifier']

/** The text of a cell that has no comment: what its gate's mark says. */
const PENDING = {
  running: 'running',
  needs: 'needs you',
  held: 'held',
  red: 'red',
  passed: 'passed',
}

/**
 * The lines changed, from the text of `git diff --numstat`: added and removed, binary files counted
 * as 0.
 *
 * @param {string} text
 * @returns {{ added: number, removed: number }}
 */
export function parseNumstat(text) {
  let added = 0
  let removed = 0
  for (const line of text.split(/\r?\n/)) {
    const [a = '', r = ''] = line.split('\t')
    if (/^\d+$/.test(a)) added += Number(a)
    if (/^\d+$/.test(r)) removed += Number(r)
  }
  return { added, removed }
}

/**
 * The paths an issue's `### Progress` section names: the worktree, the packet directory, the draft
 * and the branch, each as a `code span` after its word (`worktree`, `packet directory`, `draft`,
 * `branch`). `null` for one it does not name.
 *
 * @param {unknown} body the issue's body
 * @returns {{ worktree: string | null, packet: string | null, draft: string | null, branch: string | null }}
 */
export function parseProgress(body) {
  const found = { worktree: null, packet: null, draft: null, branch: null }
  if (typeof body !== 'string') return found
  const section = /^###\s+Progress\s*$([\s\S]*?)(?=^#{1,3}\s|^---\s*$|(?![\s\S]))/m.exec(body)
  if (section === null) return found
  const word =
    /\b(worktree|packet(?: dir(?:ectory)?| folder)?|draft|branch)\b[^`\n]{0,40}?`([^`\n]+)`/gi
  for (const match of (section[1] ?? '').matchAll(word)) {
    const key = /** @type {string} */ (match[1]).toLowerCase().split(' ')[0]
    const value = (match[2] ?? '').trim()
    if (key === 'worktree' || key === 'packet' || key === 'draft' || key === 'branch') {
      if (found[key] === null && value !== '') found[key] = value
    }
  }
  return found
}

/**
 * A count of tokens as the design writes it: `1.9 M`, `165.9k`, `812`.
 *
 * @param {number | null} n
 * @returns {string}
 */
export function formatTokens(n) {
  if (n === null) return '--'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} M`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

/**
 * The `tokens |` lines of an issue's comments, summed by role: input plus output, as `factory-tools
 * metrics` does. Only the maintainer's login counts.
 *
 * @param {{ user?: { login?: string }, body?: string }[]} comments
 * @param {string} maintainer
 * @param {number} issue
 * @returns {Map<string, number>}
 */
export function sumTokens(comments, maintainer, issue) {
  /** @type {Map<string, number>} */
  const sums = new Map()
  for (const comment of comments) {
    if (comment.user?.login !== maintainer || typeof comment.body !== 'string') continue
    for (const line of comment.body.split(/\r?\n/)) {
      if (!line.startsWith('tokens | ')) continue
      const f = line.split(' | ').map((part) => part.trim())
      if (f.length !== 8) continue
      const [, , number = '', role = '', , input = '', output = ''] = f
      if (!/^#?\d+$/.test(number) || Number(number.replace('#', '')) !== issue) continue
      if (role === '' || !/^\d{1,15}$/.test(input) || !/^\d{1,15}$/.test(output)) continue
      sums.set(role, (sums.get(role) ?? 0) + Number(input) + Number(output))
    }
  }
  return sums
}

/** @param {string} word @returns {string} */
const capital = (word) => word.charAt(0).toUpperCase() + word.slice(1)

/**
 * The state of an agent as the table writes it, and the token that colours it.
 *
 * @param {string | null} status
 * @returns {{ text: string, tone: string }}
 */
function stateOf(status) {
  if (status === 'working') return { text: 'working', tone: 'cyan' }
  if (status === 'blocked') return { text: 'needs you', tone: 'magenta' }
  if (status === 'error') return { text: 'error', tone: 'red' }
  if (status === 'idle') return { text: 'idle', tone: 'muted' }
  return { text: 'done', tone: 'muted' }
}

/**
 * Everything the overlay draws.
 *
 * @param {object} input
 * @param {{ number: number, title?: string, body?: string | null, state?: string }} input.issue
 * @param {{ user?: { login?: string }, body?: string, created_at?: string, id?: number }[]} input.comments
 * @param {string} input.maintainer
 * @param {{ repo: string, letter: string, colour: string, name?: string, tag?: string, ref?: string, tags?: string[] }} input.space the repository of the issue's pair (the header names it), its tag, the issue's reference (`#N` with none) and the tags of the spaces' pairs
 * @param {import('./agents.js').Agent[]} input.agents the agents of the space: those of the issue are the ones with its pair's tag
 * @param {import('./agents.js').Terminal[]} input.terminals the rows of `terminals()`, for the model
 * @param {{ name: string }[]} input.stacks the stacks up
 * @param {{ branch: string | null, added: number | null, removed: number | null } | null} input.worktree what the worktree says
 * @param {'dark' | 'light'} input.theme
 * @param {number} [input.now] milliseconds since the epoch, for the age of a decision
 */
export function buildDetail({
  issue,
  comments,
  maintainer,
  space,
  agents,
  terminals,
  stacks,
  worktree,
  theme,
  now = 0,
}) {
  const closed = issue.state === 'closed'
  const tag = space.tag ?? ''
  const onIt = agents.filter(
    (a) => a.issue === issue.number && (a.tag ?? '') === tag && a.role !== null
  )
  const gates = parseGates({
    comments,
    maintainer,
    closed,
    needsYou: onIt.some((a) => a.needsYou),
  })

  // Gates by round: one row per round, six cells.
  const count = Math.max(1, gates.round)
  const rounds = []
  for (let k = 1; k <= count; k += 1) {
    const cells = []
    for (let gate = 1; gate <= 6; gate += 1) {
      const mark = gates.marks[gate - 1] ?? 'notReached'
      if (mark === 'omitted') {
        cells.push({ gate, mark: 'omitted', text: '--' })
        continue
      }
      const said = gates.rounds.findLast((r) => r.gate === gate && (r.round ?? 1) === k)
      if (said !== undefined) {
        const cell = { passed: 'passed', red: 'red', sentBack: 'running' }[said.outcome]
        const word = { passed: 'passed', red: 'red', sentBack: 'sent back' }[said.outcome]
        cells.push({ gate, mark: cell, text: said.summary === '' ? word : said.summary })
      } else if (k < count) {
        cells.push({ gate, mark: 'notReached', text: '--' })
      } else if (gate >= 2 && gate <= 4 && gates.rounds.some((r) => r.gate === gate)) {
        // The gate has a verdict from an earlier round and none in this one: the track's mark is that
        // old verdict, not this round's. It runs only when its agent works, as the agents say.
        const agent = onIt.find((a) => a.role === GATE_ROLE[gate - 2])
        const state = agent?.needsYou ? 'needs' : agent?.status === 'working' ? 'running' : null
        cells.push(
          state === null
            ? { gate, mark: 'notReached', text: 'waits' }
            : { gate, mark: state, text: PENDING[state] }
        )
      } else if (mark === 'needs' && gate === 5) {
        cells.push({ gate, mark, text: 'waits for you' })
      } else if (mark === 'notReached') {
        cells.push({ gate, mark, text: gate <= 4 ? 'waits' : '--' })
      } else {
        cells.push({
          gate,
          mark,
          text: PENDING[/** @type {keyof typeof PENDING} */ (mark)] ?? '--',
        })
      }
    }
    rounds.push({ name: `r${k}`, cells })
  }

  // Agents on this issue: the live ones, then a roles that only has tokens lines.
  const sums = sumTokens(comments, maintainer, issue.number)
  const held = gates.marks.includes('held')
  /** @param {string} role @param {string} state */
  const file = (role, state) => catFile(role, held ? 'held' : state, 24, theme) ?? null
  const master = agents.find((a) => a.role === 'master') ?? null
  /** @type {{ name: string, address: string | null, role: string, model: string, state: string, tone: string, cat: string | null, catState: string, tokens: number | null, tokensText: string }[]} */
  const rows = []
  const taken = new Set()
  for (const agent of master === null ? onIt : [master, ...onIt]) {
    const role = agent.role ?? ''
    const state = stateOf(agent.status)
    const kind = catState(agent.status)
    const tokens = role === 'master' || taken.has(role) ? null : (sums.get(role) ?? null)
    if (role !== 'master') taken.add(role)
    const model = modelOf(terminals.find((t) => t.address === agent.address) ?? { address: '' })
    rows.push({
      name: agent.name ?? (role === 'master' ? 'master' : agent.address),
      address: agent.address,
      role,
      model: model === null ? '--' : capital(model),
      state: state.text,
      tone: state.tone,
      cat: file(role, kind),
      catState: held ? 'held' : kind,
      tokens,
      tokensText: formatTokens(tokens),
    })
  }
  for (const [role, sum] of sums) {
    if (taken.has(role)) continue
    rows.push({
      name: `${role}-${tag}${issue.number}`,
      address: null,
      role,
      model: '--',
      state: 'done',
      tone: 'muted',
      cat: file(role, 'idle'),
      catState: held ? 'held' : 'idle',
      tokens: sum,
      tokensText: formatTokens(sum),
    })
  }

  // Packet.
  const progress = parseProgress(issue.body)
  const at = progress.packet?.replace(/\/+$/, '') ?? null
  const packet = [
    { label: 'WORKTREE', path: progress.worktree, file: false },
    {
      label: 'DRAFT',
      path: progress.draft ?? (at === null ? null : `${at}/draft.md`),
      file: true,
    },
    {
      label: 'DECISIONS',
      path: at === null ? null : `${at}/r${count}/decisions.md`,
      file: true,
    },
    {
      label: 'COMMIT MESSAGE',
      path: at === null ? null : `${at}/commit-message.txt`,
      file: true,
    },
  ]

  // Decision for you: the master's open `**Decision needed**` comment of the issue.
  const asked = closed ? null : parseDecision(comments, maintainer)
  const live = gates.marks.findIndex((m) => m === 'needs' || m === 'running')
  const decision =
    asked === null
      ? null
      : {
          number: issue.number,
          ref: space.ref ?? `#${issue.number}`,
          title: `Decision for you · G${live === -1 ? 2 : live + 1} · R${Math.max(1, gates.round)} · waiting ${formatAge(Math.max(0, now - asked.at))}`,
          question: asked.question,
          options: asked.options,
          master: master?.address ?? null,
          masterName: space.name ?? space.repo,
        }

  // The stack whose name ends in the issue's `<tag><N>`.
  const stack = stacks.find((s) => {
    const id = issueOfName(s.name, space.tags ?? (tag === '' ? [] : [tag]))
    return id !== null && id.issue === issue.number && id.tag === tag
  })
  return {
    number: issue.number,
    title: issue.title ?? '',
    header: {
      letter: space.letter,
      colour: space.colour,
      lane: gates.lane.toUpperCase(),
      id: `${space.repo}#${issue.number}`,
      branch: worktree?.branch ?? progress.branch,
      stack: stack === undefined ? 'no stack up' : `stack up: ${stack.name}`,
      added: worktree?.added ?? null,
      removed: worktree?.removed ?? null,
    },
    gateNames: GATE_NAMES,
    rounds,
    agents: rows,
    // Left out when no decision is open, so an issue without one has the model it had before.
    ...(decision === null ? {} : { decision }),
    packet,
    closing: CLOSING,
  }
}
