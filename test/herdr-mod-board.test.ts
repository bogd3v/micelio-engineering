import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createAdapters, readConfig } from '../herdr/mod/factory/adapters.js'
import { buildBoard, columnOf, factoryShare } from '../herdr/mod/factory/lib/board.js'
import { parseGates } from '../herdr/mod/factory/lib/gates.js'
import { buildGithub } from '../herdr/mod/factory/lib/panel.js'
import { buildState } from '../herdr/mod/factory/lib/state.js'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const FIXTURES = ['test/fixtures/herdr-mod/board', 'test/fixtures/herdr-mod']
const SPACES = [
  { name: 'micelio-engineering', repo: 'bogd3v/micelio-engineering', milestone: 12, epic: 790 },
  { name: 'fediverse', repo: 'bogd3v/fediverse', milestone: 3, epic: null },
]

const readTextFile = async (path: string): Promise<string | null> => {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return null
  }
}
const noExec = (): Promise<never> => Promise.reject(new Error('a fixture runs no program'))

interface Card {
  space: string
  id: string
  lane: string
  round: string
  text: string
  agent: string | null
  cat: string | null
  time: string
  mark: string | null
}
interface Column {
  key: string
  title: string
  count: number
  yours: boolean
  cards: Card[]
}

/** What `main.js` does in one round on the Board's fixture. */
async function round(filter = { space: 'all', lane: 'all' }) {
  const config = readConfig({
    checkout: ROOT.replace(/\/$/, ''),
    maintainer: 'ale9420',
    fixture: FIXTURES,
    spaces: SPACES,
  })
  const a = createAdapters({ exec: noExec, readTextFile, terminals: () => [], config })
  const now: number = await a.now()
  const state = buildState({
    now,
    fetched: {
      slots: await a.readSlots(),
      machine: await a.readMachine(),
      agents: await a.readAgents(),
    },
  })
  const reads: Record<string, unknown> = {}
  for (const space of config.spaces) reads[space.name] = await a.readGithub(space)
  const github = buildGithub({ now, spaces: config.spaces, reads })
  const milestones = await a.readMilestones(config.spaces)
  const fields = await a.readProjectFields()
  const share = factoryShare({
    fields: (fields as unknown as { fields: never }).fields,
    milestones: (milestones as unknown as { byRepo: never }).byRepo,
    spaces: config.spaces,
  })
  const board = buildBoard({ now, state, github, config, share, filter })
  return { board, share, github, config, milestones, fields }
}

const ids = (column: Column) => column.cards.map((c) => `${c.space}#${c.id.slice(1)}`)

