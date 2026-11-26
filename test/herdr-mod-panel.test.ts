import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
// @ts-expect-error a plain JavaScript module of the mod, with no declarations
import { createAdapters, dockerArgs, readConfig } from '../herdr/mod/factory/adapters.js'
import {
  buildGithub,
  buildPanel,
  formatAge,
  loadBars,
  parseStacks,
  // @ts-expect-error a plain JavaScript module of the mod, with no declarations
} from '../herdr/mod/factory/lib/panel.js'
// @ts-expect-error a plain JavaScript module of the mod, with no declarations
import { parseAgents } from '../herdr/mod/factory/lib/agents.js'
// @ts-expect-error a plain JavaScript module of the mod, with no declarations
import { stackOwned } from '../herdr/mod/factory/lib/actions.js'
// @ts-expect-error a plain JavaScript module of the mod, with no declarations
import { heldOrRed } from '../herdr/mod/factory/lib/settings.js'
// @ts-expect-error a plain JavaScript module of the mod, with no declarations
import { buildState } from '../herdr/mod/factory/lib/state.js'
// @ts-expect-error a plain JavaScript module of the mod, with no declarations
import { colours, THEMES } from '../herdr/mod/factory/lib/tokens.js'
// @ts-expect-error a plain JavaScript module of the mod, with no declarations
import { orphans as orphansView } from '../herdr/mod/factory/views/orphans.js'

// The app's UI modules exist only inside it: each element here records the calls made on it.
const ui = vi.hoisted(() => {
  const element = (): unknown => {
    const calls: [string, unknown[]][] = []
    const node: unknown = new Proxy(
      {},
      {
        get: (_, name) =>
          name === 'calls'
            ? calls
            : (...args: unknown[]) => {
                calls.push([String(name), args])
                return node
              },
      }
    )
    return node
  }
  return { element }
})
vi.mock('gpui-kit', () => ({ div: ui.element, image: ui.element }))
vi.mock('gpui-base', () => ({ h_flex: ui.element, v_flex: ui.element }))

/** An element of the stub above, as the view built it. */
interface Element {
  calls: [string, unknown[]][]
}

/** Every element in a drawn tree, the root included. */
function elements(root: unknown): Element[] {
  if (Array.isArray(root)) return root.flatMap(elements)
  if (root === null || (typeof root !== 'object' && typeof root !== 'function')) return []
  const calls = (root as Partial<Element>).calls
  if (!Array.isArray(calls)) return []
  return [root as Element, ...calls.flatMap(([, args]) => args.flatMap(elements))]
}

/** The texts drawn as children of an element. */
const texts = (e: Element): string[] =>
  e.calls
    .filter(([name]) => name === 'child')
    .flatMap(([, args]) => args.filter((a): a is string => typeof a === 'string'))

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const MOD = join(ROOT, 'herdr/mod/factory')
const FIXTURES = 'test/fixtures/herdr-mod'
const SPACES = [
  { name: 'micelio-engineering', repo: 'bogd3v/micelio-engineering', milestone: 12, epic: 790 },
  { name: 'fediverse', repo: 'bogd3v/fediverse', milestone: 3, epic: null },
]
const DOCKER_HOST = 'unix:///run/user/1000/podman/podman.sock'
const props = (fixture: string[] | null) => ({
  checkout: ROOT.replace(/\/$/, ''),
  maintainer: 'ale9420',
  dockerHost: DOCKER_HOST,
  fixture,
  spaces: SPACES,
})

/** A `readTextFile` of the real files, `null` for a missing one, as the app's does. */
const readTextFile = async (path: string): Promise<string | null> => {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return null
  }
}
const noExec = (): Promise<never> => Promise.reject(new Error('a fixture runs no program'))

interface Read {
  at?: string
  error?: string
}

/** What `main.js` does in one round, from a fixture, `rounds` GitHub reads. */
async function round(folders: string[], rounds = 1, theme: 'dark' | 'light' = 'dark') {
  const config = readConfig(props(folders))
  const a = createAdapters({
    exec: noExec,
    readTextFile,
    terminals: () => [],
    config,
  })
  const now: number = await a.now()
  const state = buildState({
    now,
    fetched: {
      slots: await a.readSlots(),
      machine: await a.readMachine(),
      agents: await a.readAgents(),
    },
  })
  let github = null
  for (let i = 0; i < rounds; i += 1) {
    const reads: Record<string, Read> = {}
    for (const space of config.spaces) reads[space.name] = await a.readGithub(space)
    github = buildGithub({ now, spaces: config.spaces, reads, previous: github })
  }
  const stacks = await a.readStacks()
  const stackRows = parseStacks((stacks as { text: string }).text)
  const input = {
    now,
    state,
    github,
    stacks: { value: stackRows, at: null, stale: false, error: null },
    history: await a.readHistory(),
    config,
    theme,
  }
  return { ...input, panel: buildPanel(input), config }
}

