import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  buildNeeds,
  cardMessages,
  createOutbox,
  notificationFor,
  parseDecision,
  answerLine,
  signOffMessage,
  LOCKED_NOTE,
  NO_WORKTREE_NOTE,
} from '../herdr/mod/factory/lib/needs.js'
import { buildGithub } from '../herdr/mod/factory/lib/panel.js'
import { buildPanel } from '../herdr/mod/factory/lib/panel.js'
import { createAdapters, readConfig } from '../herdr/mod/factory/adapters.js'
import { buildState } from '../herdr/mod/factory/lib/state.js'
import { parseAgents } from '../herdr/mod/factory/lib/agents.js'
import { timeLine } from '../herdr/mod/factory/lib/time.js'

const NOW = Date.parse('2026-11-24T16:00:00Z')
const MIN = 60_000
const ME = 'ale9420'
const iso = (minutesAgo: number) => new Date(NOW - minutesAgo * MIN).toISOString()

interface Comment {
  user: { login: string }
  body: string
  created_at: string
  id: number
}
let ids = 0
const say = (body: string, minutesAgo: number): Comment => ({
  user: { login: ME },
  body,
  created_at: iso(minutesAgo),
  id: (ids += 1),
})
/** The comments of an issue that waits at G5. */
const atG5 = (lane: string, minutesAgo: number, why = ''): Comment[] => [
  say(`**Gate 1 (master): pass**\n\nlane: ${lane}\n${why}`, minutesAgo + 60),
  say('**Gate 2, round 1 (worker-1)** · draft ok', minutesAgo + 40),
  ...(lane === 'express'
    ? []
    : [
        say('**Gate 3, round 1 (reviewer-1)** · 0 Blocking, 2 Important', minutesAgo + 10),
        say('**Gate 4, round 1 (verifier-1)** · 0 mismatches: 7 of 7 commands match', minutesAgo),
      ]),
]

interface Issue {
  number: number
  title: string
  comments: Comment[]
  body?: string
}
/** The panel's `github` for one space `micelio` with these open issues. */
function github(issues: Issue[], space = 'micelio') {
  return buildGithub({
    now: NOW,
    spaces: [{ name: space, repo: 'bogd3v/micelio-engineering', milestone: 1 }],
    reads: {
      [space]: {
        at: new Date(NOW).toISOString(),
        issues: issues.map((i) => ({
          number: i.number,
          title: i.title,
          state: 'open',
          body: i.body ?? null,
          created_at: iso(1000),
        })),
        comments: Object.fromEntries(issues.map((i) => [i.number, i.comments])),
        maintainer: ME,
      },
    },
  })
}
const agentsOf = (blocked = false) =>
  parseAgents([
    {
      address: 'tfix-master',
      name: null,
      parent: null,
      status: blocked ? 'blocked' : 'idle',
      foreground: { argv: ['claude', '--agent', 'master'] },
      labels: { 'herdr.space': 'sp1', where: 'micelio / 1' },
    },
  ])
const config = { spaces: [{ name: 'micelio', repo: 'bogd3v/micelio-engineering', milestone: 1 }] }

const build = (issues: Issue[], extra: Record<string, unknown> = {}) =>
  buildNeeds({
    now: NOW,
    config,
    github: github(issues),
    agents: agentsOf(),
    ...extra,
  })

