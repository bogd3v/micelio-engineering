import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { readConfig } from '../herdr/mod/factory/adapters.js'
import { parseAgents } from '../herdr/mod/factory/lib/agents.js'
import { onPair, pairsOf } from '../herdr/mod/factory/lib/panel.js'
import { parseGates } from '../herdr/mod/factory/lib/gates.js'
import { buildIssues, dependsOn } from '../herdr/mod/factory/lib/issues.js'
import { parseMachine } from '../herdr/mod/factory/lib/machine.js'
import { parseSlots } from '../herdr/mod/factory/lib/slots.js'
import { buildState } from '../herdr/mod/factory/lib/state.js'

const FIXTURES = join(fileURLToPath(new URL('./', import.meta.url)), 'fixtures/herdr-mod')
const text = (name: string): string => readFileSync(join(FIXTURES, name), 'utf8')
const json = <T>(name: string): T => JSON.parse(text(name)) as T

interface Comment {
  id: number
  user: { login: string }
  created_at: string
  body: string
}
interface Terminal {
  address: string
  name: string | null
  parent: string | null
  status: string
  foreground: { argv: string[] }
  labels: Record<string, string>
}
interface AgentRow {
  address: string
  role: string | null
  status: string
  needsYou: boolean
  space: { id: string; name: string } | null
}

const MAINTAINER = 'ale9420'
const NOW = Date.parse('2026-11-24T16:00:00Z')

let counter = 0
/** A comment as REST returns it, posted `minute` minutes into the day by `login`. */
const comment = (body: string, minute: number, login = MAINTAINER): Comment => ({
  id: ++counter,
  user: { login },
  created_at: new Date(Date.parse('2026-11-24T10:00:00Z') + minute * 60_000).toISOString(),
  body,
})
const gates = (comments: Comment[], extra: { closed?: boolean; needsYou?: boolean } = {}) =>
  parseGates({ comments, maintainer: MAINTAINER, ...extra }) as {
    lane: string
    calibration: boolean
    marks: string[]
    track: string
    label: string
    round: number
    rounds: { gate: number; round: number | null; outcome: string; blocking: number | null }[]
  }

const GATE1 = (lane: string): string => `**Gate 1 (master): pass**\n\nlane: ${lane}\n`

describe('slots', () => {
  it('the recorded status gives 2 of 3 heavy slots, 4 of 6 leases, an empty queue and 1 orphan', () => {
    const slots = parseSlots(text('status.txt'))
    expect(slots.heavy.used).toBe(2)
    expect(slots.heavy.total).toBe(3)
    expect(slots.leases.used).toBe(4)
    expect(slots.leases.total).toBe(6)
    expect(slots.queue).toEqual([])
    expect(slots.orphans).toEqual([
      { pid: 1998180, cwd: '/srv/factory/tmp/orphan-job', command: 'sleep 602' },
    ])
    expect(slots.paused).toBe(false)
    expect(slots.heavy.slots.map((s: { agent: string }) => s.agent)).toEqual([
      'verifier-792',
      'worker-801',
    ])
    expect(slots.leases.leases.map((l: { agent: string }) => l.agent)).toEqual([
      'reviewer-792',
      'worker-788',
      'worker-792',
      'worker-801',
    ])
  })

  it('a paused status and the hold of the maintainer are read', () => {
    const slots = parseSlots(text('status-paused.txt'))
    expect(slots.paused).toBe(true)
    expect(slots.heavy.used).toBe(3)
    const held = slots.heavy.slots.filter((s: { held: boolean }) => s.held)
    expect(held).toHaveLength(1)
    expect(held[0]).toMatchObject({ slot: 3, agent: 'maintainer', command: 'hold', alive: true })
  })

  it('a queue line is read and a status of the script today has none', () => {
    const slots = parseSlots('queue\tm-792\tm-792\t-\t2026-11-24T10:00:00Z\tnpm run check\t-\n')
    expect(slots.queue).toEqual([
      { agent: 'm-792', since: Date.parse('2026-11-24T10:00:00Z'), command: 'npm run check' },
    ])
  })
})