const NORMAL = [`${FIXTURES}/normal`, FIXTURES]
const SATURATED = [`${FIXTURES}/saturated`, FIXTURES]
const STALE = [`${FIXTURES}/stale`, `${FIXTURES}/normal`, FIXTURES]

let cats: string

beforeAll(() => {
  cats = mkdtempSync(join(tmpdir(), 'panel-cats-'))
  execFileSync('node', [join(ROOT, 'herdr/mod/build-cats.mjs'), '--out', cats])
})

afterAll(() => {
  rmSync(cats, { recursive: true, force: true })
})

describe('the panel', () => {
  it('the summary strip counts load, heavy, workers, needs and orphans from the state', async () => {
    const { panel } = await round(NORMAL)
    expect(
      panel.strip.map((c: { key: string; label: string; value: string }) => [
        c.key,
        c.label,
        c.value,
      ])
    ).toEqual([
      ['load', 'LOAD', '1'],
      ['heavy', 'HEAVY', '2/3'],
      ['workers', 'WORKERS', '4/6'],
      ['needs', 'NEEDS', '2'],
      ['orphans', 'ORPHANS', '1'],
    ])
    const saturated = await round(SATURATED)
    expect(
      saturated.panel.strip.map((c: { key: string; value: string }) => [c.key, c.value])
    ).toEqual([
      ['load', '81'],
      ['heavy', '3/3'],
      ['workers', '6/6'],
      ['needs', '2'],
      ['orphans', '1'],
    ])
    expect(saturated.panel.strip[0]).toMatchObject({ tone: 'warn-fg', fill: 'warn-fill' })
  })

  it('Machine is one line when nominal and opens with the alarm when saturated', async () => {
    const nominal = (await round(NORMAL)).panel
    expect(nominal.sections.machine).toMatchObject({
      open: false,
      saturated: false,
      pill: 'NOMINAL',
      load: '0.7',
      cores: 32,
      ram: '10/16',
      temp: '35 °C',
      agents: 6,
    })
    expect(nominal.banners.saturated).toBeNull()
    const saturated = (await round(SATURATED)).panel
    expect(saturated.sections.machine).toMatchObject({
      open: true,
      saturated: true,
      pill: 'SATURATED',
      load: '81.3',
      temp: '94 °C',
      tone: 'red',
    })
    expect(saturated.banners.saturated.title).toBe('Load 81 / 32 threads.')
    expect(saturated.sections.machine.bars).toHaveLength(30)
    expect(saturated.sections.machine.bars.at(-1)).toEqual({ load: 81, tone: 'red' })
    const closed = (await round(SATURATED)).panel
    expect(closed.sections.machine.open).toBe(true)
    // The maintainer's own choice wins over the default, and is kept in `open`.
    const forced = buildPanel({ ...(await round(SATURATED)), open: { machine: false } })
    expect(forced.sections.machine.open).toBe(false)
    expect(
      buildPanel({ ...(await round(NORMAL)), open: { machine: true } }).sections.machine.open
    ).toBe(true)
  })

  it('a stale source dims its sections and shows its age, and the others stay live', async () => {
    const live = (await round(NORMAL, 2)).panel
    expect(live.banners.stale).toBeNull()
    expect(live.sections.milestones.dim).toBe(false)
    const stale = (await round(STALE, 2)).panel
    expect(stale.header.sync).toEqual({ text: 'GH STALE 3 MIN', stale: true })
    expect(stale.banners.stale.title).toBe('GitHub: no data for 3 min.')
    expect(stale.banners.stale.text).toContain('as of 15:57 UTC (gh: network error)')
    expect(stale.sections.milestones.dim).toBe(true)
    expect(stale.sections.milestones.note).toBe('as of 15:57 UTC · not live')
    // It keeps its last rows, and the machine, the slots and the stacks are the live ones.
    expect(stale.sections.milestones.spaces[0].issues.map((i: { id: string }) => i.id)).toEqual([
      '#788',
      '#792',
      '#801',
      '#810',
    ])
    expect(stale.sections.machine.pill).toBe('NOMINAL')
    expect(
      stale.sections.slots.rows.filter((r: { free?: boolean }) => r.free !== true)
    ).toHaveLength(2)
    expect(stale.sections.stacks.rows).toHaveLength(3)
    expect(stale.header.sync.stale).toBe(true)
  })

  it('a stale machine, slots or agents source dims its sections with the time of its last good read', async () => {
    const live = await round(NORMAL)
    expect(live.panel.sections.machine).toMatchObject({ dim: false, note: null })
    expect(live.panel.sections.slots).toMatchObject({ dim: false, note: null })
    expect(live.panel.sections.milestones).toMatchObject({ catsDim: false, catsNote: null })
    const later = live.now + 7 * 60_000
    const failed = (names: string[], previous = live.state) =>
      buildPanel({
        ...live,
        now: later,
        state: buildState({
          now: later,
          fetched: Object.fromEntries(names.map((n) => [n, { error: 'no answer' }])),
          previous,
        }),
      }).sections
    const note = 'as of 16:00 UTC · not live'
    // The machine alone: its last load stays, dimmed; the slots and the workers are live.
    const machine = failed(['machine'])
    expect(machine.machine).toMatchObject({ dim: true, note, load: '0.7' })
    expect(machine.slots).toMatchObject({ dim: false, note: null })
    expect(machine.workers).toMatchObject({ dim: false, note: null })
    expect(machine.orphans).toMatchObject({ dim: false, note: null })
    // The slots: the slots, the workers and the orphans, not the machine.
    const slots = failed(['slots'])
    for (const name of ['slots', 'workers', 'orphans'])
      expect(slots[name], name).toMatchObject({ dim: true, note })
    expect(slots.machine).toMatchObject({ dim: false, note: null })
    expect(slots.workers.count).toBe('4/6')
    // The agents: the cats of Milestones.
    const agents = failed(['agents'])
    expect(agents.milestones).toMatchObject({ catsDim: true, catsNote: note, dim: false })
    expect(agents.machine).toMatchObject({ dim: false, note: null })
    expect(agents.slots).toMatchObject({ dim: false, note: null })
  })

  it("the header's sync age grows with the clock while no read lands", async () => {
    const live = await round(NORMAL)
    expect(live.panel.header.sync).toEqual({ text: 'sync 0 s', stale: false })
    // The state of the last read is the same object; only `now` moves.
    const at = (minutes: number) =>
      buildPanel({ ...live, now: live.now + minutes * 60_000 }).header.sync
    expect(at(1)).toEqual({ text: 'sync 1 min', stale: false })
    expect(at(5)).toEqual({ text: 'sync 5 min', stale: false })
  })

  it('an issue row has its track, gate label, lane tag and the cat file of each agent on it', async () => {
    const { panel } = await round(NORMAL)
    const rows = panel.sections.milestones.spaces[0].issues as {
      id: string
      marks: string[]
      label: string
      lane: string
      note: string
      cats: { file: string; state: string; role: string }[]
    }[]
    const byId = (id: string) => rows.find((r) => r.id === id)
    expect(byId('#792')).toMatchObject({
      marks: ['passed', 'running', 'notReached', 'notReached', 'notReached', 'notReached'],
      label: 'G2',
      lane: 'NORMAL',
    })
    expect(byId('#792')?.cats.map((c) => c.file)).toEqual([
      'worker-working-head-dark.svg',
      'reviewer-idle-head-dark.svg',
      'verifier-working-head-dark.svg',
    ])
    expect(byId('#801')).toMatchObject({
      marks: ['passed', 'passed', 'passed', 'passed', 'needs', 'notReached'],
      label: 'G5',
      lane: 'FULL',
      note: 'worker is blocked: it may need you',
    })
    expect(byId('#801')?.cats.map((c) => c.file)).toEqual(['worker-needs-head-dark.svg'])
    expect(byId('#810')).toMatchObject({
      marks: ['passed', 'passed', 'omitted', 'omitted', 'needs', 'notReached'],
      lane: 'EXPRESS',
      note: 'waits for your sign-off',
    })
    expect(byId('#810')?.cats.map((c) => c.file)).toEqual(['master-needs-head-dark.svg'])
    expect(byId('#788')).toMatchObject({ label: 'BLOCKED', note: 'blocked by #792', tone: 'muted' })
    // The epic and the pull request are not rows, and every cat file is one the build writes.
    expect(rows.map((r) => r.id)).toEqual(['#788', '#792', '#801', '#810'])
    const written = new Set(readdirSync(cats))
    for (const row of rows) for (const c of row.cats) expect(written.has(c.file)).toBe(true)
    const light = (await round(NORMAL, 1, 'light')).panel.sections.milestones.spaces[0].issues
    expect(light[1].cats[0].file).toBe('worker-working-head-light.svg')
  })

  it('the rows and the NEEDS count follow the agents of the moment, not those of the last read of GitHub', async () => {
    const input = await round(NORMAL)
    expect(input.panel.strip[3].value).toBe('2')
    const terminals = JSON.parse(
      await readFile(join(ROOT, FIXTURES, 'normal/terminals.json'), 'utf8')
    ) as {
      name: string | null
      status: string
    }[]
    const blocked = terminals.map((t) =>
      t.name === 'worker-792' ? { ...t, status: 'blocked' } : t
    )
    const state = buildState({
      now: input.now,
      previous: input.state,
      fetched: { agents: { at: '2026-11-24T16:00:00Z', terminals: blocked } },
    })
    // GitHub is not read again: only the agents changed.
    const panel = buildPanel({ ...input, state })
    expect(panel.strip[3].value).toBe('3')
    const row = panel.sections.milestones.spaces[0].issues.find(
      (i: { id: string }) => i.id === '#792'
    )
    expect(row.marks[1]).toBe('needs')
    expect(row.note).toBe('worker is blocked: it may need you')
    expect(row.cats[0]).toMatchObject({ role: 'worker', state: 'needs' })
  })

  it('the stacks, the queue and the orphans come from the state', async () => {
    const { panel } = await round(NORMAL)
    expect(panel.sections.stacks).toMatchObject({ count: '3 · 1 unowned', unowned: 1 })
    expect(
      panel.sections.stacks.rows.map((r: { name: string; owner: string | null }) => [
        r.name,
        r.owner,
      ])
    ).toEqual([
      ['wt-792', 'worker-792'],
      ['wt-788', 'worker-788'],
      ['wt-760', null],
    ])
    expect(panel.sections.orphans.rows[0]).toMatchObject({
      pid: 1998180,
      command: 'sleep 602',
      line: 'pid 1998180 · no slot · no owner',
    })
    const saturated = (await round(SATURATED)).panel
    expect(saturated.sections.slots.queue.map((q: { agent: string }) => q.agent)).toEqual([
      'worker-810',
      'verifier-810',
    ])
    expect(saturated.sections.workers.count).toBe('6/6 · next worker waits')
  })

  it("an orphan's row names its program and folder in its title and cuts its command to 120 characters", async () => {
    const { panel } = await round([`${FIXTURES}/orphans`, FIXTURES])
    const [row] = panel.sections.orphans.rows
    expect(row.command.length).toBeGreaterThan(1000)
    expect(row.title).toBe(`zsh · ${row.cwd}`)
    expect(row.brief).toBe(`${row.command.slice(0, 120)}…`)
    // A command of 120 characters or fewer is whole.
    const short = (await round(NORMAL)).panel.sections.orphans.rows[0]
    expect(short).toMatchObject({ title: `sleep · ${short.cwd}`, brief: 'sleep 602' })
  })

  it('the orphans view draws the title on one line and never the whole command', () => {
    const command = `/usr/bin/zsh -c ${'x'.repeat(1000)}`
    const row = {
      pid: 498144,
      command,
      cwd: '/home/factory/tmp/repo',
      title: 'zsh · /home/factory/tmp/repo',
      brief: `${command.slice(0, 120)}…`,
      line: 'pid 498144 · no slot · no owner',
    }
    const ctx = {
      c: {},
      ui: {
        processes: { 498144: { cores: '0.0', ageMs: 1000 } },
        confirmation: null,
        formatAge,
      },
    }
    const drawn = elements(orphansView(ctx, { open: true, count: '1', rows: [row] }))
    const title = drawn.filter((e) => texts(e).includes(row.title))
    expect(title).toHaveLength(1)
    expect(title[0]?.calls.map(([name]) => name)).toContain('truncate')
    const all = drawn.flatMap(texts)
    expect(all).toContain(`command  ${row.brief}`)
    expect(all.filter((text) => text.includes(command))).toEqual([])
  })
})

