import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createAdapters, readConfig } from '../herdr/mod/factory/adapters.js'
import {
  buildNeeds,
  cardMessages,
  createOutbox,
  emptyTimeLogForm,
  pullIssue,
} from '../herdr/mod/factory/lib/needs.js'
import { buildGithub } from '../herdr/mod/factory/lib/panel.js'
import { parseAgents } from '../herdr/mod/factory/lib/agents.js'
import { buildState } from '../herdr/mod/factory/lib/state.js'
import {
  hasTimeNote,
  stopTimer,
  timeLine,
  timeMessage,
  timerLabel,
} from '../herdr/mod/factory/lib/time.js'
import { CATEGORIES, correctionLine, emptyLogForm } from '../herdr/mod/factory/lib/log.js'
import { parseTime } from '../packages/factory-tools/src/parse.js'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const NOW = Date.parse('2026-11-24T16:00:00Z')
const MIN = 60_000
const ME = 'ale9420'
const iso = (minutesAgo: number) => new Date(NOW - minutesAgo * MIN).toISOString()

type Lane = 'express' | 'normal' | 'full'
type Read = 'none' | 'diff' | 'report'
type Hand = 'none' | 'stack' | 'test'

describe('the time line of the form', () => {
  it('every time line the form can produce is parsed by the metrics parser to the same minutes and order', () => {
    let produced = 0
    for (const lane of ['express', 'normal', 'full'] as Lane[]) {
      for (const read of ['none', 'diff', 'report'] as Read[]) {
        for (const readMin of ['0', '7', '120']) {
          for (const hand of ['none', 'stack', 'test'] as Hand[]) {
            for (const handMin of ['1', '45']) {
              for (const remark of ['', 'the admin page', 'a (b). c, d']) {
                const { line, error } = timeLine({ read, readMin, hand, handMin, remark, lane })
                const hands = lane === 'full' && hand !== 'none'
                if (read === 'none' && !hands) {
                  expect(line).toBeNull()
                  expect(error).toBe('Give at least one time.')
                  continue
                }
                expect(error).toBeNull()
                produced += 1
                const parsed = parseTime(line!)
                expect(parsed, line!).not.toBeNull()
                expect(parsed).toEqual({
                  diff: read === 'diff' ? Number(readMin) : null,
                  report: read === 'report' ? Number(readMin) : null,
                  handsOn: hands ? Number(handMin) : null,
                })
                // The reading comes first, then the hands-on check.
                const clauses = [
                  ...(read === 'none' ? [] : [`${readMin}m ${read}`]),
                  ...(hands ? [`${handMin}m ${hand}`] : []),
                ]
                const at = clauses.map((c) => (line as string).indexOf(c))
                expect(at).toEqual(at.toSorted((a, b) => a - b))
                expect(at.every((i) => i > 'time: '.length - 1)).toBe(true)
                expect(hasTimeNote(line)).toBe(true)
              }
            }
          }
        }
      }
    }
    expect(produced).toBe(360)
  })

  it('4 minutes on the stack with the remark the demo site is time: 4m stack (the demo site)', () => {
    const form = {
      read: 'none',
      hand: 'stack',
      handMin: '4',
      remark: 'the demo site',
      lane: 'full',
    }
    expect(timeLine(form)).toEqual({ line: 'time: 4m stack (the demo site)', error: null })
    expect(timeMessage(389, 'time: 4m stack (the demo site)')).toBe(
      'time #389: time: 4m stack (the demo site)'
    )
    // The hands-on check is only in full.
    expect(timeLine({ ...form, lane: 'normal' }).error).toBe('Give at least one time.')
    // The minutes are whole numbers.
    expect(timeLine({ ...form, handMin: '4.5' }).error).toBe('Hands-on minutes: a whole number.')
    expect(timeLine({ ...form, read: 'diff', readMin: 'x' }).error).toBe(
      'Reading minutes: a whole number.'
    )
  })

  it('reads a time note as the metrics parser does, for the examples of its README and for lines that are no note', () => {
    const readme = readFileSync(`${ROOT}packages/factory-tools/README.md`, 'utf8')
    const block = /### The `time:` line[\s\S]*?```text\n([\s\S]*?)```/.exec(readme)?.[1] ?? ''
    const examples = block.split('\n').filter((l) => l.trim() !== '')
    expect(examples).toHaveLength(9)
    for (const line of examples) {
      expect(parseTime(line), line).not.toBeNull()
      expect(hasTimeNote(line), line).toBe(true)
    }
    for (const line of [
      'time: 10 hours diff',
      'time: 10m',
      'time: diff read not stated',
      'time:',
      'I took 10m diff',
      'time: 10m diff, lunch',
    ]) {
      expect(parseTime(line), line).toBeNull()
      expect(hasTimeNote(line), line).toBe(false)
    }
    expect(hasTimeNote('Approved.\ntime: 5 minutes report. Done')).toBe(true)
  })

  it('the timer adds the whole minutes it ran, at least one, to the hands-on field', () => {
    expect(timerLabel(null, NOW)).toBe('START TIMER')
    expect(timerLabel(NOW - 42_000, NOW)).toBe('STOP · 0:42')
    expect(timerLabel(NOW - 125_000, NOW)).toBe('STOP · 2:05')
    expect(stopTimer('', NOW - 42_000, NOW)).toBe('1')
    expect(stopTimer('4', NOW - 3 * MIN - 5000, NOW)).toBe('7')
  })
})