describe('machine', () => {
  const hwmon = json<{ name: string; temp1_input: string | null }[]>('hwmon.json')
  const machine = (loadavg: string, cores: number) =>
    parseMachine({ loadavg, meminfo: text('meminfo'), hwmon, cores }) as {
      load1: number
      saturated: boolean
      memUsedKb: number
      tempC: number
    }

  it('the machine is saturated when the 1-minute load is above the core count', () => {
    expect(machine(text('loadavg'), 8).saturated).toBe(false)
    expect(machine('8.00 5.00 3.00 1/100 5\n', 8).saturated).toBe(false)
    expect(machine('8.01 5.00 3.00 1/100 5\n', 8).saturated).toBe(true)
    expect(machine('81.30 60.00 40.00 1/100 5\n', 32).saturated).toBe(true)
  })

  it('reads the load, the memory in use and the CPU sensor by its name', () => {
    const read = machine(text('loadavg'), 8)
    expect(read.load1).toBe(0.7)
    expect(read.memUsedKb).toBe(16264964 - 6074644)
    expect(read.tempC).toBe(35.25)
  })
})

describe('gates', () => {
  it("a Gate 3 comment with 1 Blocking makes G3 red in round 1, and the next round's 0 Blocking makes it passed", () => {
    const base = [
      comment(GATE1('normal'), 0),
      comment('**Gate 2, round 1 (master)** · pass', 10),
      comment('**Gate 3, round 1 (reviewer-792)** · 1 Blocking, 0 Important', 20),
    ]
    const red = gates(base)
    expect(red.marks[2]).toBe('red')
    expect(red.track).toBe('ppxttt')
    expect(red.label).toBe('G3·r1 RED')
    const round2 = gates([
      ...base,
      comment('**Gate 2, round 2 (master)** · pass', 30),
      comment('**Gate 3, round 2 (reviewer-792-r2)** · 0 Blocking, 0 Important', 40),
    ])
    expect(round2.marks[2]).toBe('passed')
    expect(round2.rounds.filter((r) => r.gate === 3).map((r) => [r.round, r.outcome])).toEqual([
      [1, 'red'],
      [2, 'passed'],
    ])
    expect(round2.round).toBe(2)
  })

  it('a gate the lane omits is omitted, never not reached', () => {
    const express = gates([
      comment(GATE1('express'), 0),
      comment('**Gate 2, round 1 (master)** · pass', 10),
    ])
    expect(express.lane).toBe('express')
    expect(express.marks.slice(2, 4)).toEqual(['omitted', 'omitted'])
    expect(express.track).toBe('ppssnt')
    // Right after Gate 1, G3 and G4 are already omitted, not "not reached".
    expect(gates([comment(GATE1('express'), 0)]).track).toBe('prsstt')
    const normal = gates([comment(GATE1('normal'), 0)])
    expect(normal.marks).not.toContain('omitted')
    // A calibration run keeps its lane and runs every gate.
    const calibration = gates([comment(GATE1('express (calibration: full)'), 0)])
    expect(calibration.lane).toBe('express')
    expect(calibration.calibration).toBe(true)
    expect(calibration.marks).not.toContain('omitted')
  })

  it('the lane on the first line of Gate 1 wins over a lane line in a fenced block', () => {
    const body =
      '**Gate 1 (master)** · pass · lane: express\n\n`lint-lane`:\n\n```text\nlane: normal\n- `docs/factory.md` is normative\n```\n'
    const read = gates([comment(body, 0)])
    expect(read.lane).toBe('express')
    expect(read.marks.slice(2, 4)).toEqual(['omitted', 'omitted'])
    expect(
      gates([comment('**Gate 1 (master)** · pass · lane: express (calibration: full)', 0)])
    ).toMatchObject({
      lane: 'express',
      calibration: true,
    })
  })

  it("a comment from a login other than the maintainer's changes nothing", () => {
    const own = [
      comment(GATE1('normal'), 0),
      comment('**Gate 2, round 1 (master)** · pass', 10),
      comment('**Gate 3, round 1 (reviewer-792)** · 0 Blocking, 0 Important', 20),
    ]
    const before = gates(own)
    const noise = [
      comment('**Gate 3, round 2 (reviewer-792-r2)** · 3 Blocking, 1 Important', 30, 'someone'),
      comment('lane: express', 31, 'someone'),
      comment('**Gate 1 (master): pass**\n\nlane: express\n', 32, 'bot-1'),
    ]
    expect(gates([...own, ...noise])).toEqual(before)
  })

  it('reads the lane of a recorded issue of each lane', () => {
    const lane = (n: number, closed: boolean) =>
      gates(json<Comment[]>(`comments-${n}.json`), { closed })
    expect(lane(317, true).lane).toBe('express')
    expect(lane(297, true).lane).toBe('normal')
    expect(lane(370, true).lane).toBe('full')
    expect(lane(317, true).track).toBe('ppsspp')
    expect(
      lane(297, false)
        .rounds.filter((r) => r.gate === 3)
        .map((r) => r.round)
    ).toEqual([1, 2])
    expect(lane(297, false).track).toBe('pppppr')
  })

  it('a gate with no comment is not reached and a blocked agent turns the running gate into needs you', () => {
    expect(gates([]).track).toBe('tttttt')
    const comments = [comment(GATE1('normal'), 0)]
    expect(gates(comments).track).toBe('prtttt')
    expect(gates(comments, { needsYou: true }).track).toBe('pntttt')
    expect(gates(comments, { needsYou: true }).label).toBe('G2')
  })

  it('G3 and G4 run together after G2 passes, and G5 needs the maintainer after G4', () => {
    const upToG2 = [comment(GATE1('full'), 0), comment('**Gate 2, round 1 (master)** · pass', 10)]
    const running = gates(upToG2)
    expect(running.track).toBe('pprrtt')
    expect(running.label).toBe('G3-4·r1')
    const done = gates([
      ...upToG2,
      comment('**Gate 3, round 1 (reviewer-1)** · 0 Blocking, 0 Important', 20),
      comment('**Gate 4, round 1 (verifier-1)** · 0 mismatches', 30),
    ])
    expect(done.track).toBe('ppppnt')
    expect(
      gates([...upToG2, comment('**Gate 4, round 1 (verifier-1)** · 2 mismatches', 30)]).marks[3]
    ).toBe('red')
  })
})

