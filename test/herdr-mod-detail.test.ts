import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createAdapters, readConfig } from '../herdr/mod/factory/adapters.js'
import {
  buildDetail,
  formatTokens,
  parseNumstat,
  parseProgress,
  sumTokens,
} from '../herdr/mod/factory/lib/detail.js'
import { modelOf, parseAgents } from '../herdr/mod/factory/lib/agents.js'
import { summaryOf } from '../herdr/mod/factory/lib/gates.js'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const FIXTURES = ['test/fixtures/herdr-mod/detail', 'test/fixtures/herdr-mod']
const SPACE = { repo: 'bogd3v/micelio-engineering', letter: 'M', colour: 'space-m' }

interface Cell {
  gate: number
  mark: string
  text: string
}
interface Row {
  name: string
  address: string | null
  role: string
  model: string
  state: string
  tokens: number | null
  tokensText: string
  cat: string | null
}
interface Detail {
  rounds: { name: string; cells: Cell[] }[]
  agents: Row[]
  packet: { label: string; path: string | null; file: boolean }[]
  header: Record<string, unknown>
  closing: string
}

const readTextFile = async (path: string): Promise<string | null> => {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return null
  }
}

/** What `main.js` builds for issue 302 from the fixture folder `detail/`. */
async function fixtureDetail(number = 302): Promise<Detail> {
  const config = readConfig({
    checkout: ROOT.replace(/\/$/, ''),
    maintainer: 'ale9420',
    fixture: FIXTURES,
    spaces: [{ name: 'micelio-engineering', repo: SPACE.repo, milestone: 12, epic: 790 }],
  })
  const a = createAdapters({
    exec: () => Promise.reject(new Error('a fixture runs no program')),
    readTextFile,
    terminals: () => [],
    config,
  })
  const github = (await a.readGithub(config.spaces[0])) as Extract<
    Awaited<ReturnType<typeof a.readGithub>>,
    { at: string }
  >
  const read = await a.readAgents()
  const issue = github.issues.find((i: { number: number }) => i.number === number)
  return buildDetail({
    issue: issue!,
    comments: github.comments[number],
    maintainer: github.maintainer,
    space: SPACE,
    agents: parseAgents(read.terminals!),
    terminals: read.terminals!,
    stacks: [],
    worktree: await a.readWorktree(number, '~/Git/wt-302'),
    theme: 'dark',
  })
}

const comment = (body: string, id: number, login = 'ale9420') => ({
  id,
  user: { login },
  created_at: `2026-11-24T10:${String(id).padStart(2, '0')}:00Z`,
  body,
})
const issueOf = (body: string | null) => ({ number: 5, title: 'a title', state: 'open', body })
const detailOf = (
  comments: ReturnType<typeof comment>[],
  body: string | null = null,
  extra: object = {}
): Detail =>
  buildDetail({
    issue: issueOf(body),
    comments,
    maintainer: 'ale9420',
    space: SPACE,
    agents: [],
    terminals: [],
    stacks: [],
    worktree: null,
    theme: 'dark',
    ...extra,
  })