describe('Needs you', () => {
  it('a stale agents source dims the cards that come from the agents, with one note', () => {
    const issues = [
      { number: 389, title: 'cms', comments: atG5('full', 12) },
      {
        number: 792,
        title: 'tab order',
        comments: [
          say('**Gate 2, round 1 (worker-792)** · draft ok', 70),
          say('**Decision needed** · #792\nWhich?\n- A: one\n- B: two', 8),
        ],
      },
    ]
    const note = 'as of 15:57 UTC · not live'
    const live = build(issues, {})
    expect(live.note).toBeNull()
    expect(live.cards.some((c: { dim?: boolean }) => c.dim === true)).toBe(false)
    const stale = build(issues, { agentsNote: note })
    expect(stale.note).toBe(note)
    expect(
      stale.cards.map((c: { kind: string; dim?: boolean }) => [c.kind, c.dim ?? false])
    ).toEqual([
      ['signoff', false],
      ['decision', true],
    ])
    // With no card from the agents there is nothing to dim, and no note.
    expect(build(issues.slice(0, 1), { agentsNote: note }).note).toBeNull()
  })

  it('the cards are ordered oldest first, each with its age', () => {
    const needs = build(
      [
        { number: 389, title: 'cms', comments: atG5('full', 12) },
        { number: 451, title: 'readme', comments: atG5('normal', 30) },
        {
          number: 792,
          title: 'tab order',
          comments: [
            say('**Gate 2, round 1 (worker-792)** · draft ok', 70),
            say('**Decision needed** · #792\nWhich?\n- A: one\n- B: two', 8),
          ],
        },
      ],
      {}
    )
    const blocked = buildNeeds({
      now: NOW,
      config,
      github: github([{ number: 389, title: 'cms', comments: atG5('full', 12) }]),
      agents: agentsOf(true),
      blockedSince: { tfixmaster: 0, 'tfix-master': NOW - 23 * MIN },
    })
    expect(needs.cards.map((c: { key: string }) => c.key)).toEqual([
      'signoff:micelio#451',
      'signoff:micelio#389',
      'decision:micelio#792',
    ])
    expect(needs.cards.map((c: { age: number }) => c.age / MIN)).toEqual([30, 12, 8])
    expect(blocked.cards.map((c: { key: string }) => c.key)).toEqual([
      'master:tfix-master',
      'signoff:micelio#389',
    ])
    expect(blocked.cards[0]!.age / MIN).toBe(23)
  })

  it('a red gate 2 after gates 3 and 4 passed makes no sign-off card', () => {
    const kinds = (comments: Comment[]) =>
      build([{ number: 389, title: 'cms', comments }]).cards.map((c: { kind: string }) => c.kind)
    const passed = atG5('full', 30)
    expect(kinds(passed)).toEqual(['signoff'])
    expect(
      kinds([...passed, say('**Gate 2, round 2 (master)** · red: npm run check failed', 5)])
    ).toEqual([])
  })

  it('the sign-off is locked until the diff of that issue was opened', () => {
    const issues = [{ number: 389, title: 'cms', comments: atG5('full', 12) }]
    const locked = build(issues).cards[0]!
    expect(locked.locked).toBe(true)
    expect(locked.form).toBeNull()
    expect(cardMessages(locked)).toEqual([])
    // A diff opened for another issue unlocks nothing.
    const other = build(issues, { diffs: { 451: NOW - 5 * MIN } }).cards[0]
    expect(cardMessages(other)).toEqual([])
    const open = build(issues, { diffs: { 389: NOW - 5 * MIN } }).cards[0]!
    expect(open.locked).toBe(false)
    expect(cardMessages(open)).toEqual([
      { target: 'tfix-master', text: 'approved, sign off #389\ntime: 5m diff' },
    ])
  })

  it('a sign-off whose issue names its worktree under ## Progress has that worktree, so Open diff is enabled', () => {
    const body = '## Why\n\nx\n\n## Progress\n\nWorktree `/w/wt-389`, branch `fix/factory-389`.\n'
    const card = build([{ number: 389, title: 'cms', comments: atG5('full', 12), body }]).cards[0]!
    expect(card.worktree).toBe('/w/wt-389')
    expect(card.lockedNote).toBe(LOCKED_NOTE)
    const same = build([
      {
        number: 389,
        title: 'cms',
        comments: atG5('full', 12),
        body: body.replace('## P', '### P'),
      },
    ]).cards[0]!
    expect(same.worktree).toBe('/w/wt-389')
    expect(same.lockedNote).toBe(LOCKED_NOTE)
  })

  it('a sign-off whose Progress names no worktree has a null worktree and the note NO_WORKTREE_NOTE instead of LOCKED_NOTE', () => {
    expect(NO_WORKTREE_NOTE).toBe("Open diff needs the worktree in the issue's Progress.")
    for (const body of [undefined, '## Progress\n\nNot started.\n']) {
      const card = build([
        {
          number: 389,
          title: 'cms',
          comments: atG5('full', 12),
          ...(body === undefined ? {} : { body }),
        },
      ]).cards[0]!
      expect(card.worktree).toBeNull()
      expect(card.lockedNote).toBe(NO_WORKTREE_NOTE)
    }
  })

  it('the items of an express card carry the worktree of a ## Progress section', () => {
    const body = '## Progress\n\nWorktree `/w/wt-901`.\n'
    const needs = build([
      { number: 901, title: 'docs', comments: atG5('express', 5), body },
      { number: 902, title: 'more docs', comments: atG5('express', 7) },
    ])
    const batch = needs.cards.find((c: { kind: string }) => c.kind === 'batch')
    const of = (n: number) =>
      batch!.items!.find((i: { number: number }) => i.number === n)!.worktree
    expect(of(901)).toBe('/w/wt-901')
    expect(of(902)).toBeNull()
  })

  it('an undo within 10 s sends nothing, and after 10 s exactly one message is sent', () => {
    const sent: [string, string][] = []
    const outbox = createOutbox({
      send: (target: string, text: string) => sent.push([target, text]),
    })
    const message = [{ target: 'tfix-master', text: 'approved, sign off #389' }]
    expect(outbox.start(0, 'sign off #389', message)).toBe(true)
    expect(outbox.start(1000, 'sign off #389', message)).toBe(false)
    expect(outbox.state(4000)?.secondsLeft).toBe(6)
    outbox.undo()
    expect(outbox.tick(11_000)).toBeNull()
    expect(sent).toEqual([])
    outbox.start(20_000, 'sign off #389', message)
    expect(outbox.tick(29_999)).toBeNull()
    expect(sent).toEqual([])
    outbox.tick(30_000)
    outbox.tick(40_000)
    expect(sent).toEqual([['tfix-master', 'approved, sign off #389']])
  })

  it('the message for #389 after 11 minutes on the diff is approved, sign off #389 and time: 11m diff', () => {
    const card = build([{ number: 389, title: 'cms', comments: atG5('full', 12) }], {
      diffs: { 389: NOW - 11 * MIN },
    }).cards[0]!
    expect(card.lines).toBe('approved, sign off #389\ntime: 11m diff')
    expect(card.form!.tracked).toBe(11)
    // The minutes are editable, and a remark loses its parentheses.
    const edited = build([{ number: 389, title: 'cms', comments: atG5('full', 12) }], {
      diffs: { 389: NOW - 11 * MIN },
      forms: { 389: { readMin: '14', remark: 'the (admin) page' } },
    }).cards[0]!
    expect(edited.lines).toBe('approved, sign off #389\ntime: 14m diff (the admin page)')
    // An invalid form sends nothing.
    const bad = build([{ number: 389, title: 'cms', comments: atG5('full', 12) }], {
      diffs: { 389: NOW - 11 * MIN },
      forms: { 389: { readMin: 'x' } },
    }).cards[0]!
    expect(cardMessages(bad)).toEqual([])
    expect(bad.form!.error).toBe('Reading minutes: a whole number.')
  })

  it('a shared sign-off names only the express issues whose diff was read', () => {
    const issues = [
      { number: 901, title: 'docs', comments: atG5('express', 5) },
      { number: 451, title: 'readme', comments: atG5('express', 9) },
      { number: 902, title: 'express, not read', comments: atG5('express', 7) },
      { number: 389, title: 'cms', comments: atG5('full', 12) },
    ]
    const needs = build(issues, { diffs: { 901: NOW - MIN, 451: NOW - MIN, 389: NOW - MIN } })
    const batch = needs.cards.find((c: { kind: string }) => c.kind === 'batch')
    expect(batch!.items!.map((i: { number: number }) => i.number)).toEqual([451, 902, 901])
    expect(batch!.unread).toBe(1)
    expect(cardMessages(batch)).toEqual([
      { target: 'tfix-master', text: 'approved, sign off #451 #901' },
    ])
    // Nothing read, nothing sent.
    const none = build(issues).cards.find((c: { kind: string }) => c.kind === 'batch')
    expect(cardMessages(none)).toEqual([])
  })

  it("there is one express card for each space, and a click sends one message to that space's master", () => {
    const two = buildGithub({
      now: NOW,
      spaces: [
        { name: 'micelio', repo: 'a/a', milestone: 1 },
        { name: 'other', repo: 'b/b', milestone: 1 },
      ],
      reads: {
        micelio: {
          at: iso(0),
          issues: [{ number: 901, title: 'docs', state: 'open', body: null, created_at: iso(900) }],
          comments: { 901: atG5('express', 5) },
          maintainer: ME,
        },
        other: {
          at: iso(0),
          issues: [{ number: 51, title: 'docs', state: 'open', body: null, created_at: iso(900) }],
          comments: { 51: atG5('express', 9) },
          maintainer: ME,
        },
      },
    })
    const master = (address: string, name: string) => ({
      address,
      name: null,
      parent: null,
      status: 'idle',
      foreground: { argv: ['claude', '--agent', 'master'] },
      labels: { 'herdr.space': `sp-${name}`, where: `${name} / 1` },
    })
    const needs = buildNeeds({
      now: NOW,
      config: {
        spaces: [
          { name: 'micelio', repo: 'a/a', milestone: 1 },
          { name: 'other', repo: 'b/b', milestone: 1 },
        ],
      },
      github: two,
      agents: parseAgents([master('tfix-master', 'micelio'), master('tfix-master2', 'other')]),
      diffs: { 901: NOW - MIN, 51: NOW - MIN },
    })
    expect(needs.cards.map((c: { key: string }) => c.key)).toEqual([
      'express:other',
      'express:micelio',
    ])
    expect(needs.cards.map((c: { messages?: unknown[] }) => c.messages!.length)).toEqual([1, 1])
    expect(needs.cards.flatMap((c: unknown) => cardMessages(c))).toEqual([
      { target: 'tfix-master2', text: 'approved, sign off #51' },
      { target: 'tfix-master', text: 'approved, sign off #901' },
    ])
  })

  it("a notification's action scrolls the docked panel to Needs you, and does not open a new copy of the mod", () => {
    const [card] = build([{ number: 389, title: 'cms', comments: atG5('full', 12) }]).cards
    const note = notificationFor(card!)
    expect(note.action).toEqual({ name: 'factory.reveal:needs' })
    expect(note.title).toBe('Needs you')
    expect(note.body).toBe('micelio#389 · G5 · Ready for your sign-off. cms')
  })

  it('the countdown belongs to the card whose click started it', () => {
    const outbox = createOutbox({ send: () => undefined })
    outbox.start(0, 'sign-off #389', [{ target: 't', text: 'x' }], 'signoff:micelio#389')
    expect(outbox.state(1000)?.key).toBe('signoff:micelio#389')
    expect(
      outbox.start(1000, 'sign-off #451', [{ target: 't', text: 'y' }], 'signoff:micelio#451')
    ).toBe(false)
  })

  it('the hands-on check is offered only in full', () => {
    const lanes = ['full', 'normal'].map(
      (lane) =>
        build([{ number: 389, title: 'cms', comments: atG5(lane, 12) }], {
          diffs: { 389: NOW - 11 * MIN },
          forms: { 389: { hand: 'stack', handMin: '4' } },
        }).cards[0]!
    )
    expect(lanes.map((c: { form?: { showHands: boolean } | null }) => c.form!.showHands)).toEqual([
      true,
      false,
    ])
    expect(lanes[0]!.lines).toBe('approved, sign off #389\ntime: 11m diff, 4m stack')
    expect(lanes[1]!.lines).toBe('approved, sign off #389\ntime: 11m diff')
    expect(
      timeLine({ read: 'diff', readMin: 3, hand: 'test', handMin: 2, lane: 'express' }).line
    ).toBe('time: 3m diff')
  })

  it("an answer is answer #792: A — the note, sent to the master of the issue's space", () => {
    const comments = [
      say('**Gate 2, round 1 (worker-792)** · draft ok', 70),
      say(
        '**Decision needed** · #792\nThe strict check wants one order.\n- A: Oracle accepts it\n- B: Reorder',
        8
      ),
    ]
    const decision = parseDecision(comments, ME)
    expect(decision?.question).toBe('The strict check wants one order.')
    expect(decision?.options).toEqual([
      { letter: 'A', text: 'Oracle accepts it' },
      { letter: 'B', text: 'Reorder' },
    ])
    const card = build([{ number: 792, title: 'tab order', comments }]).cards[0]!
    expect(card.kind).toBe('decision')
    expect(card.master).toBe('tfix-master')
    const text = answerLine(792, 'A', 'the note')
    expect(text).toBe('answer #792: A — the note')
    expect(answerLine(792, 'B')).toBe('answer #792: B')
    const sent: [string, string][] = []
    const outbox = createOutbox({ send: (t: string, x: string) => sent.push([t, x]) })
    outbox.start(0, 'answer #792', [{ target: card.master!, text }])
    outbox.tick(10_000)
    expect(sent).toEqual([['tfix-master', 'answer #792: A — the note']])
    // Once the master relays the answer, the decision is no longer open.
    const answered = [
      ...comments,
      say("**Maintainer's decision, relayed by the master**: #792 option A", 1),
    ]
    expect(parseDecision(answered, ME)).toBeNull()
  })
})