describe('the board', () => {
  it("the Board's note names the stale machine, slots or agents source and the time of its last good read", async () => {
    const { board: live, github, config } = await round()
    expect(live.note).toBeNull()
    // Each source read at a different time, then three failed rounds: the oldest `at` is named.
    const a = createAdapters({ exec: noExec, readTextFile, terminals: () => [], config })
    const fetched = {
      slots: { ...(await a.readSlots()), at: '2026-11-24T15:50:00.000Z' },
      machine: { ...(await a.readMachine()), at: '2026-11-24T15:55:00.000Z' },
      agents: { ...(await a.readAgents()), at: '2026-11-24T15:58:00.000Z' },
    }
    const now = Date.parse('2026-11-24T16:00:00Z')
    const previous = buildState({ now, fetched })
    const noteOf = (names: string[], gh = github) =>
      buildBoard({
        now,
        state: buildState({
          now,
          fetched: Object.fromEntries(names.map((n) => [n, { error: 'no answer' }])),
          previous,
        }),
        github: gh,
        config,
      }).note
    expect(noteOf([])).toBeNull()
    expect(noteOf(['machine'])).toBe('Not live since 15:55 UTC: machine')
    expect(noteOf(['agents', 'slots'])).toBe('Not live since 15:50 UTC: slots, agents')
    expect(noteOf(['machine', 'slots', 'agents'])).toBe(
      'Not live since 15:50 UTC: machine, slots, agents'
    )
    // With GitHub stale as well, the two notes are joined.
    const stale = buildGithub({
      now,
      spaces: config.spaces,
      reads: Object.fromEntries(
        config.spaces.map((s: { name: string }) => [s.name, { error: 'gh' }])
      ),
      previous: github,
    })
    expect(noteOf(['machine'], stale)).toBe(
      'GitHub is stale: the cards are as of the last good read · Not live since 15:55 UTC: machine'
    )
  })

  it("with no maintainer login, the Board's note says the gates are not read", async () => {
    const { github, config } = await round()
    const now = Date.parse('2026-11-24T16:00:00Z')
    const state = { sources: {} }
    const none = { ...config, maintainer: '' }
    expect(buildBoard({ now, state, github, config: none }).note).toBe(
      'No maintainer login: the gates are not read'
    )
    // The other notes follow it.
    const stale = buildGithub({
      now,
      spaces: config.spaces,
      reads: Object.fromEntries(
        config.spaces.map((s: { name: string }) => [s.name, { error: 'gh' }])
      ),
      previous: github,
    })
    expect(buildBoard({ now, state, github: stale, config: none }).note).toBe(
      'No maintainer login: the gates are not read · GitHub is stale: the cards are as of the last good read'
    )
  })

  it('each issue of the fixture is in one column, the one of its last gate comment', async () => {
    const { board } = await round()
    const byColumn = Object.fromEntries((board.columns as Column[]).map((c) => [c.key, ids(c)]))
    expect(byColumn).toEqual({
      ready: ['micelio-engineering#801', 'micelio-engineering#813', 'fediverse#6'],
      g2: ['micelio-engineering#803'],
      g3: ['micelio-engineering#804', 'fediverse#5'],
      g4: ['micelio-engineering#805', 'micelio-engineering#808'],
      g5: ['micelio-engineering#806', 'micelio-engineering#809'],
      g6: ['micelio-engineering#807'],
      merged: ['fediverse#7', 'micelio-engineering#810'],
    })
    expect((board.columns as Column[]).map((c) => c.title)).toEqual([
      'Ready',
      'G2 · Worker',
      'G3 · Review',
      'G4 · Verify',
      'G5 · Needs you',
      'G6 · CI',
      'Merged today',
    ])
    // One column each: no issue twice, and the Todo one (no `ready` label), the one merged yesterday, the pull request and the epic are on none.
    const all = (board.columns as Column[]).flatMap(ids)
    expect(new Set(all).size).toBe(all.length)
    expect(all).toHaveLength(13)
    for (const out of [802, 811, 812, 790]) expect(all).not.toContain(`micelio-engineering#${out}`)
    // The gate 5 column is the maintainer's; the red one is marked, and so is each wait for the maintainer.
    expect((board.columns as Column[]).filter((c) => c.yours).map((c) => c.key)).toEqual(['g5'])
    const cards = Object.fromEntries(
      (board.columns as Column[]).flatMap((c) => c.cards.map((k) => [`${k.space}#${k.id}`, k]))
    )
    expect(cards['micelio-engineering##808']).toMatchObject({
      mark: 'red',
      agent: 'verifier-808',
      lane: 'FULL',
      round: 'r1',
    })
    expect(cards['micelio-engineering##806']).toMatchObject({
      mark: 'needs',
      agent: 'master',
      time: 'waiting 4 h',
    })
    expect(cards['micelio-engineering##813']).toMatchObject({
      text: 'Blocked by #801',
      agent: null,
      cat: null,
    })
    expect(cards['micelio-engineering##803']).toMatchObject({
      lane: 'NORMAL',
      agent: 'worker-803',
      cat: 'worker-working-head-dark.svg',
      time: '2 h',
    })
    expect(cards['fediverse##7']).toMatchObject({ text: 'Merged today', time: '11:05' })
  })

  it('the space and the lane filter each keep only their cards, and the counts follow', async () => {
    const all = (await round()).board
    const counts = (b: { columns: Column[] }) => b.columns.map((c) => c.count)
    expect(counts(all)).toEqual([3, 1, 2, 2, 2, 1, 2])
    const fediverse = (await round({ space: 'fediverse', lane: 'all' })).board
    expect(counts(fediverse)).toEqual([1, 0, 1, 0, 0, 0, 1])
    expect(
      fediverse.columns.flatMap((c: Column) => c.cards).every((c: Card) => c.space === 'fediverse')
    ).toBe(true)
    expect(
      fediverse.filters.spaces
        .filter((f: { pressed: boolean }) => f.pressed)
        .map((f: { key: string }) => f.key)
    ).toEqual(['fediverse'])
    const express = (await round({ space: 'all', lane: 'EXPRESS' })).board
    expect(express.columns.flatMap(ids)).toEqual(['micelio-engineering#809'])
    const normal = (await round({ space: 'all', lane: 'NORMAL' })).board
    expect(
      normal.columns.flatMap((c: Column) => c.cards).every((c: Card) => c.lane === 'NORMAL')
    ).toBe(true)
    expect(counts(normal)).toEqual([0, 1, 1, 0, 0, 0, 1])
    // A space and a lane together keep what both keep.
    const both = (await round({ space: 'micelio-engineering', lane: 'NORMAL' })).board
    expect(counts(both)).toEqual([0, 1, 1, 0, 0, 0, 1])
    expect(both.columns.flatMap(ids)).toEqual([
      'micelio-engineering#803',
      'micelio-engineering#804',
      'micelio-engineering#810',
    ])
    // The filter buttons name each space with its merged pull requests, and every lane.
    expect(all.filters.spaces.map((f: { label: string }) => f.label)).toEqual([
      'ALL SPACES',
      'MICELIO-ENGINEERING · 2/12',
      'FEDIVERSE · 1/3',
    ])
    expect(all.filters.lanes.map((f: { label: string }) => f.label)).toEqual([
      'ALL LANES',
      'EXPRESS',
      'NORMAL',
      'FULL',
    ])
  })

  it("the factory's share is the Foundations issues over the issues of the release line", async () => {
    const { share, board } = await round()
    // The line of the space's milestone is `later`: Mod de Herdr (12) and carriles (10) are Foundations, over those and the catalogue (30) and the credits (8); the 0.8 milestone (100) is another line.
    expect(share).toEqual({ line: 'later', foundations: 22, total: 60, percent: 37 })
    expect(board.summary.find((s: { key: string }) => s.key === 'share')).toMatchObject({
      label: 'FACTORY SHARE',
      value: '37%',
    })
    // A milestone of no entry of the file gives no line, and no share.
    expect(
      factoryShare({
        fields: {},
        milestones: { 'a/b': [{ number: 1, title: 'x', open_issues: 1, closed_issues: 1 }] },
        spaces: [{ repo: 'a/b', milestone: 1 }],
      })
    ).toBeNull()
    // `frontByRepository` gives a repository its own front.
    expect(
      factoryShare({
        fields: {
          x: { releaseLine: '0.7', front: 'Plugin core', frontByRepository: { b: 'Foundations' } },
        },
        milestones: { 'a/b': [{ number: 1, title: 'x', open_issues: 1, closed_issues: 3 }] },
        spaces: [{ repo: 'a/b', milestone: 1 }],
      })
    ).toEqual({ line: '0.7', foundations: 4, total: 4, percent: 100 })
  })

  it('the summary names load, heavy, workers, queue, orphans and the share', async () => {
    const { board } = await round()
    expect(board.summary.map((s: { label: string; value: string }) => [s.label, s.value])).toEqual([
      ['LOAD', '0.7/32'],
      ['HEAVY', '2/3'],
      ['WORKERS', '4/6'],
      ['QUEUE', '0'],
      ['ORPHANS', '1'],
      ['FACTORY SHARE', '37%'],
    ])
  })

  it('columnOf sends a sent back gate to the worker and a lane without G3 and G4 to G5', () => {
    const comment = (id: number, at: string, body: string) => ({
      id,
      user: { login: 'm' },
      created_at: at,
      body,
    })
    const gates = (bodies: string[]) =>
      parseGates({
        comments: bodies.map((b, i) => comment(i + 1, `2026-11-24T1${i}:00:00Z`, b)),
        maintainer: 'm',
      })
    const one = '**Gate 1 (master): pass**\n\nlane: normal\n'
    expect(
      columnOf(
        gates([one, '**Gate 2, round 1** · pass', '**Gate 3, round 1 (reviewer-1)** · sent back'])
      )
    ).toBe('g2')
    expect(
      columnOf(
        gates([
          one,
          '**Gate 2, round 1** · pass',
          '**Gate 4, round 1 (verify-draft)** · 0 mismatches',
        ])
      )
    ).toBe('g3')
    expect(columnOf(gates(['**Gate 1 (master): not ready**\n\nlane: normal\n']))).toBe('ready')
    expect(columnOf(gates([]))).toBe('ready')
  })

  it('columnOf puts an issue whose gate 2 reopened after gates 3 and 4 passed in G3, and one whose gate 2 is red in G2', () => {
    const column = (...bodies: string[]) =>
      columnOf(
        parseGates({
          comments: bodies.map((body, i) => ({
            id: i + 1,
            user: { login: 'm' },
            created_at: `2026-11-24T1${i}:00:00Z`,
            body,
          })),
          maintainer: 'm',
        })
      )
    const passed = [
      '**Gate 1 (master): pass**\n\nlane: normal\n',
      '**Gate 2, round 1 (master)** · pass',
      '**Gate 3, round 1 (reviewer-1)** · 0 Blocking',
      '**Gate 4, round 1 (verifier-1)** · 0 mismatches',
    ]
    expect(column(...passed)).toBe('g5')
    expect(column(...passed, '**Gate 2, round 2 (master)** · pass')).toBe('g3')
    expect(column(...passed, '**Gate 2, round 2 (master)** · red: npm run check failed')).toBe('g2')
  })

  it('the read of GitHub keeps the comments of an issue closed today and of no other closed one', async () => {
    const { github } = await round()
    const read = (space: string) =>
      Object.keys(github.spaces[space]!.raw!.comments)
        .map(Number)
        .toSorted((x, y) => x - y)
    expect(read('micelio-engineering')).toContain(810)
    expect(read('micelio-engineering')).not.toContain(811)
    expect(read('fediverse')).toEqual([5, 6, 7])
  })
})