describe('gates by round', () => {
  it('an issue with two rounds has two rows of six cells, and a gate its lane omits is omitted in both', () => {
    const express = detailOf([
      comment('**Gate 1 (master): pass**\n\nlane: express\n', 1),
      comment('**Gate 2, round 1 (worker-5)** · draft ok', 2),
      comment('**Gate 2, round 2 (worker-5)** · draft ok again', 3),
    ])
    expect(express.rounds.map((r) => r.name)).toEqual(['r1', 'r2'])
    for (const round of express.rounds) {
      expect(round.cells).toHaveLength(6)
      expect(round.cells.map((c) => c.gate)).toEqual([1, 2, 3, 4, 5, 6])
      expect(round.cells.filter((c) => c.mark === 'omitted').map((c) => c.gate)).toEqual([3, 4])
    }
    expect(express.rounds[0]?.cells[1]?.text).toBe('draft ok')
    expect(express.rounds[1]?.cells[1]?.text).toBe('draft ok again')

    const normal = detailOf([
      comment('**Gate 1 (master): pass**\n\nlane: normal\n', 1),
      comment('**Gate 2, round 1 (worker-5)** · draft ok', 2),
      comment('**Gate 3, round 1 (reviewer-5)** · 1 Blocking, 4 Important', 3),
      comment('**Gate 2, round 2 (worker-5)** · draft ok', 4),
    ])
    expect(normal.rounds).toHaveLength(2)
    expect(normal.rounds.every((r) => r.cells.length === 6)).toBe(true)
    expect(normal.rounds.flatMap((r) => r.cells).some((c) => c.mark === 'omitted')).toBe(false)
    expect(normal.rounds[0]?.cells.map((c) => [c.mark, c.text])).toEqual([
      ['passed', 'pass'],
      ['passed', 'draft ok'],
      ['red', '1 Blocking, 4 Important'],
      ['notReached', '--'],
      ['notReached', '--'],
      ['notReached', '--'],
    ])
  })

  it('the fixture issue has two rounds of six cells, the second still running', async () => {
    const detail = await fixtureDetail()
    expect(detail.rounds).toHaveLength(2)
    expect(detail.rounds.map((r) => r.cells.length)).toEqual([6, 6])
    expect(detail.rounds[0]?.cells[3]).toEqual({
      gate: 4,
      mark: 'red',
      text: '2 mismatches: 3143 vs 3147 tests',
    })
  })

  it('a gate with a verdict from an earlier round and none in the latest round is not drawn with the old verdict', async () => {
    const detail = await fixtureDetail()
    // round 1: G3 red (1 Blocking); round 2 has only the worker's comment, and the reviewer is idle
    expect(detail.rounds[0]?.cells[2]).toMatchObject({
      mark: 'red',
      text: '1 Blocking, 4 Important',
    })
    expect(detail.rounds[1]?.cells[2]).toEqual({ gate: 3, mark: 'notReached', text: 'waits' })
    expect(detail.rounds[1]?.cells[3]).toEqual({ gate: 4, mark: 'notReached', text: 'waits' })
    // the reviewer works: the cell runs; it asks for the maintainer: the cell needs you
    const comments = [
      comment('**Gate 1 (master): pass**\n\nlane: normal\n', 1),
      comment('**Gate 3, round 1 (reviewer-5)** · 1 Blocking', 2),
      comment('**Gate 2, round 2 (worker-5)** · draft ok', 3),
    ]
    const agent = (status: string) => ({
      address: 't9',
      name: 'reviewer-5',
      role: 'reviewer',
      status,
      needsYou: status === 'blocked',
      issue: 5,
      space: null,
    })
    for (const [status, mark, text] of [
      ['working', 'running', 'running'],
      ['blocked', 'needs', 'needs you'],
    ]) {
      const r2 = detailOf(comments, null, { agents: [agent(status as string)] }).rounds[1]
      expect(r2?.cells[2]).toEqual({ gate: 3, mark, text })
    }
  })

  it('a gate comment keeps its first line after `Gate N, round K (agent)`', () => {
    expect(summaryOf('Gate 3, round 1 (reviewer-5) · 1 Blocking, 2 Important')).toBe(
      '1 Blocking, 2 Important'
    )
    expect(summaryOf('Gate 1 (master): pass')).toBe('pass')
    expect(summaryOf('Gate 2, round 2')).toBe('')
  })
})