interface Pull {
  number: number
  body: string | null
  created_at: string
  comments: { user: { login: string }; body: string }[]
  reviews: { user: { login: string }; body: string }[]
}
const pull = (number: number, body: string, extra: Partial<Pull> = {}): Pull => ({
  number,
  body,
  created_at: iso(5),
  comments: [],
  reviews: [],
  ...extra,
})
const config = { spaces: [{ name: 'micelio', repo: 'bogd3v/micelio-engineering', milestone: 1 }] }
const agents = parseAgents([
  {
    address: 'tfix-master',
    name: null,
    parent: null,
    status: 'idle',
    foreground: { argv: ['claude', '--agent', 'master'] },
    labels: { 'herdr.space': 'sp1', where: 'micelio / 1' },
  },
])
const comment = (body: string, login = ME) => ({ user: { login }, body })
/** The needs of one space with issues 410 (full) and 411 (normal) and these open pull requests. */
function needsWith(pulls: Pull[], timeForms: Record<number, unknown> = {}) {
  const gate1 = (lane: Lane) => [
    {
      user: { login: ME },
      body: `**Gate 1 (master): pass**\n\nlane: ${lane}\n`,
      created_at: iso(300),
      id: 1,
    },
  ]
  const github = buildGithub({
    now: NOW,
    spaces: config.spaces,
    reads: {
      micelio: {
        at: new Date(NOW).toISOString(),
        issues: [410, 411].map((number) => ({
          number,
          title: `issue ${number}`,
          state: 'open',
          body: null,
          created_at: iso(1000),
        })),
        comments: { 410: gate1('full'), 411: gate1('normal') },
        maintainer: ME,
        pulls,
      },
    },
  })
  return buildNeeds({ now: NOW, config, github, agents, timeForms })
}
interface TimeCard {
  key: string
  text: string
  head: string
  lane: string
  pull: number
  master: string | null
  posted: string | null
  form: null | { showHands: boolean; error: string | null; timer: string }
}
const timeCards = (needs: { cards: { kind: string }[] }) =>
  needs.cards.filter((c) => c.kind === 'time') as unknown as TimeCard[]
/** The first time card; throws when there is none. */
const firstTimeCard = (needs: { cards: { kind: string }[] }): TimeCard => {
  const [card] = timeCards(needs)
  if (!card) throw new Error('no time card')
  return card
}