describe('issues', () => {
  const issue = (number: number, body: string | null, state = 'open') => ({
    number,
    title: `issue ${number}`,
    state,
    body,
    created_at: '2026-11-24T09:00:00Z',
  })

  it('gives each issue a row with the age of its wait and what blocks a blocked one', () => {
    const rows = buildIssues({
      issues: [
        issue(792, null),
        issue(
          788,
          '## Depends on\n\n- #792 (the model)\n- #100 (closed, not listed)\n\n## Delivery\n'
        ),
        issue(100, null, 'closed'),
        { ...issue(5, null), pull_request: {} },
      ],
      comments: {
        792: [comment(GATE1('normal'), 0), comment('**Gate 2, round 1 (master)** · pass', 10)],
      },
      maintainer: MAINTAINER,
      now: Date.parse('2026-11-24T10:40:00Z'),
    }) as {
      number: number
      track: string
      lane: string
      waitMs: number | null
      blocked: boolean
      blockedBy: number[]
      label: string
    }[]
    expect(rows.map((r) => r.number)).toEqual([100, 788, 792])
    const blocked = rows.find((r) => r.number === 788)
    expect(blocked).toMatchObject({
      blocked: true,
      blockedBy: [792],
      label: 'BLOCKED',
      track: 'tttttt',
    })
    const running = rows.find((r) => r.number === 792)
    expect(running).toMatchObject({ lane: 'normal', track: 'pprrtt' })
    expect(running?.waitMs).toBe(30 * 60_000)
    expect(blocked?.waitMs).toBe(100 * 60_000)
    expect(rows.find((r) => r.number === 100)?.waitMs).toBeNull()
  })

  it('reads the issues a body depends on', () => {
    expect(dependsOn('x\n\n## Depends on\n\n- #296 (a)\n- bogd3v/other#4\n- #300\n')).toEqual([
      296, 300,
    ])
    expect(dependsOn('no section')).toEqual([])
    expect(dependsOn(null)).toEqual([])
  })
})