describe('agents on the issue', () => {
  it('the tokens of each agent are the sum of its tokens lines', async () => {
    const detail = await fixtureDetail()
    const by = (role: string) => detail.agents.find((a) => a.role === role)
    // worker: the maintainer's two lines of #302 (1,200,000 + 700,000, and 300,000 + 100,000); the
    // line of #301 and the one of another login are not its.
    expect(by('worker')?.tokens).toBe(1_900_000 + 400_000)
    expect(by('worker')?.tokensText).toBe('2.3 M')
    expect(by('reviewer')?.tokens).toBe(420_000)
    // the verifier has no terminal any more: its row is made from its line
    expect(by('verifier')).toMatchObject({
      name: 'verifier-302',
      address: null,
      state: 'done',
      tokens: 600_000,
    })
    // the master's tokens are on the epic, not on the issue
    expect(by('master')?.tokens).toBeNull()
    expect(by('master')?.tokensText).toBe('--')
  })

  it('sums input plus output by role, for the issue and the maintainer only', () => {
    const lines = [
      'tokens | 2026-11-24 | 5 | worker | 1 | 10 | 20 | 999',
      'tokens | 2026-11-24 | #5 | worker | 2 | 1 | 2 | 999',
      'tokens | 2026-11-24 | 6 | worker | 1 | 100 | 100 | 0',
      'tokens | 2026-11-24 | 5 | worker | 1 | ten | 2 | 0',
      'tokens | 2026-11-24 | 5 | reviewer | 1 | 4 | 5 | 6 | extra',
    ].join('\n')
    const sums = sumTokens(
      [comment(lines, 1), comment('tokens | 2026-11-24 | 5 | worker | 1 | 7 | 7 | 7', 2, 'bob')],
      'ale9420',
      5
    )
    expect([...sums]).toEqual([['worker', 33]])
    expect(formatTokens(812)).toBe('812')
    expect(formatTokens(165_900)).toBe('165.9k')
    expect(formatTokens(1_900_000)).toBe('1.9 M')
    expect(formatTokens(null)).toBe('--')
  })

  it('the model is the argument of --model, and the master and the fixture shape have the column the findings give', async () => {
    const detail = await fixtureDetail()
    expect(detail.agents.map((a) => [a.role, a.model, a.state])).toEqual([
      ['master', '--', 'working'],
      ['worker', 'Sonnet', 'working'],
      ['reviewer', 'Opus', 'idle'],
      ['verifier', '--', 'done'],
    ])
    expect(modelOf({ address: 't1', foreground: { argv: ['claude', '--model'] } })).toBeNull()
    expect(modelOf({ address: 't1' })).toBeNull()
    // no context column: no field of terminals() carries one (herdr/mod/findings.md, question 4)
    for (const agent of detail.agents) expect(Object.keys(agent)).not.toContain('context')
  })
})