describe('a space of several repositories', () => {
  const PAIRS = [
    { name: 'fixture-space', repo: 'bogd3v/fixture', milestone: 1 },
    { name: 'fixture-space', repo: 'bogd3v/fixture-two', milestone: 3, tag: 'tw' },
  ]
  const SPACES_FIXTURE = [`${FIXTURES}/spaces`, FIXTURES]

  /** One round of `main.js` on the `spaces/` recordings. */
  async function spacesRound() {
    const config = readConfig({ ...props(SPACES_FIXTURE), spaces: PAIRS })
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
    const stacks = parseStacks(((await a.readStacks()) as { text: string }).text)
    return buildPanel({
      now,
      state,
      github,
      stacks: { value: stacks, at: null, stale: false, error: null },
      config,
    })
  }

  it("a space of two pairs reads each pair's issues, comments and pull requests in that pair's repository, with GET calls only", async () => {
    const calls: string[][] = []
    const a = createAdapters({
      exec: async (cmd: string, args: string[]) => {
        calls.push([cmd, ...args])
        const endpoint = String(args[1])
        const out = endpoint.includes('/pulls?')
          ? [{ number: 40, body: 'Closes #5', created_at: '2026-11-24T15:00:00Z' }]
          : endpoint.includes('/issues?')
            ? [{ number: 5, title: 't', state: 'open', body: null }]
            : []
        return {
          code: 0,
          stdout: `HTTP/2.0 200 OK\r\nEtag: W/"x"\r\n\r\n${JSON.stringify(out)}`,
          stderr: '',
        }
      },
      readTextFile,
      terminals: () => [],
      config: readConfig({ ...props(null), spaces: PAIRS }),
    })
    const config = readConfig({ ...props(null), spaces: PAIRS })
    expect(config.spaces).toHaveLength(1)
    const space = config.spaces[0]
    const read = await a.readGithub(space)
    expect(read).toMatchObject({
      issues: [{ number: 5 }],
      comments: { 5: [] },
      others: [{ issues: [{ number: 5 }], comments: { 5: [] } }],
    })
    const pulls = await a.readPulls(space)
    // A pull request of the other repository carries it; the space's own carries none, as before.
    expect(pulls.map((p: { number: number; repo?: string }) => [p.number, p.repo])).toEqual([
      [40, undefined],
      [40, 'bogd3v/fixture-two'],
    ])
    expect(calls).toEqual([
      ['gh', 'api', 'repos/bogd3v/fixture/issues?milestone=1&state=all&per_page=100', '--include'],
      ['gh', 'api', 'repos/bogd3v/fixture/issues/5/comments?per_page=100', '--include'],
      [
        'gh',
        'api',
        'repos/bogd3v/fixture-two/issues?milestone=3&state=all&per_page=100',
        '--include',
      ],
      ['gh', 'api', 'repos/bogd3v/fixture-two/issues/5/comments?per_page=100', '--include'],
      ['gh', 'api', 'repos/bogd3v/fixture/pulls?state=open&per_page=100', '--include'],
      ['gh', 'api', 'repos/bogd3v/fixture/issues/40/comments?per_page=100', '--include'],
      ['gh', 'api', 'repos/bogd3v/fixture/pulls/40/reviews?per_page=100', '--include'],
      ['gh', 'api', 'repos/bogd3v/fixture-two/pulls?state=open&per_page=100', '--include'],
      ['gh', 'api', 'repos/bogd3v/fixture-two/issues/40/comments?per_page=100', '--include'],
      ['gh', 'api', 'repos/bogd3v/fixture-two/pulls/40/reviews?per_page=100', '--include'],
    ])
    // Every call is `gh api <endpoint> --include`, a GET: no method, no field, no input.
    for (const call of calls) expect(call.slice(0, 4)).toEqual(['gh', 'api', call[2], '--include'])
    for (const call of calls) expect(call).toHaveLength(4)
    calls.length = 0
    await a.readMilestones(config.spaces)
    expect(calls).toEqual([
      ['gh', 'api', 'repos/bogd3v/fixture/milestones?state=all&per_page=100', '--include'],
      ['gh', 'api', 'repos/bogd3v/fixture-two/milestones?state=all&per_page=100', '--include'],
    ])
  })

  it('Milestones shows #5 and bogd3v/fixture-two#5 in one space, each with its own agents', async () => {
    const panel = await spacesRound()
    const spaces = panel.sections.milestones.spaces as {
      name: string
      merged: string
      issues: { id: string; repo: string; note: string; cats: { name: string }[] }[]
    }[]
    expect(spaces.map((s) => s.name)).toEqual(['fixture-space'])
    const issues = spaces[0]?.issues ?? []
    expect(issues.map((i) => i.id)).toEqual([
      '#5',
      '#6',
      'bogd3v/fixture-two#5',
      'bogd3v/fixture-two#6',
    ])
    expect(spaces[0]?.merged).toBe('0/4')
    const byId = (id: string) => issues.find((i) => i.id === id)
    // #5 waits at G5, so its master's cat comes first; worker-tw5 is not on it.
    expect(byId('#5')?.cats.map((c) => c.name)).toEqual(['master', 'worker-5'])
    expect(byId('#5')?.repo).toBe('bogd3v/fixture')
    expect(byId('bogd3v/fixture-two#5')?.cats.map((c) => c.name)).toEqual(['worker-tw5'])
    expect(byId('bogd3v/fixture-two#5')?.note).toBe('worker is blocked: it may need you')
    expect(byId('bogd3v/fixture-two#5')?.repo).toBe('bogd3v/fixture-two')
  })

  it('a stack named wt-tw5 belongs to worker-tw5 and not to worker-5', async () => {
    const panel = await spacesRound()
    expect(panel.sections.stacks.rows).toEqual([
      { name: 'wt-tw5', status: 'running(2)', owner: 'worker-tw5', removable: false, age: null },
    ])
    // With no live agent of the pair tagged tw, worker-5 does not own it: it can be brought down.
    const config = readConfig({ ...props(SPACES_FIXTURE), spaces: PAIRS })
    const agents = parseAgents([
      { address: 'tm', name: null, parent: null, status: 'idle', labels: {} },
      { address: 't5', name: 'worker-5', parent: 'tm', status: 'working' },
    ])
    const alone = buildPanel({
      now: Date.parse('2026-11-24T16:00:00Z'),
      state: { stale: false, sources: { agents: { value: agents } } },
      github: null,
      stacks: {
        value: [{ name: 'wt-tw5', status: 'running(2)' }],
        at: null,
        stale: false,
        error: null,
      },
      config,
    })
    expect(alone.sections.stacks.rows[0]).toMatchObject({ owner: null, removable: true })
    // The lease of worker-tw5 owns it, that of worker-5 does not; the machine's buttons agree.
    const leased = (agent: string) =>
      buildPanel({
        now: Date.parse('2026-11-24T16:00:00Z'),
        state: {
          stale: false,
          sources: {
            agents: { value: agents },
            slots: {
              value: {
                heavy: { used: 0, total: 0, slots: [] },
                leases: { used: 1, total: 2, leases: [{ agent }] },
                queue: [],
                orphans: [],
                paused: false,
              },
            },
          },
        },
        github: null,
        stacks: { value: [{ name: 'wt-tw5', status: 'up' }], at: null, stale: false, error: null },
        config,
      }).sections.stacks.rows[0].owner
    expect(leased('worker-tw5')).toBe('worker-tw5')
    expect(leased('worker-5')).toBeNull()
    expect(stackOwned('wt-tw5', agents, [], ['tw'])).toBe(false)
    expect(stackOwned('wt-tw5', agents, [{ agent: 'worker-tw5' }], ['tw'])).toBe(true)
    expect(stackOwned('wt-5', agents, [], ['tw'])).toBe(true)
  })

  it("a pair's epic is no row, and a blocked or red issue of another repository is named by its reference", () => {
    const config = readConfig({
      ...props(null),
      spaces: [
        { name: 'fixture-space', repo: 'bogd3v/fixture', milestone: 1, epic: 2 },
        { name: 'fixture-space', repo: 'bogd3v/fixture-two', milestone: 3, epic: 9, tag: 'tw' },
      ],
    })
    const at = '2026-11-24T10:00:00Z'
    const issue = (number: number, body: string | null = null) => ({
      number,
      title: `issue ${number}`,
      state: 'open',
      body,
      created_at: at,
    })
    const say = (body: string) => [{ user: { login: 'ale9420' }, body, created_at: at, id: 1 }]
    const now = Date.parse('2026-11-24T16:00:00Z')
    const github = buildGithub({
      now,
      spaces: config.spaces,
      reads: {
        'fixture-space': {
          at,
          issues: [issue(2), issue(9), issue(4)],
          comments: {},
          maintainer: 'ale9420',
          others: [
            {
              issues: [issue(9), issue(2), issue(3), issue(4, '## Depends on\n\n- #3\n')],
              comments: {
                3: say('**Gate 3, round 1 (reviewer-tw3)** · 2 Blocking, 0 Important'),
              },
            },
          ],
        },
      },
    })
    const state = { stale: false, sources: {} }
    const panel = buildPanel({ now, state, github, config })
    const rows = panel.sections.milestones.spaces[0].issues as {
      id: string
      note: string
      marks: string[]
    }[]
    // Each pair leaves its own epic out: #2 of the first and #9 of the second.
    expect(rows.map((r) => r.id)).toEqual([
      '#4',
      '#9',
      'bogd3v/fixture-two#2',
      'bogd3v/fixture-two#3',
      'bogd3v/fixture-two#4',
    ])
    expect(rows.find((r) => r.id === 'bogd3v/fixture-two#4')?.note).toBe(
      'blocked by bogd3v/fixture-two#3'
    )
    // The red gate of bogd3v/fixture-two#3 posts its own notification, apart from one of #3.
    expect([...heldOrRed([], panel.sections)]).toEqual(['red:fixture-space bogd3v/fixture-two#3'])
  })
})