describe('agents', () => {
  const terminals = json<Terminal[]>('terminals.json')
  const agents = (rows: Terminal[]) => parseAgents(rows) as AgentRow[]
  const named = (
    address: string,
    name: string | null,
    parent: string | null = 't2p'
  ): Terminal => ({
    address,
    name,
    parent,
    status: 'working',
    foreground: { argv: ['claude'] },
    labels: {},
  })

  it('worker-792, reviewer-792-r2, verifier-792 and scribe have their roles, and build-792 has none', () => {
    const rows = agents([
      ...terminals,
      named('t60', 'reviewer-792-r2'),
      named('t61', 'verifier-792'),
      named('t62', 'scribe'),
      named('t63', 'reviewer-792'),
      named('t64', 'verifier-792-r3'),
    ])
    const role = (address: string): string | null | undefined =>
      rows.find((a) => a.address === address)?.role
    expect(role('t4k')).toBe('worker')
    expect(role('t60')).toBe('reviewer')
    expect(role('t61')).toBe('verifier')
    expect(role('t62')).toBe('scribe')
    expect(role('t63')).toBe('reviewer')
    expect(role('t64')).toBe('verifier')
    expect(role('t54')).toBeNull()
    expect(rows.find((a) => a.address === 't4k')).toMatchObject({ issue: 792 })
  })

  it('a terminal with no name and --agent master in foreground.argv is the master, and a sub-agent of a worker takes the space of the master', () => {
    const rows = agents(terminals)
    const master = rows.find((a) => a.address === 't2p')
    expect(master).toMatchObject({
      role: 'master',
      name: null,
      space: { id: 'sp-micelio-engineering', name: 'micelio-engineering' },
    })
    const sub = rows.find((a) => a.address === 't54')
    expect(sub?.space).toEqual(master?.space)
    expect(rows.find((a) => a.address === 't4k')?.space).toEqual(master?.space)
    const planner = agents([
      { ...named('t70', null, null), foreground: { argv: ['claude', '--agent', 'planner'] } },
      { ...named('t71', null, null), foreground: { argv: ['claude', '--agent', 'other'] } },
      { ...named('t72', null, null), foreground: { argv: ['claude'] } },
    ])
    expect(planner.map((a) => a.role)).toEqual(['planner', null, null])
  })

  it('a terminal whose status is blocked needs the maintainer', () => {
    const rows = agents(terminals)
    expect(rows.filter((a) => a.needsYou).map((a) => a.address)).toEqual(['t54'])
    expect(rows.find((a) => a.address === 't54')?.status).toBe('blocked')
    expect(rows.find((a) => a.address === 't4k')?.status).toBe('working')
    expect(rows.find((a) => a.address === 't4m')?.status).toBe('idle')
  })

  it('carries no context size and no model', () => {
    for (const agent of agents(terminals)) {
      expect(Object.keys(agent).toSorted()).toEqual(
        ['address', 'issue', 'name', 'needsYou', 'role', 'space', 'status', 'tag'].toSorted()
      )
    }
  })
})