describe('packet', () => {
  const progress = (text: string) =>
    `## Why\n\nx\n\n### Progress\n\n${text}\n\n---\n_Generated by [Claude Code](https://claude.ai/code)_\n`

  it("the packet paths are those of the issue's Progress section", async () => {
    const detail = await fixtureDetail()
    expect(detail.packet).toEqual([
      { label: 'WORKTREE', path: '~/Git/wt-302', file: false },
      { label: 'DRAFT', path: '~/.cache/factory/packets/302/draft.md', file: true },
      { label: 'DECISIONS', path: '~/.cache/factory/packets/302/r2/decisions.md', file: true },
      {
        label: 'COMMIT MESSAGE',
        path: '~/.cache/factory/packets/302/commit-message.txt',
        file: true,
      },
    ])
  })

  it('parseProgress reads a Progress section headed ## Progress as it reads one headed ### Progress', () => {
    const text =
      'Worktree `/w/wt-9`, packet directory `/p/9/`, branch `fix/factory-9`, draft `/d/draft.md`.'
    const expected = {
      worktree: '/w/wt-9',
      packet: '/p/9/',
      draft: '/d/draft.md',
      branch: 'fix/factory-9',
    }
    expect(parseProgress(`## Why\n\nx\n\n## Progress\n\n${text}\n`)).toEqual(expected)
    expect(parseProgress(`## Why\n\nx\n\n### Progress\n\n${text}\n`)).toEqual(expected)
  })

  it('a ## Progress section ends at the next heading of level 1 or 2, and a ### Progress section at the next heading of level 1 to 3', () => {
    const none = { worktree: null, packet: null, draft: null, branch: null }
    const after = 'worktree `/after`'
    expect(parseProgress(`## Progress\n\nNothing.\n\n## Next\n\n${after}\n`)).toEqual(none)
    expect(parseProgress(`## Progress\n\nNothing.\n\n# Next\n\n${after}\n`)).toEqual(none)
    expect(parseProgress(`### Progress\n\nNothing.\n\n### Next\n\n${after}\n`)).toEqual(none)
    expect(parseProgress(`### Progress\n\nNothing.\n\n## Next\n\n${after}\n`)).toEqual(none)
    expect(parseProgress(`## Progress\n\nNothing.\n\n---\n\n${after}\n`)).toEqual(none)
    // a deeper heading, and a ### one under ## Progress, stay inside the section
    expect(parseProgress(`## Progress\n\n### Round 1\n\nworktree \`/in\`\n`).worktree).toBe('/in')
    expect(parseProgress(`### Progress\n\n#### Round 1\n\nworktree \`/in\`\n`).worktree).toBe('/in')
  })

  it('a heading Progress of level 1 or 4 is not read', () => {
    const none = { worktree: null, packet: null, draft: null, branch: null }
    expect(parseProgress('# Progress\n\nworktree `/w`\n')).toEqual(none)
    expect(parseProgress('#### Progress\n\nworktree `/w`\n')).toEqual(none)
  })

  it('a Progress section that names no packet leaves its paths out, and one elsewhere in the body is not read', () => {
    expect(detailOf([], progress('Nothing yet.')).packet.map((p) => p.path)).toEqual([
      null,
      null,
      null,
      null,
    ])
    expect(
      parseProgress('## Why\n\nworktree `/elsewhere`\n\n### Progress\n\nNothing yet.\n')
    ).toEqual({ worktree: null, packet: null, draft: null, branch: null })
    expect(parseProgress(null)).toEqual({ worktree: null, packet: null, draft: null, branch: null })
    const named = parseProgress(
      progress('Worktree `/w/wt-9`, packet `/p/9/`, branch `fix/factory-9`, draft `/d/draft.md`.')
    )
    expect(named).toEqual({
      worktree: '/w/wt-9',
      packet: '/p/9/',
      draft: '/d/draft.md',
      branch: 'fix/factory-9',
    })
    const detail = detailOf([], progress('Packet directory `/p/9/`.'))
    expect(detail.packet.map((p) => p.path)).toEqual([
      null,
      '/p/9/draft.md',
      '/p/9/r1/decisions.md',
      '/p/9/commit-message.txt',
    ])
  })
})

describe('header and the closing sentence', () => {
  it('names the lane, the issue, the branch and the lines changed, and has no decision block', async () => {
    const detail = await fixtureDetail()
    expect(detail.header).toEqual({
      letter: 'M',
      colour: 'space-m',
      lane: 'NORMAL',
      id: 'bogd3v/micelio-engineering#302',
      branch: 'feat/factory-302',
      stack: 'no stack up',
      added: 612,
      removed: 14,
    })
    expect(detail.closing).toBe(
      "The worker's pane opens read-only. Answers always go through the master."
    )
    expect(Object.keys(detail)).not.toContain('decision')
  })

  it('names a stack of the issue and counts added and removed lines from numstat', () => {
    const detail = detailOf([], null, { stacks: [{ name: 'wt-5' }, { name: 'wt-55' }] })
    expect(detail.header['stack']).toBe('stack up: wt-5')
    expect(parseNumstat('3\t1\ta.js\n-\t-\timg.png\n10\t0\tb.js\n')).toEqual({
      added: 13,
      removed: 1,
    })
  })

  it('reads the worktree of a fixture and reports a missing one', async () => {
    const config = readConfig({
      checkout: ROOT,
      fixture: [join(ROOT, FIXTURES[0] ?? '')],
      spaces: [],
    })
    const a = createAdapters({
      exec: () => Promise.reject(new Error('no program')),
      readTextFile,
      terminals: () => [],
      config,
    })
    expect(await a.readWorktree(302, '/x')).toEqual({
      branch: 'feat/factory-302',
      added: 612,
      removed: 14,
    })
    expect(await a.readWorktree(1, '/x')).toEqual({ error: 'no worktree-1.json in the fixture' })
  })
})