describe('the model of the panel', () => {
  it('formats ages and buckets the load of the last 15 minutes', () => {
    expect(formatAge(4000)).toBe('4 s')
    expect(formatAge(3 * 60_000)).toBe('3 min')
    expect(formatAge(2 * 3_600_000)).toBe('2 h')
    expect(formatAge(null)).toBe('—')
    const now = 1_000_000_000
    const bars = loadBars(
      [
        { at: now - 10_000, load: 10 },
        { at: now - 20_000, load: 40 },
        { at: now - 20 * 60_000, load: 99 },
      ],
      now,
      32
    )
    expect(bars).toHaveLength(30)
    expect(bars.at(-1)).toEqual({ load: 40, tone: 'red' })
    expect(bars.filter((b: { load: number | null }) => b.load !== null)).toHaveLength(1)
  })

  it('the colours of tokens.js are the names and values of tokens.json', () => {
    const tokens = JSON.parse(readFileSync(join(ROOT, 'herdr/mod/design/tokens.json'), 'utf8')) as {
      themes: unknown
    }
    expect(THEMES).toEqual(tokens.themes)
  })

  it("the neutral colours are the app's theme() and the colours of meaning are those of tokens.json for the app's appearance", () => {
    const app = {
      canvas: '#111111',
      surface: '#222222',
      raised: '#333333',
      border: '#444444',
      foreground: '#555555',
      muted: '#666666',
      working: '#010203',
      blocked: '#040506',
      accent: '#070809',
    }
    const neutral = {
      bg: '#111111',
      surface: '#222222',
      surface2: '#333333',
      line: '#444444',
      fg: '#555555',
      muted: '#666666',
    }
    for (const dark of [true, false]) {
      const base = dark ? THEMES.dark : THEMES.light
      const got = colours(app, dark)
      expect(got).toEqual({ ...base, ...neutral })
      // The app's working, blocked and accent colours are never used.
      expect(Object.values(got)).not.toContain('#010203')
      expect(Object.values(got)).not.toContain('#040506')
      expect(Object.values(got)).not.toContain('#070809')
    }
  })

  it("a colour the app's theme() lacks keeps the value of tokens.json", () => {
    const got = colours({ canvas: '#111111', surface: 42, raised: null, border: undefined }, false)
    expect(got).toEqual({ ...THEMES.light, bg: '#111111' })
    expect(colours({}, true)).toEqual(THEMES.dark)
    expect(colours(undefined, true)).toEqual(THEMES.dark)
  })

  it('the two glows are the cyan and magenta of the dark theme', () => {
    const glow = (name: string) => readFileSync(join(MOD, name), 'utf8')
    expect(glow('glow-cyan.svg')).toContain(THEMES.dark.cyan)
    expect(glow('glow-magenta.svg')).toContain(THEMES.dark.magenta)
  })
})