describe('a space of two repositories', () => {
  const ROOT = fileURLToPath(new URL('../', import.meta.url))
  const PAIRS = [
    { name: 'fixture-space', repo: 'bogd3v/fixture', milestone: 1 },
    { name: 'fixture-space', repo: 'bogd3v/fixture-two', milestone: 3, tag: 'tw' },
  ]
  const two = readConfig({ spaces: PAIRS }) as { spaces: { name: string }[] }
  const issue = (number: number) => ({
    number,
    title: `issue ${number}`,
    state: 'open',
    body: null,
    created_at: iso(1000),
  })
  /** The `github` of one space whose two pairs each have these issues, with these comments. */
  const githubOf = (own: Issue[], other: Issue[]) =>
    buildGithub({
      now: NOW,
      spaces: two.spaces,
      reads: {
        'fixture-space': {
          at: iso(0),
          issues: own.map((i) => issue(i.number)),
          comments: Object.fromEntries(own.map((i) => [i.number, i.comments])),
          maintainer: ME,
          others: [
            {
              issues: other.map((i) => issue(i.number)),
              comments: Object.fromEntries(other.map((i) => [i.number, i.comments])),
            },
          ],
        },
      },
    })
  const master = parseAgents([
    {
      address: 'tfix-master',
      name: null,
      parent: null,
      status: 'idle',
      foreground: { argv: ['claude', '--agent', 'master'] },
      labels: { 'herdr.space': 'sp-fixture', where: 'fixture-space / 1' },
    },
  ])
  const signOffs = (needs: { cards: { kind: string }[] }) =>
    needs.cards.filter((c) => c.kind === 'signoff') as unknown as {
      key: string
      head: string
      ref: string
      locked: boolean
      master: string
    }[]

  /** "Needs you" of the `spaces/` recordings, read as `main.js` reads them. */
  async function fixtureNeeds() {
    const config = readConfig({
      checkout: ROOT.replace(/\/$/, ''),
      maintainer: ME,
      fixture: ['test/fixtures/herdr-mod/spaces', 'test/fixtures/herdr-mod'],
      spaces: PAIRS,
    })
    const a = createAdapters({
      exec: () => Promise.reject(new Error('a fixture runs no program')),
      readTextFile: async (path: string) => {
        try {
          return await readFile(path, 'utf8')
        } catch {
          return null
        }
      },
      terminals: () => [],
      config,
    })
    const now: number = await a.now()
    const state = buildState({ now, fetched: { agents: await a.readAgents() } })
    const reads: Record<string, unknown> = {}
    for (const space of config.spaces) {
      reads[space.name] = { ...(await a.readGithub(space)), pulls: await a.readPulls(space) }
    }
    const diffs = Object.fromEntries(
      Object.entries(await a.readDiffs()).map(([k, minutes]) => [k, now - Number(minutes) * MIN])
    )
    return buildNeeds({
      now,
      config,
      github: buildGithub({ now, spaces: config.spaces, reads }),
      agents: state.sources.agents.value!,
      diffs,
    })
  }

  it("the sign-off of an issue of another repository of the space is approved, sign off bogd3v/fixture-two#N, sent to the space's master", () => {
    const needs = buildNeeds({
      now: NOW,
      config: two,
      github: githubOf([], [{ number: 7, title: 'x', comments: atG5('normal', 20) }]),
      agents: master,
      diffs: { 'bogd3v/fixture-two#7': NOW - 4 * MIN },
    })
    const [card] = signOffs(needs)
    expect(card).toMatchObject({
      key: 'signoff:fixture-space bogd3v/fixture-two#7',
      head: 'fixture-space bogd3v/fixture-two#7 · G5',
      ref: 'bogd3v/fixture-two#7',
      repo: 'bogd3v/fixture-two',
      locked: false,
    })
    expect(cardMessages(card)).toEqual([
      { target: 'tfix-master', text: 'approved, sign off bogd3v/fixture-two#7\ntime: 4m diff' },
    ])
    expect(signOffMessage('bogd3v/fixture-two#7')).toBe('approved, sign off bogd3v/fixture-two#7')
    expect(signOffMessage(7)).toBe('approved, sign off #7')
  })

  it('opening the diff of #5 does not unlock the sign-off of bogd3v/fixture-two#5', () => {
    const both = githubOf(
      [{ number: 5, title: 'x', comments: atG5('normal', 20) }],
      [{ number: 5, title: 'y', comments: atG5('normal', 30) }]
    )
    const cards = signOffs(
      buildNeeds({ now: NOW, config: two, github: both, agents: master, diffs: { 5: NOW - MIN } })
    )
    expect(cards.map((c) => [c.ref, c.locked])).toEqual([
      ['bogd3v/fixture-two#5', true],
      ['#5', false],
    ])
    expect(cards.flatMap((c) => cardMessages(c))).toEqual([
      { target: 'tfix-master', text: 'approved, sign off #5\ntime: 1m diff' },
    ])
    // The other way round: only the issue of the other repository is unlocked.
    const other = signOffs(
      buildNeeds({
        now: NOW,
        config: two,
        github: both,
        agents: master,
        diffs: { 'bogd3v/fixture-two#5': NOW - MIN },
      })
    )
    expect(other.map((c) => [c.ref, c.locked])).toEqual([
      ['bogd3v/fixture-two#5', false],
      ['#5', true],
    ])
  })

  it('an answer to the decision on bogd3v/fixture-two#5 is answer bogd3v/fixture-two#5: A', async () => {
    const needs = await fixtureNeeds()
    const card = needs.cards.find((c: { kind: string }) => c.kind === 'decision')
    expect(card).toMatchObject({
      key: 'decision:fixture-space bogd3v/fixture-two#5',
      head: 'fixture-space bogd3v/fixture-two#5 · G2 · r1',
      ref: 'bogd3v/fixture-two#5',
      master: 'tfix-master',
      text: 'Which schema does the block keep?',
    })
    // worker-tw5 is the one that waits, not worker-5.
    expect(card!.cat.state).toBe('needs')
    expect(answerLine(card!.ref!, 'A')).toBe('answer bogd3v/fixture-two#5: A')
    expect(answerLine(card!.ref!, 'B', 'a new one')).toBe(
      'answer bogd3v/fixture-two#5: B — a new one'
    )
    const sent: [string, string][] = []
    const outbox = createOutbox({ send: (t: string, x: string) => sent.push([t, x]) })
    outbox.start(0, `answer ${card!.ref}`, [
      { target: card!.master!, text: answerLine(card!.ref!, 'A') },
    ])
    outbox.tick(10_000)
    expect(sent).toEqual([['tfix-master', 'answer bogd3v/fixture-two#5: A']])
  })

  it("the express card of a space of two repositories signs off #6 and bogd3v/fixture-two#6 in one message to the space's master", async () => {
    const needs = await fixtureNeeds()
    const batches = needs.cards.filter((c: { kind: string }) => c.kind === 'batch')
    expect(batches).toHaveLength(1)
    const [batch] = batches
    expect(batch!.key).toBe('express:fixture-space')
    expect(batch!.items!.map((i: { label: string }) => i.label)).toEqual([
      'fixture-space#6',
      'fixture-space bogd3v/fixture-two#6',
    ])
    expect(cardMessages(batch)).toEqual([
      { target: 'tfix-master', text: 'approved, sign off #6 bogd3v/fixture-two#6' },
    ])
  })
})