describe('Log time on an open pull request', () => {
  it('a pull request that has a time note from the maintainer gets no card', () => {
    const none = timeCards(needsWith([pull(1001, 'Closes #410')]))
    expect(none.map((c) => c.key)).toEqual(['time:micelio#410'])
    expect(none[0]).toMatchObject({
      text: 'No time note from you on this pull request yet.',
      head: 'micelio#410 · PR open · G6',
      lane: 'full',
      pull: 1001,
      master: 'tfix-master',
    })
    // A note in a comment, or in a review, from the maintainer.
    expect(
      timeCards(needsWith([pull(1001, 'Closes #410', { comments: [comment('time: 8m diff')] })]))
    ).toEqual([])
    expect(
      timeCards(
        needsWith([
          pull(1001, 'Closes #410', { reviews: [comment('Fine.\ntime: 2m report, 3m stack')] }),
        ])
      )
    ).toEqual([])
    // Not a note: someone else's, a remark with no minutes, a line the parser does not read.
    for (const other of [
      comment('time: 8m diff', 'someone-else'),
      comment('time: soon'),
      comment('I will time: 8m diff later'),
    ]) {
      expect(timeCards(needsWith([pull(1001, 'Closes #410', { comments: [other] })]))).toHaveLength(
        1
      )
    }
    // A pull request of no issue of the milestone has no card, nor one that names none.
    expect(timeCards(needsWith([pull(1002, 'Closes #999'), pull(1003, 'No issue')]))).toEqual([])
    expect(pullIssue('Refs #7\n\nCloses #8')).toBe(7)
    expect(pullIssue(null)).toBeNull()
  })

  it('"Log time" opens the form, and its line goes to the master as time #N: time: …', () => {
    const closed = firstTimeCard(needsWith([pull(1001, 'Closes #410')]))
    expect(closed.form).toBeNull()
    expect(cardMessages(closed)).toEqual([])
    const form = {
      410: {
        ...emptyTimeLogForm(),
        open: true,
        hand: 'stack',
        handMin: '4',
        remark: 'the demo site',
      },
    }
    const open = firstTimeCard(needsWith([pull(1001, 'Closes #410')], form))
    expect(open.form).toMatchObject({ showHands: true, error: null, timer: 'START TIMER' })
    expect(open.posted).toBe('time: 4m stack (the demo site)')
    expect(cardMessages(open)).toEqual([
      { target: 'tfix-master', text: 'time #410: time: 4m stack (the demo site)' },
    ])
    // A running timer has not added its minutes: nothing is sent until it stops.
    const running = timeCards(
      needsWith([pull(1001, 'Closes #410')], { 410: { ...form[410], timerAt: NOW - MIN } })
    )[0]
    expect(running?.form?.error).toBe('Stop the timer first.')
    expect(cardMessages(running)).toEqual([])
    // Two pull requests of one issue make one card.
    expect(
      timeCards(needsWith([pull(1001, 'Closes #410'), pull(1004, 'Refs #410')])).map((c) => c.pull)
    ).toEqual([1001])
    // An empty form sends nothing; the normal lane has no hands-on check.
    const empty = firstTimeCard(needsWith([pull(1001, 'Closes #410')], { 410: { open: true } }))
    expect(empty.form?.error).toBe('Give at least one time.')
    expect(cardMessages(empty)).toEqual([])
    const normal = firstTimeCard(
      needsWith([pull(1001, 'Closes #411')], {
        411: { open: true, read: 'diff', readMin: '6', hand: 'test', handMin: '3' },
      })
    )
    expect(normal.form?.showHands).toBe(false)
    expect(normal.posted).toBe('time: 6m diff')
    // Through the outbox, to the master and nowhere else, after 10 s and once.
    const sent: [string, string][] = []
    const outbox = createOutbox({ send: (t: string, x: string) => sent.push([t, x]) })
    outbox.start(0, 'time note #410', cardMessages(open), open.key)
    expect(outbox.tick(9999)).toBeNull()
    outbox.tick(10_000)
    outbox.tick(20_000)
    expect(sent).toEqual([['tfix-master', 'time #410: time: 4m stack (the demo site)']])
  })

  it('the needs fixture draws one time card, for the pull request with no note', async () => {
    const folders = ['test/fixtures/herdr-mod/needs', 'test/fixtures/herdr-mod']
    const read = readConfig({
      checkout: ROOT.replace(/\/$/, ''),
      maintainer: ME,
      dockerHost: 'unix:///x',
      fixture: folders,
      spaces: [
        { name: 'fixture-space', repo: 'bogd3v/fixture', milestone: 1 },
        { name: 'fixture-other', repo: 'bogd3v/other', milestone: 2 },
      ],
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
      config: read,
    })
    const now = await a.now()
    const state = buildState({ now, fetched: { agents: await a.readAgents() } })
    const reads: Record<string, unknown> = {}
    for (const space of read.spaces) {
      reads[space.name] = { ...(await a.readGithub(space)), pulls: await a.readPulls(space) }
    }
    const github = buildGithub({ now, spaces: read.spaces, reads })
    const forms = await a.readForms()
    expect(Object.keys(forms.time)).toEqual(['389'])
    const needs = buildNeeds({
      now,
      config: read,
      github,
      agents: state.sources.agents.value!,
      diffs: { 389: now - 11 * MIN },
      timeForms: { 389: { ...forms.time['389'], open: true } },
    })
    const cards = timeCards(needs)
    expect(cards.map((c) => c.key)).toEqual(['time:fixture-space#389'])
    expect(cards[0]?.posted).toBe('time: 4m stack (the demo site)')
    expect(cards[0]?.master).toBe('tfix-master')
  })
})