describe('the adapters', () => {
  it('a fixture is read from its folders in order and no program runs', async () => {
    const a = createAdapters({
      exec: noExec,
      readTextFile,
      terminals: () => [],
      config: readConfig(props(NORMAL)),
    })
    expect(await a.now()).toBe(Date.parse('2026-11-24T16:00:00Z'))
    const agents = (await a.readAgents()) as { terminals: { name: string | null }[] }
    expect(agents.terminals.map((t) => t.name)).toContain('verifier-792')
    const base = createAdapters({
      exec: noExec,
      readTextFile,
      terminals: () => [],
      config: readConfig(props([FIXTURES])),
    })
    const plain = (await base.readAgents()) as { terminals: { name: string | null }[] }
    expect(plain.terminals.map((t) => t.name)).not.toContain('verifier-792')
  })

  it('the panel runs only commands that read: status, nproc, gh api of GET endpoints and docker compose ls', async () => {
    const calls: [string, string[]][] = []
    const reads: string[] = []
    const a = createAdapters({
      exec: async (cmd: string, args: string[]) => {
        calls.push([cmd, args])
        const head = 'HTTP/2.0 200 OK\r\nEtag: W/"x"\r\n\r\n'
        if (cmd === 'gh' && String(args[1]).includes('/comments'))
          return { code: 0, stdout: `${head}[]`, stderr: '' }
        if (cmd === 'gh') {
          return {
            code: 0,
            stdout: head + JSON.stringify([{ number: 5, title: 't', state: 'open', body: null }]),
            stderr: '',
          }
        }
        return { code: 0, stdout: cmd === 'nproc' ? '8\n' : '[]', stderr: '' }
      },
      readTextFile: async (path: string) => {
        reads.push(path)
        return path.endsWith('/name') ? 'k10temp\n' : '1 1 1\n'
      },
      terminals: () => [],
      config: readConfig(props(null)),
    })
    await a.readSlots()
    await a.readMachine()
    await a.readStacks()
    await a.readGithub(SPACES[0])
    const lines = calls.map(([cmd, args]) => [cmd, ...args].join(' '))
    expect(lines.filter((l) => !l.startsWith('gh '))).toEqual([
      `bash ${ROOT.replace(/\/$/, '')}/herdr/factory-slot.sh status`,
      'nproc',
      `docker -H ${DOCKER_HOST} compose ls --format json`,
    ])
    const gh = calls.filter(([cmd]) => cmd === 'gh')
    expect(gh.length).toBe(2)
    for (const [, args] of gh) {
      expect(args[0]).toBe('api')
      // A GET: the endpoint, `--include`, and at most one If-None-Match header; no method, field or input.
      expect(args[2]).toBe('--include')
      expect(args.length === 3 || (args.length === 5 && args[3] === '--header')).toBe(true)
      expect(args[1]).toMatch(/^repos\/bogd3v\/micelio-engineering\/issues(\?|\/5\/comments\?)/)
    }
    for (const path of reads) expect(path).toMatch(/^\/(proc|sys)\//)
  })

  it("every docker call carries -H with the layout's dockerHost, and a layout with none runs docker with no -H", async () => {
    const run = async (raw: unknown) => {
      const calls: [string, string[]][] = []
      const a = createAdapters({
        exec: async (cmd: string, args: string[]) => {
          calls.push([cmd, args])
          return { code: 0, stdout: '[]', stderr: '' }
        },
        readTextFile,
        terminals: () => [],
        config: readConfig(raw),
      })
      await a.readStacks()
      return calls.filter(([cmd]) => cmd === 'docker')
    }
    const withHost = await run(props(null))
    expect(withHost).toEqual([['docker', ['-H', DOCKER_HOST, 'compose', 'ls', '--format', 'json']]])
    for (const dockerHost of [undefined, 7, null]) {
      const none = await run({ ...props(null), dockerHost })
      expect(none).toEqual([['docker', ['compose', 'ls', '--format', 'json']]])
    }
    expect(dockerArgs(readConfig(props(null)), ['ps'])).toEqual(['-H', DOCKER_HOST, 'ps'])
    expect(dockerArgs(readConfig({}), ['ps'])).toEqual(['ps'])
    // A fixture runs no program and does not read dockerHost.
    const fixture = readConfig(props([FIXTURES]))
    const a = createAdapters({ exec: noExec, readTextFile, terminals: () => [], config: fixture })
    expect(await a.readStacks()).toHaveProperty('text')
  })

  it('a gh that fails makes GitHub stale with its age, and the rest of the panel keeps working', async () => {
    const config = readConfig(props(null))
    let failing = false
    const a = createAdapters({
      exec: async (cmd: string) => {
        if (cmd === 'gh' && failing) return { code: 1, stdout: '', stderr: 'gh: network error\n' }
        if (cmd === 'gh') return { code: 0, stdout: 'HTTP/2.0 200 OK\r\n\r\n[]', stderr: '' }
        if (cmd === 'nproc') return { code: 0, stdout: '8\n', stderr: '' }
        return { code: 0, stdout: cmd === 'bash' ? '' : '[]', stderr: '' }
      },
      readTextFile: async (path: string) =>
        path === '/proc/loadavg'
          ? '0.5 0.5 0.5 1/1 1\n'
          : path === '/proc/meminfo'
            ? 'MemTotal: 100 kB\nMemAvailable: 50 kB\n'
            : null,
      terminals: () => [],
      clock: () => Date.parse('2026-11-24T16:00:00Z'),
      config,
    })
    const first = Date.parse('2026-11-24T16:00:00Z')
    let github = buildGithub({
      now: first,
      spaces: config.spaces,
      reads: { 'micelio-engineering': await a.readGithub(config.spaces[0]) },
    })
    failing = true
    github = buildGithub({
      now: first + 90_000,
      spaces: config.spaces,
      previous: github,
      reads: { 'micelio-engineering': await a.readGithub(config.spaces[0]) },
    })
    const state = buildState({
      now: first + 90_000,
      fetched: { slots: await a.readSlots(), machine: await a.readMachine() },
    })
    const panel = buildPanel({ now: first + 90_000, state, github, config })
    expect(panel.banners.stale.title).toBe('GitHub: no data for 1 min.')
    expect(panel.banners.stale.text).toContain('gh: network error')
    expect(panel.sections.machine.load).toBe('0.5')
    expect(panel.sections.slots.rows).toHaveLength(3)
  })

  it('no token is read or stored', () => {
    for (const file of ['adapters.js', 'main.js']) {
      expect(readFileSync(join(MOD, file), 'utf8')).not.toMatch(
        /GH_TOKEN|GITHUB_TOKEN|auth token|hosts\.yml|Authorization/
      )
    }
  })
})

describe('the views', () => {
  it('name the two typefaces by family and ship their files and licence texts', () => {
    const views = readdirSync(join(MOD, 'views')).map((f) =>
      readFileSync(join(MOD, 'views', f), 'utf8')
    )
    const families = new Set(
      [...views.join('\n').matchAll(/(?:DISPLAY|MONO) = '([^']+)'/g)].map((m) => m[1])
    )
    expect([...families].toSorted()).toEqual(['Chakra Petch', 'JetBrains Mono'])
    expect(readdirSync(join(MOD, 'fonts')).toSorted()).toEqual([
      'ChakraPetch-Bold.ttf',
      'ChakraPetch-Medium.ttf',
      'ChakraPetch-SemiBold.ttf',
      'JetBrainsMono-Bold.ttf',
      'JetBrainsMono-Medium.ttf',
      'JetBrainsMono-Regular.ttf',
      'OFL-ChakraPetch.txt',
      'OFL-JetBrainsMono.txt',
    ])
  })

  it('one file per section, and none sends anything', () => {
    expect(readdirSync(join(MOD, 'views')).toSorted()).toEqual([
      'banners.js',
      'board.js',
      'customize.js',
      'detail.js',
      'header.js',
      'leases.js',
      'legend.js',
      'machine.js',
      'milestones.js',
      'needs.js',
      'orphans.js',
      'slots.js',
      'stacks.js',
      'strip.js',
      'ui.js',
    ])
    for (const f of readdirSync(join(MOD, 'views'))) {
      expect(readFileSync(join(MOD, 'views', f), 'utf8')).not.toMatch(
        /\b(hc|run|exec|openOverlay|notify)\(/
      )
    }
    expect(existsSync(join(MOD, 'mod.json'))).toBe(true)
    expect(JSON.parse(readFileSync(join(MOD, 'mod.json'), 'utf8'))).toEqual({
      place: 'right',
      size: 380,
      focusable: true,
    })
  })
})