describe('the spaces of the layout', () => {
  interface Pair {
    repo: string
    milestone: number
    epic: number | null
    tag: string
  }
  interface Space {
    name: string
    repo: string
    milestone: number
    epic: number | null
    pairs: Pair[]
  }
  const spacesOf = (spaces: unknown[]) => (readConfig({ spaces }) as { spaces: Space[] }).spaces

  it('readConfig makes the entries that share a name one space, its pairs in the order of the file', () => {
    const spaces = spacesOf([
      { name: 'micelio', repo: 'bogd3v/micelio', milestone: 18, epic: 872 },
      { name: 'micelio-engineering', repo: 'bogd3v/micelio-engineering', milestone: 12 },
      { name: 'micelio', repo: 'bogd3v/micelio-cms', milestone: 12, tag: 'c' },
      { name: 'micelio', repo: 'bogd3v/micelio-plugin-core', milestone: 8, tag: 'pc' },
      { name: 'micelio', repo: 'bogd3v/micelio', milestone: 15, epic: 900 },
    ])
    expect(spaces.map((s) => s.name)).toEqual(['micelio', 'micelio-engineering'])
    const micelio = spaces[0] as Space
    // The first entry's repository is the space's; a second milestone of it needs no tag.
    expect(micelio).toMatchObject({ repo: 'bogd3v/micelio', milestone: 18, epic: 872 })
    expect(micelio.pairs).toEqual([
      { repo: 'bogd3v/micelio', milestone: 18, epic: 872, tag: '' },
      { repo: 'bogd3v/micelio-cms', milestone: 12, epic: null, tag: 'c' },
      { repo: 'bogd3v/micelio-plugin-core', milestone: 8, epic: null, tag: 'pc' },
      { repo: 'bogd3v/micelio', milestone: 15, epic: 900, tag: '' },
    ])
    expect(pairsOf(micelio)).toBe(micelio.pairs)
  })

  it("a layout of one entry per space reads as one pair per space, with the entry's repo, milestone and epic", () => {
    const spaces = spacesOf([
      { name: 'micelio-engineering', repo: 'bogd3v/micelio-engineering', milestone: 12, epic: 790 },
      { name: 'fediverse', repo: 'bogd3v/fediverse', milestone: 3, epic: null },
    ])
    expect(spaces).toEqual([
      {
        name: 'micelio-engineering',
        repo: 'bogd3v/micelio-engineering',
        milestone: 12,
        epic: 790,
        pairs: [{ repo: 'bogd3v/micelio-engineering', milestone: 12, epic: 790, tag: '' }],
      },
      {
        name: 'fediverse',
        repo: 'bogd3v/fediverse',
        milestone: 3,
        epic: null,
        pairs: [{ repo: 'bogd3v/fediverse', milestone: 3, epic: null, tag: '' }],
      },
    ])
    // A config made by hand, with no pairs, is its one pair.
    expect(pairsOf({ name: 'x', repo: 'a/b', milestone: 2, epic: 9 })).toEqual([
      { repo: 'a/b', milestone: 2, epic: 9, tag: '' },
    ])
  })

  it('an entry in another repository of a space with no tag, or with a tag the space already has, is left out', () => {
    const [space] = spacesOf([
      { name: 'micelio', repo: 'bogd3v/micelio', milestone: 18 },
      { name: 'micelio', repo: 'bogd3v/micelio-cms', milestone: 12 },
      { name: 'micelio', repo: 'bogd3v/micelio-plugin-core', milestone: 8, tag: 'pc' },
      { name: 'micelio', repo: 'bogd3v/micelio-cms', milestone: 12, tag: 'pc' },
      { name: 'micelio', repo: 'bogd3v/micelio-cms', milestone: 12, tag: 'CMS' },
      { name: 'micelio', repo: 'bogd3v/micelio-cms', milestone: 12, tag: 'abcd' },
      { name: 'micelio', repo: 'bogd3v/micelio-cms', milestone: 12, tag: '' },
    ])
    expect(space?.pairs.map((p) => `${p.repo}:${p.tag}`)).toEqual([
      'bogd3v/micelio:',
      'bogd3v/micelio-plugin-core:pc',
    ])
  })

  it("worker-tw5, reviewer-tw5-r2 and verifier-tw5 are on issue 5 of the pair tagged tw, and worker-5 on issue 5 of the space's repository", () => {
    const [space] = spacesOf([
      { name: 'fixture-space', repo: 'bogd3v/fixture', milestone: 1 },
      { name: 'fixture-space', repo: 'bogd3v/fixture-two', milestone: 3, tag: 'tw' },
    ])
    const [own, two] = space?.pairs ?? []
    const row = (address: string, name: string): Terminal => ({
      address,
      name,
      parent: null,
      status: 'working',
      foreground: { argv: ['claude'] },
      labels: {},
    })
    const agents = parseAgents([
      row('a', 'worker-tw5'),
      row('b', 'reviewer-tw5-r2'),
      row('c', 'verifier-tw5'),
      row('d', 'worker-5'),
      row('e', 'worker-pc267'),
    ]) as (AgentRow & { issue: number | null; tag: string })[]
    expect(agents.map((a) => [a.role, a.issue, a.tag])).toEqual([
      ['worker', 5, 'tw'],
      ['reviewer', 5, 'tw'],
      ['verifier', 5, 'tw'],
      ['worker', 5, ''],
      ['worker', 267, 'pc'],
    ])
    expect(agents.filter((a) => onPair(a, two!)).map((a) => a.address)).toEqual(['a', 'b', 'c'])
    expect(agents.filter((a) => onPair(a, own!)).map((a) => a.address)).toEqual(['d'])
  })
})