describe('the kept parse over the renders of the panel', () => {
  interface Size {
    space: string
    repo: string
    milestone: number
    issues: number
    comments: number
    chars: number
    largest: number
  }
  const size = (
    space: string,
    repo: string,
    milestone: number,
    ...n: [number, number, number, number]
  ): Size => ({
    space,
    repo: `bogd3v/${repo}`,
    milestone,
    issues: n[0],
    comments: n[1],
    chars: n[2],
    largest: n[3],
  })
  /** The sizes of the five pairs of issue #486, as read on 2026-11-26: issues, comments, characters, largest. */
  const MEASURED = [
    size('cms', 'micelio-cms', 12, 34, 297, 398_072, 25_958),
    size('micelio', 'micelio', 18, 4, 70, 107_563, 8_383),
    size('micelio', 'micelio', 15, 6, 92, 128_529, 11_131),
    size('plugin', 'micelio-plugin-core', 8, 2, 30, 24_892, 5_422),
    size('plugin', 'micelio-plugin-core', 4, 3, 42, 99_605, 19_475),
  ]
  /** Every issue of the same milestones open: 1500 comments and 1.9 MB. */
  const GROWN = [
    size('cms', 'micelio-cms', 12, 90, 840, 1_100_000, 25_958),
    size('micelio', 'micelio', 18, 20, 200, 250_000, 8_383),
    size('micelio', 'micelio', 15, 22, 230, 300_000, 11_131),
    size('plugin', 'micelio-plugin-core', 8, 8, 90, 80_000, 5_422),
    size('plugin', 'micelio-plugin-core', 4, 14, 140, 170_000, 19_475),
  ]

  interface Seeded {
    id: number
    updated_at: string
    created_at: string
    text: string
  }

  /** A seeded generator (a linear congruential one): the same set at every run. */
  const seeded = (seed: number) => () => (seed = (seed * 48_271) % 2_147_483_647) / 2_147_483_647

  /** The first lines of one issue's comments: a sign-off, a decision, a held check or an open pull request. */
  const story = (kind: number, number: number): string[] =>
    [
      [
        '**Gate 1 (master): pass**\n\nlane: full\nthe reason of the lane',
        '**Gate 2, round 1 (worker)** · pass',
        '**Gate 3, round 1 (reviewer)** · 0 Blocking, 1 Important',
        '**Gate 4, round 1 (verifier)** · 0 mismatches',
      ],
      [
        '**Gate 1 (master): pass**\n\nlane: normal',
        `**Decision needed** · #${number}\nWhich one?\n- A: one\n- B: two`,
      ],
      [
        '**Gate 1 (master): pass**\n\nlane: normal',
        `held | 2026-11-24 | #${number} | G4 | 3 tests timed out`,
      ],
      [
        '**Gate 1 (master): pass**\n\nlane: express',
        '**Gate 2, round 1 (worker)** · pass',
        'Progress updated by the master:\n\npull request #9 opened',
      ],
    ][kind]!

  /** The comments of every pair, each pair at exactly its sizes. */
  function generate(sizes: readonly Size[], firstId: number) {
    const random = seeded(firstId)
    let id = firstId
    return sizes.map((pair, p) => {
      const issues = Array.from({ length: pair.issues }, (_, i) => p * 1000 + i + 1)
      const each = Math.floor((pair.chars - pair.largest) / (pair.comments - 1))
      let left = pair.chars - pair.largest - each * (pair.comments - 1)
      const perIssue = new Map<number, Seeded[]>(issues.map((n) => [n, []]))
      let swing = 0
      for (let i = 0; i < pair.comments; i += 1) {
        const number = issues[i % issues.length]!
        const list = perIssue.get(number)!
        const filler = [
          'Progress updated by the master:\n',
          `tokens | 2026-11-24 | #${number} | worker | sonnet | 10 | 20 | 1`,
          'A note.\n',
        ]
        const head = story(number % 4, number)[list.length] ?? filler[i % filler.length]!
        // Lengths vary in pairs, so that the total stays exact.
        let length = each
        if (i === 0) length = pair.largest
        else if (i < pair.comments - 1 && i % 2 === 1) {
          swing = Math.floor(random() * each * 0.5)
          length += swing
        } else if (swing > 0) {
          length -= swing
          swing = 0
        }
        if (i === pair.comments - 1) {
          length += left + swing
          left = 0
        }
        const line = '+ a line of the diff of the body, as a master posts it\n'
        const text = `${head}\n${line.repeat(Math.ceil(length / line.length))}`.slice(0, length)
        const at = iso(2000 - i)
        id += 1
        list.push({ id, updated_at: at, created_at: at, text })
      }
      return { pair, issues, perIssue }
    })
  }
  type Generated = ReturnType<typeof generate>

  const spaces = ['cms', 'micelio', 'plugin'].map((name) => {
    const pairs = MEASURED.filter((s) => s.space === name).map((s, i) => ({
      repo: s.repo,
      milestone: s.milestone,
      epic: null,
      tag: i === 0 ? '' : 'two',
    }))
    return { name, repo: pairs[0]!.repo, milestone: pairs[0]!.milestone, pairs }
  })

  /** One render of "Needs you" and Milestones of what one read gave, its comments made by `make`. */
  function render(set: Generated, make: (c: Seeded) => object) {
    const part = (g: Generated[number]) => ({
      issues: g.issues.map((number) => ({
        number,
        title: `issue ${number}`,
        state: 'open',
        body: null,
        created_at: iso(3000),
      })),
      comments: Object.fromEntries(g.issues.map((n) => [n, g.perIssue.get(n)!.map(make)])),
    })
    const github = buildGithub({
      now: NOW,
      spaces,
      reads: Object.fromEntries(
        spaces.map((space) => {
          const [first, ...others] = set.filter((g) => g.pair.space === space.name).map(part)
          return [space.name, { at: iso(0), ...first!, maintainer: ME, others }]
        })
      ),
    })
    const needs = buildNeeds({ now: NOW, config: { spaces }, github, agents: [] })
    const panel = buildPanel({
      now: NOW,
      state: buildState({ now: NOW, fetched: {} }),
      github,
      config: { spaces, maintainer: ME },
    })
    return { cards: needs.cards, milestones: panel.sections.milestones }
  }

  /** Twelve renders, each fourth one from the new objects of a new read; counts the reads of each body. */
  function twelve(set: Generated) {
    const reads = new Map<number, number>()
    const make = ({ text, ...keys }: Seeded) => ({
      ...keys,
      user: { login: ME },
      get body() {
        reads.set(keys.id, (reads.get(keys.id) ?? 0) + 1)
        return text
      },
    })
    const objects = new Map<number, object>()
    let last = { cards: [] as ReturnType<typeof buildNeeds>['cards'], milestones: {} as unknown }
    for (let i = 0; i < 12; i += 1) {
      if (i % 4 === 0) objects.clear()
      last = render(set, (c) => {
        const object = objects.get(c.id) ?? make(c)
        objects.set(c.id, object)
        return object
      })
    }
    return { reads, last: last }
  }

  const totals = (set: Generated) => {
    const all = set.flatMap((g) => [...g.perIssue.values()].flat())
    return {
      comments: all.length,
      chars: all.reduce((sum, c) => sum + c.text.length, 0),
      largest: Math.max(...all.map((c) => c.text.length)),
    }
  }

  it('the renders read a pull request comment of the same id and updated_at once, a review each time', () => {
    const reads = { comment: 0, review: 0 }
    const note = (kind: keyof typeof reads, keys: object) => ({
      ...keys,
      user: { login: ME },
      get body() {
        reads[kind] += 1
        return 'time: 5m diff'
      },
    })
    // A review as REST returns it has an id and no `updated_at`.
    const pull = {
      number: 9,
      issue: 1,
      created_at: iso(10),
      comments: [note('comment', { id: 3_000_001, updated_at: iso(5) })],
      reviews: [] as object[],
    }
    const reviewed = { ...pull, comments: [], reviews: [note('review', { id: 3_000_002 })] }
    for (const pulls of [[pull], [reviewed]]) {
      const made = github([{ number: 1, title: 'x', comments: [] }])
      made.spaces['micelio']!.raw!.pulls = pulls
      for (let i = 0; i < 3; i += 1) {
        expect(buildNeeds({ now: NOW, config, github: made, agents: [] }).cards).toEqual([])
      }
    }
    expect(reads.comment).toBe(1)
    expect(reads.review).toBe(3)
  })

  it('twelve renders of Needs you and Milestones over five pairs of 531 comments read each body once', () => {
    const set = generate(MEASURED, 1_000_000)
    expect(totals(set)).toEqual({ comments: 531, chars: 758_661, largest: 25_958 })
    const { reads, last } = twelve(set)
    expect(new Set(last.cards.map((c: { kind: string }) => c.kind))).toEqual(
      new Set(['signoff', 'decision', 'held'])
    )
    expect(reads.size).toBe(531)
    expect([...new Set(reads.values())]).toEqual([1])
  })

  it('twelve renders over 1500 comments and 1.9 MB read each body once and give the rows of a fresh parse', () => {
    const set = generate(GROWN, 2_000_000)
    expect(totals(set)).toEqual({ comments: 1500, chars: 1_900_000, largest: 25_958 })
    const { reads, last } = twelve(set)
    expect(reads.size).toBe(1500)
    expect([...new Set(reads.values())]).toEqual([1])
    // With no `updated_at` nothing is kept.
    const fresh = render(set, ({ id, created_at, text }) => ({
      id,
      created_at,
      user: { login: ME },
      body: text,
    }))
    expect(last.cards.length).toBeGreaterThan(0)
    expect(last).toEqual(fresh)
  })
})