describe('the open pull requests', () => {
  it('are read with GET calls only, one list and the comments and reviews of each, and a failed read is none', async () => {
    const calls: string[][] = []
    const failing = { current: false }
    const a = createAdapters({
      exec: async (cmd: string, args: string[]) => {
        calls.push([cmd, ...args])
        if (failing.current) return { code: 1, stdout: '', stderr: 'rate limit' }
        const endpoint = String(args[1])
        const out = endpoint.includes('/pulls?')
          ? [{ number: 9, body: 'Closes #4', created_at: iso(1) }]
          : endpoint.includes('/reviews')
            ? [{ user: { login: ME }, body: 'time: 3m diff' }]
            : [{ user: { login: ME }, body: 'hi' }]
        return {
          code: 0,
          stdout: `HTTP/2.0 200 OK\r\nEtag: W/"x"\r\n\r\n${JSON.stringify(out)}`,
          stderr: '',
        }
      },
      readTextFile: async () => null,
      terminals: () => [],
      config: readConfig({
        checkout: ROOT,
        maintainer: ME,
        dockerHost: 'unix:///x',
        fixture: null,
        spaces: [{ name: 'micelio', repo: 'bogd3v/micelio-engineering', milestone: 1 }],
      }),
    })
    const pulls = await a.readPulls({ name: 'micelio', repo: 'bogd3v/micelio-engineering' })
    expect(pulls).toEqual([
      {
        number: 9,
        body: 'Closes #4',
        created_at: iso(1),
        comments: [{ user: { login: ME }, body: 'hi' }],
        reviews: [{ user: { login: ME }, body: 'time: 3m diff' }],
      },
    ])
    expect(calls).toEqual([
      ['gh', 'api', 'repos/bogd3v/micelio-engineering/pulls?state=open&per_page=100', '--include'],
      ['gh', 'api', 'repos/bogd3v/micelio-engineering/issues/9/comments?per_page=100', '--include'],
      ['gh', 'api', 'repos/bogd3v/micelio-engineering/pulls/9/reviews?per_page=100', '--include'],
    ])
    // A failed read is no pull requests: the milestone's read does not fail with it.
    failing.current = true
    expect(await a.readPulls({ name: 'micelio', repo: 'bogd3v/micelio-engineering' })).toEqual([])
  })
})

