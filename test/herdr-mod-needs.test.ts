import { describe, expect, it } from 'vitest'
import {
  buildNeeds,
  cardMessages,
  createOutbox,
  notificationFor,
  parseDecision,
  answerLine,
  // @ts-expect-error a plain JavaScript module of the mod, with no declarations
} from '../herdr/mod/factory/lib/needs.js'
// @ts-expect-error a plain JavaScript module of the mod, with no declarations
import { buildGithub } from '../herdr/mod/factory/lib/panel.js'
// @ts-expect-error a plain JavaScript module of the mod, with no declarations
import { parseAgents } from '../herdr/mod/factory/lib/agents.js'
// @ts-expect-error a plain JavaScript module of the mod, with no declarations
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
          body: null,
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
    expect(blocked.cards[0].age / MIN).toBe(23)
  })

  it('the sign-off is locked until the diff of that issue was opened', () => {
    const issues = [{ number: 389, title: 'cms', comments: atG5('full', 12) }]
    const locked = build(issues).cards[0]
    expect(locked.locked).toBe(true)
    expect(locked.form).toBeNull()
    expect(cardMessages(locked)).toEqual([])
    // A diff opened for another issue unlocks nothing.
    const other = build(issues, { diffs: { 451: NOW - 5 * MIN } }).cards[0]
    expect(cardMessages(other)).toEqual([])
    const open = build(issues, { diffs: { 389: NOW - 5 * MIN } }).cards[0]
    expect(open.locked).toBe(false)
    expect(cardMessages(open)).toEqual([
      { target: 'tfix-master', text: 'approved, sign off #389\ntime: 5m diff' },
    ])
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
    }).cards[0]
    expect(card.lines).toBe('approved, sign off #389\ntime: 11m diff')
    expect(card.form.tracked).toBe(11)
    // The minutes are editable, and a remark loses its parentheses.
    const edited = build([{ number: 389, title: 'cms', comments: atG5('full', 12) }], {
      diffs: { 389: NOW - 11 * MIN },
      forms: { 389: { readMin: '14', remark: 'the (admin) page' } },
    }).cards[0]
    expect(edited.lines).toBe('approved, sign off #389\ntime: 14m diff (the admin page)')
    // An invalid form sends nothing.
    const bad = build([{ number: 389, title: 'cms', comments: atG5('full', 12) }], {
      diffs: { 389: NOW - 11 * MIN },
      forms: { 389: { readMin: 'x' } },
    }).cards[0]
    expect(cardMessages(bad)).toEqual([])
    expect(bad.form.error).toBe('Reading minutes: a whole number.')
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
    expect(batch.items.map((i: { number: number }) => i.number)).toEqual([451, 902, 901])
    expect(batch.unread).toBe(1)
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
    expect(needs.cards.map((c: { messages: unknown[] }) => c.messages.length)).toEqual([1, 1])
    expect(needs.cards.flatMap((c: unknown) => cardMessages(c))).toEqual([
      { target: 'tfix-master2', text: 'approved, sign off #51' },
      { target: 'tfix-master', text: 'approved, sign off #901' },
    ])
  })

  it("a notification's action scrolls the docked panel to Needs you, and does not open a new copy of the mod", () => {
    const [card] = build([{ number: 389, title: 'cms', comments: atG5('full', 12) }]).cards
    const note = notificationFor(card)
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
        }).cards[0]
    )
    expect(lanes.map((c: { form: { showHands: boolean } }) => c.form.showHands)).toEqual([
      true,
      false,
    ])
    expect(lanes[0].lines).toBe('approved, sign off #389\ntime: 11m diff, 4m stack')
    expect(lanes[1].lines).toBe('approved, sign off #389\ntime: 11m diff')
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
    const card = build([{ number: 792, title: 'tab order', comments }]).cards[0]
    expect(card.kind).toBe('decision')
    expect(card.master).toBe('tfix-master')
    const text = answerLine(792, 'A', 'the note')
    expect(text).toBe('answer #792: A — the note')
    expect(answerLine(792, 'B')).toBe('answer #792: B')
    const sent: [string, string][] = []
    const outbox = createOutbox({ send: (t: string, x: string) => sent.push([t, x]) })
    outbox.start(0, 'answer #792', [{ target: card.master, text }])
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