describe('the board of a space of two repositories', () => {
  it("the Board shows the cards of every pair of a space, an issue of another repository as owner/repo#N, and the share counts every pair's repository", async () => {
    const config = readConfig({
      checkout: ROOT.replace(/\/$/, ''),
      maintainer: 'ale9420',
      fixture: ['test/fixtures/herdr-mod/spaces', 'test/fixtures/herdr-mod'],
      spaces: [
        { name: 'fixture-space', repo: 'bogd3v/fixture', milestone: 1 },
        { name: 'fixture-space', repo: 'bogd3v/fixture-two', milestone: 3, tag: 'tw' },
      ],
    })
    const a = createAdapters({ exec: noExec, readTextFile, terminals: () => [], config })
    const now: number = await a.now()
    const state = buildState({ now, fetched: { agents: await a.readAgents() } })
    const reads: Record<string, unknown> = {}
    for (const space of config.spaces) reads[space.name] = await a.readGithub(space)
    const github = buildGithub({ now, spaces: config.spaces, reads })
    const milestones = await a.readMilestones(config.spaces)
    expect(Object.keys((milestones as { byRepo: object }).byRepo)).toEqual([
      'bogd3v/fixture',
      'bogd3v/fixture-two',
    ])
    const share = factoryShare({
      fields: ((await a.readProjectFields()) as unknown as { fields: never }).fields,
      milestones: (milestones as unknown as { byRepo: never }).byRepo,
      spaces: config.spaces,
    })
    // The catalogue's issues in both repositories (6 and 4) over those and the plugins' (10).
    expect(share).toEqual({ line: '0.9', foundations: 10, total: 20, percent: 50 })
    const board = buildBoard({ now, state, github, config, share })
    const cards = (board.columns as Column[]).flatMap((c) =>
      c.cards.map((card) => [c.key, card.id, card.agent])
    )
    expect(cards).toEqual([
      ['g2', 'bogd3v/fixture-two#5', 'worker-tw5'],
      // G5 is the oldest wait first: the two express issues waited since 13:00, #5 since 14:30.
      ['g5', '#6', 'master'],
      ['g5', 'bogd3v/fixture-two#6', 'master'],
      ['g5', '#5', 'master'],
    ])
    expect(board.filters.spaces.map((f: { label: string }) => f.label)).toEqual([
      'ALL SPACES',
      'FIXTURE-SPACE · 0/4',
    ])
  })
})