describe('Log a correction', () => {
  it('the correction line has one of the six categories, and a pipe in the text is escaped', () => {
    expect(CATEGORIES).toEqual(['lint', 'test', 'skill', 'standard', 'issue', 'docs'])
    for (const category of CATEGORIES) {
      const line = correctionLine({ issue: '#792', what: 'The draft was wrong', category }, NOW)
      expect(line).toMatchObject({
        number: 792,
        send: `log #792 | The draft was wrong | ${category}`,
        error: null,
      })
    }
    for (const category of [null, 'tests', 'Lint', '']) {
      const line = correctionLine({ issue: '#792', what: 'x', category }, NOW)
      expect(line.send).toBeNull()
      expect(line.error).toBe('Pick a category.')
    }
    const piped = correctionLine(
      { issue: '792', what: 'ran a | b\n  and c|d', category: 'test' },
      NOW
    )
    expect(piped.send).toBe('log #792 | ran a \\| b and c\\|d | test')
    // The line the master will post is the one of `C.1`, with the date and no destination yet.
    expect(piped.posted).toBe('factory-log | 2026-11-24 | #792 | ran a \\| b and c\\|d | test | -')
    // The issue and the text are needed.
    expect(correctionLine({ issue: 'micelio', what: 'x', category: 'lint' }, NOW).error).toBe(
      'Issue: #n.'
    )
    expect(correctionLine({ issue: '#7', what: '  ', category: 'lint' }, NOW).error).toBe(
      'Say what was wrong, in one line.'
    )
    expect(emptyLogForm(7)).toEqual({ issue: '#7', what: '', category: null })
    // Through the outbox, to the master, after 10 s and once.
    const sent: [string, string][] = []
    const outbox = createOutbox({ send: (t: string, x: string) => sent.push([t, x]) })
    outbox.start(0, 'correction #792', [{ target: 'tfix-master', text: piped.send! }], 'log')
    outbox.tick(10_000)
    outbox.tick(20_000)
    expect(sent).toEqual([['tfix-master', 'log #792 | ran a \\| b and c\\|d | test']])
  })
})

describe('an issue of another repository of the space', () => {
  it('the time note and the correction of an issue of another repository name it as owner/repo#N', () => {
    const spaces = readConfig({
      spaces: [
        { name: 'micelio', repo: 'bogd3v/micelio-engineering', milestone: 1 },
        { name: 'micelio', repo: 'bogd3v/micelio-cms', milestone: 12, tag: 'c' },
      ],
    }).spaces
    const gate1 = [
      {
        user: { login: ME },
        body: '**Gate 1 (master): pass**\n\nlane: normal\n',
        created_at: iso(300),
        id: 1,
      },
    ]
    const issue = { number: 410, title: 'x', state: 'open', body: null, created_at: iso(1000) }
    const github = buildGithub({
      now: NOW,
      spaces,
      reads: {
        micelio: {
          at: new Date(NOW).toISOString(),
          issues: [issue],
          comments: { 410: gate1 },
          maintainer: ME,
          // `readPulls` marks a pull request of the other repository with it.
          pulls: [{ ...pull(77, 'Closes #410'), repo: 'bogd3v/micelio-cms' }],
          others: [{ issues: [issue], comments: { 410: gate1 } }],
        },
      },
    })
    const form = { open: true, read: 'diff', readMin: '6' }
    const cards = timeCards(
      buildNeeds({
        now: NOW,
        config: { spaces },
        github,
        agents,
        timeForms: { 'bogd3v/micelio-cms#410': form },
      })
    )
    // One card, for the issue of the pull request's own repository; #410 of the space's has none.
    expect(cards.map((c) => [c.key, c.head])).toEqual([
      ['time:micelio bogd3v/micelio-cms#410', 'micelio bogd3v/micelio-cms#410 · PR open · G6'],
    ])
    expect(cardMessages(cards[0])).toEqual([
      { target: 'tfix-master', text: 'time bogd3v/micelio-cms#410: time: 6m diff' },
    ])
    expect(timeMessage(410, 'time: 1m diff')).toBe('time #410: time: 1m diff')
    // The correction form takes `owner/repo#N` as well as `#N`, and names the issue as it came.
    const line = correctionLine(
      { issue: 'bogd3v/micelio-cms#410', what: 'the draft was wrong', category: 'docs' },
      NOW
    )
    expect(line).toMatchObject({
      number: 410,
      repo: 'bogd3v/micelio-cms',
      send: 'log bogd3v/micelio-cms#410 | the draft was wrong | docs',
      posted: 'factory-log | 2026-11-24 | bogd3v/micelio-cms#410 | the draft was wrong | docs | -',
      error: null,
    })
    expect(correctionLine({ issue: '#410', what: 'x', category: 'docs' }, NOW)).toMatchObject({
      repo: null,
      send: 'log #410 | x | docs',
    })
    expect(emptyLogForm('bogd3v/micelio-cms#410').issue).toBe('bogd3v/micelio-cms#410')
    expect(
      correctionLine({ issue: 'micelio-cms#410', what: 'x', category: 'docs' }, NOW).error
    ).toBe('Issue: #n.')
  })
})