describe('an issue of another repository of the space', () => {
  it('the detail of an issue of another repository names that repository and reads its tagged worktree and comments', async () => {
    const config = readConfig({
      checkout: ROOT.replace(/\/$/, ''),
      maintainer: 'ale9420',
      fixture: ['test/fixtures/herdr-mod/spaces', 'test/fixtures/herdr-mod'],
      spaces: [
        { name: 'fixture-space', repo: 'bogd3v/fixture', milestone: 1 },
        { name: 'fixture-space', repo: 'bogd3v/fixture-two', milestone: 3, tag: 'tw' },
      ],
    })
    const a = createAdapters({
      exec: () => Promise.reject(new Error('a fixture runs no program')),
      readTextFile,
      terminals: () => [],
      config,
    })
    const github = (await a.readGithub(config.spaces[0])) as Extract<
      Awaited<ReturnType<typeof a.readGithub>>,
      { at: string }
    >
    const [other] = github.others!
    const issue = other.issues.find((i: { number: number }) => i.number === 5)
    const read = await a.readAgents()
    const detail = buildDetail({
      issue: issue!,
      comments: other.comments[5],
      maintainer: github.maintainer,
      space: {
        repo: 'bogd3v/fixture-two',
        letter: 'F',
        colour: 'space-m',
        name: 'fixture-space',
        tag: 'tw',
        ref: 'bogd3v/fixture-two#5',
        tags: ['tw'],
      },
      agents: parseAgents(read.terminals!),
      terminals: read.terminals!,
      stacks: [{ name: 'wt-5' }, { name: 'wt-tw5' }],
      worktree: await a.readWorktree(5, '~/Git/fixture-two/wt-tw5', 'tw'),
      theme: 'dark',
      now: Date.parse('2026-11-24T16:00:00Z'),
    }) as Detail & { decision: { ref: string; question: string } }
    expect(detail.header).toEqual({
      letter: 'F',
      colour: 'space-m',
      lane: 'FULL',
      id: 'bogd3v/fixture-two#5',
      branch: 'feat/factory-tw5',
      stack: 'stack up: wt-tw5',
      added: 40,
      removed: 3,
    })
    // Its comments are those of `comments-tw5.json`: the open decision, answered by its reference.
    expect(detail.decision).toMatchObject({
      ref: 'bogd3v/fixture-two#5',
      question: 'Which schema does the block keep?',
    })
    // Its agents are the master and worker-tw5, not worker-5 of the space's repository.
    expect(detail.agents.map((r) => r.name)).toEqual(['master', 'worker-tw5'])
    expect(await a.readWorktree(5, '/x')).toEqual({ error: 'no worktree-5.json in the fixture' })
  })

  it('the commit subject of an issue of another repository is read from commit-<tag><n>.txt', async () => {
    const a = createAdapters({
      exec: () => Promise.reject(new Error('a fixture runs no program')),
      readTextFile,
      terminals: () => [],
      config: readConfig({
        checkout: ROOT.replace(/\/$/, ''),
        fixture: ['test/fixtures/herdr-mod/spaces'],
        spaces: [],
      }),
    })
    expect(await a.readCommit(5, '/x', 'tw')).toBe('feat(two): the issue of the other repository')
    expect(await a.readCommit(5, '/x')).toBeNull()
  })
})