describe('state', () => {
  const read = (at: string) => ({
    slots: { at, text: text('status.txt') },
    machine: {
      at,
      loadavg: text('loadavg'),
      meminfo: text('meminfo'),
      hwmon: json<{ name: string; temp1_input: string | null }[]>('hwmon.json'),
      cores: 8,
    },
    agents: { at, terminals: json<Terminal[]>('terminals.json') },
    issues: {
      at,
      issues: [{ number: 297, title: 'x', state: 'closed', body: null, created_at: at }],
      comments: { 297: json<Comment[]>('comments-297.json') },
      maintainer: MAINTAINER,
    },
  })
  const sources = (state: unknown) =>
    (
      state as {
        sources: Record<
          string,
          {
            value: unknown
            at: string | null
            ageMs: number | null
            stale: boolean
            error: string | null
          }
        >
      }
    ).sources

  it('a source that fails keeps its last value and is stale, with its age', () => {
    const first = buildState({
      now: Date.parse('2026-11-24T15:55:00Z'),
      fetched: read('2026-11-24T15:55:00Z'),
    })
    expect(first.stale).toBe(false)
    expect(sources(first)['issues']).toMatchObject({ stale: false, ageMs: 0 })
    const second = buildState({
      now: Date.parse('2026-11-24T15:58:00Z'),
      previous: first,
      fetched: {
        issues: { error: 'gh: network error' },
        slots: { at: '2026-11-24T15:58:00Z', text: '' },
      },
    })
    expect(second.stale).toBe(true)
    expect(sources(second)['issues']).toMatchObject({
      stale: true,
      ageMs: 3 * 60_000,
      error: 'gh: network error',
      at: '2026-11-24T15:55:00Z',
    })
    expect(sources(second)['issues']?.value).toEqual(sources(first)['issues']?.value)
    expect(sources(second)['issues']?.value).not.toBeNull()
    // The sources that read well are live, and the one left out keeps its value, not stale.
    expect(sources(second)['slots']).toMatchObject({ stale: false, ageMs: 0 })
    expect(sources(second)['machine']).toMatchObject({ stale: false, ageMs: 3 * 60_000 })
    // It is fresh again when the next read works.
    const third = buildState({ now: NOW, previous: second, fetched: read('2026-11-24T16:00:00Z') })
    expect(third.stale).toBe(false)
  })

  it('a source that has never read keeps no value and is stale with no age', () => {
    const state = buildState({ now: NOW, fetched: { agents: { error: 'no terminals' } } })
    expect(sources(state)['agents']).toMatchObject({
      value: null,
      at: null,
      ageMs: null,
      stale: true,
    })
  })

  it('does not read the clock: the same arguments give the same state', () => {
    const args = { now: NOW, fetched: read('2026-11-24T15:59:30Z') }
    expect(buildState(args)).toEqual(buildState(args))
    expect(sources(buildState(args))['slots']?.ageMs).toBe(30_000)
  })

  it('a blocked agent of an issue turns the running gate of that issue into needs you', () => {
    const at = '2026-11-24T15:59:00Z'
    const comments = [comment(GATE1('normal'), 0)]
    const state = buildState({
      now: NOW,
      fetched: {
        agents: {
          at,
          terminals: [
            {
              ...json<Terminal[]>('terminals.json')[1],
              name: 'worker-792',
              status: 'blocked',
            },
          ],
        },
        issues: {
          at,
          issues: [{ number: 792, title: 'x', state: 'open', body: null, created_at: at }],
          comments: { 792: comments },
          maintainer: MAINTAINER,
        },
      },
    })
    expect((sources(state)['issues']?.value as { track: string }[])[0]?.track).toBe('pntttt')
  })
})
