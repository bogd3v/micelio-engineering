import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createAdapters, dockerArgs, readConfig } from '../herdr/mod/factory/adapters.js'
import {
  buildGithub,
  buildPanel,
  formatAge,
  loadBars,
  parseStacks,
} from '../herdr/mod/factory/lib/panel.js'
import { parseAgents } from '../herdr/mod/factory/lib/agents.js'
import { readEpics } from '../herdr/mod/factory/lib/reads.js'
import { stackOwned } from '../herdr/mod/factory/lib/actions.js'
import { heldOrRed } from '../herdr/mod/factory/lib/settings.js'
import { buildState } from '../herdr/mod/factory/lib/state.js'
import { colours, THEMES } from '../herdr/mod/factory/lib/tokens.js'
import { banners as bannersView } from '../herdr/mod/factory/views/banners.js'
import { orphans as orphansView } from '../herdr/mod/factory/views/orphans.js'
import { stacks as stacksView } from '../herdr/mod/factory/views/stacks.js'
import { badge, button, cat, gateMark, laneTag } from '../herdr/mod/factory/views/ui.js'
import type { ViewContext } from '../herdr/mod/types/views.js'

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
// An image keeps its path as a call named `source`, so a test can read what is drawn.
vi.mock('gpui-kit', () => ({
  div: ui.element,
  image: (path: string) => (ui.element() as { source: (p: string) => unknown }).source(path),
}))
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

/** The first argument of each call named `name` on an element. */
const said = (e: Element, name: string): unknown[] =>
  e.calls.filter(([n]) => n === name).map(([, args]) => args[0])

/** The colour tokens an element was drawn with. */
const paint = (e: Element) => ({
  bg: said(e, 'bg'),
  text: said(e, 'text_color'),
  border: said(e, 'border_color'),
})

/** The paths of the images in a drawn tree, in order. */
const images = (root: unknown): unknown[] => elements(root).flatMap((e) => said(e, 'source'))

/** The only element of a tree that draws `text` as its own child. */
function drawing(root: unknown, text: string): Element {
  const found = elements(root).filter((e) => texts(e).includes(text))
  expect(found, text).toHaveLength(1)
  return found[0] as Element
}

/** Runs the click handler an element recorded, as the app does, with `cx`. */
function click(e: Element, cx: unknown): void {
  expect(said(e, 'on_click')).toHaveLength(1)
  ;(said(e, 'on_click')[0] as (event: unknown, cx: unknown) => void)(null, cx)
}

/** Colours whose value is their own token name, so a test reads which token a view used. */
const TOKENS = Object.fromEntries(Object.keys(THEMES.dark).map((name) => [name, name]))

/** The `ctx` of a view, with a spy for each thing the view may call. */
function viewContext({
  dark = true,
  confirmation = null,
}: { dark?: boolean; confirmation?: unknown } = {}) {
  const ctx = {
    c: TOKENS,
    dark,
    ui: {
      processes: {},
      confirmation,
      formatAge,
      lockedNote: 'locked while no master answers',
      toggle: vi.fn(),
      confirm: vi.fn(),
      cancel: vi.fn(),
      askBringDown: vi.fn(),
      showProcess: vi.fn(),
      askTerminate: vi.fn(),
    },
  }
  return ctx as typeof ctx & ViewContext
}

/** A `panel.sections.stacks` of one owned stack and two that nothing owns. */
const STACKS = {
  open: true,
  count: '3 · 2 unowned',
  unowned: 2,
  error: null as string | null,
  rows: [
    { name: 'wt-1', status: 'running(1)', owner: 'worker-1', removable: false, age: null },
    { name: 'wt-2', status: 'running(2)', owner: null, removable: true, age: '3 min' },
    { name: 'wt-3', status: 'exited(1)', owner: null, removable: true, age: null },
  ],
}

/** A row of `panel.sections.orphans`. */
const orphanRow = (pid: number) => ({
  pid,
  command: `sleep ${pid}`,
  cwd: '/home/factory/tmp/repo',
  title: `sleep · repo of ${pid}`,
  brief: `sleep ${pid}`,
  line: `pid ${pid} · no slot · no owner`,
})

/** A live `panel.sections.orphans` of two processes. */
const ORPHANS = {
  open: true,
  dim: false,
  note: null as string | null,
  count: '2',
  rows: [orphanRow(11), orphanRow(22)],
}

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

  it('a layout with no maintainer login shows the maintainer banner, and one with a login shows none', async () => {
    const { panel, ...input } = await round(NORMAL)
    expect(panel.banners.maintainer).toBeNull()
    const none = buildPanel({ ...input, config: { ...input.config, maintainer: '' } })
    expect(none.banners.maintainer).toEqual({
      title: 'No maintainer login.',
      text: "Gates, time notes, held checks, decisions and tokens count only the maintainer's comments, and this layout names none. Run herdr/mod/install.sh --maintainer <login>.",
    })
    expect(bannersView(viewContext(), panel.banners)).toEqual([])
    const drawn = bannersView(viewContext(), none.banners)
    expect(drawn).toHaveLength(1)
    const title = drawing(drawn[0], 'No maintainer login.')
    expect(said(title, 'text_color')).toEqual(['red'])
    const box = drawn[0] as unknown as Element
    expect(said(box, 'border_color')).toEqual(['red'])
    expect(said(box, 'bg')).toEqual(['red-bg'])
  })

  it('readConfig reads an empty or placeholder maintainer as none', () => {
    const read = (maintainer: unknown) => readConfig({ ...props(null), maintainer }).maintainer
    for (const value of ['', '{{maintainer}}', 'under_score', '-dash', 'a'.repeat(40), 7]) {
      expect(read(value), String(value)).toBe('')
    }
    for (const value of ['ale9420', 'a', 'Some-One', 'a'.repeat(39)]) {
      expect(read(value)).toBe(value)
    }
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
    expect(saturated.banners.saturated!.title).toBe('Load 81 / 32 threads.')
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
    expect(stale.banners.stale!.title).toBe('GitHub: no data for 3 min.')
    expect(stale.banners.stale!.text).toContain('as of 15:57 UTC (gh: network error)')
    expect(stale.sections.milestones.dim).toBe(true)
    expect(stale.sections.milestones.note).toBe('as of 15:57 UTC · not live')
    // It keeps its last rows, and the machine, the slots and the stacks are the live ones.
    expect(stale.sections.milestones.spaces[0]!.issues.map((i: { id: string }) => i.id)).toEqual([
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
    const rows = panel.sections.milestones.spaces[0]!.issues as {
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
    const light = (await round(NORMAL, 1, 'light')).panel.sections.milestones.spaces[0]!.issues
    expect(light[1]!.cats[0]!.file).toBe('worker-working-head-light.svg')
  })

  it('the rows and the NEEDS count follow the agents of the moment, not those of the last read of GitHub', async () => {
    const input = await round(NORMAL)
    expect(input.panel.strip[3]!.value).toBe('2')
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
    expect(panel.strip[3]!.value).toBe('3')
    const row = panel.sections.milestones.spaces[0]!.issues.find(
      (i: { id: string }) => i.id === '#792'
    )
    expect(row!.marks[1]).toBe('needs')
    expect(row!.note).toBe('worker is blocked: it may need you')
    expect(row!.cats[0]).toMatchObject({ role: 'worker', state: 'needs' })
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
    expect(row!.command.length).toBeGreaterThan(1000)
    expect(row!.title).toBe(`zsh · ${row!.cwd}`)
    expect(row!.brief).toBe(`${row!.command.slice(0, 120)}…`)
    // A command of 120 characters or fewer is whole.
    const short = (await round(NORMAL)).panel.sections.orphans.rows[0]!
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
    const space = config.spaces[0]!
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
      }).sections.stacks.rows[0]!.owner
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
    const rows = panel.sections.milestones.spaces[0]!.issues as {
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
    await a.readGithub(SPACES[0]!)
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
      reads: { 'micelio-engineering': await a.readGithub(config.spaces[0]!) },
    })
    failing = true
    github = buildGithub({
      now: first + 90_000,
      spaces: config.spaces,
      previous: github,
      reads: { 'micelio-engineering': await a.readGithub(config.spaces[0]!) },
    })
    const state = buildState({
      now: first + 90_000,
      fetched: { slots: await a.readSlots(), machine: await a.readMachine() },
    })
    const panel = buildPanel({ now: first + 90_000, state, github, config })
    expect(panel.banners.stale!.title).toBe('GitHub: no data for 1 min.')
    expect(panel.banners.stale!.text).toContain('gh: network error')
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

  it("the stacks view shows each stack's owner, or NO AGENT with its age, and the unowned count and the docker error", () => {
    const drawn = stacksView(viewContext(), { ...STACKS, error: 'no daemon' })
    expect(elements(drawn).flatMap(texts)).toEqual([
      '// STACKS UP [-]',
      '3',
      '· 2 unowned',
      '! docker: no daemon',
      'wt-1',
      'worker-1',
      'running(1)',
      'wt-2',
      'NO AGENT · 3 min',
      'running(2)',
      'wt-3',
      'NO AGENT',
      'exited(1)',
      'BRING DOWN WT-2…',
      'BRING DOWN WT-3…',
    ])
    expect(paint(drawing(drawn, '· 2 unowned')).text).toEqual(['magenta'])
    expect(paint(drawing(drawn, '! docker: no daemon')).text).toEqual(['red'])
    expect(paint(drawing(drawn, 'worker-1')).text).toEqual(['muted'])
    expect(paint(drawing(drawn, 'NO AGENT · 3 min')).text).toEqual(['magenta'])
    expect(paint(drawing(drawn, 'NO AGENT')).text).toEqual(['magenta'])
    // Every stack owned and docker answering: neither the unowned count nor an error.
    const owned = stacksView(viewContext(), {
      ...STACKS,
      count: '1',
      unowned: 0,
      rows: STACKS.rows.slice(0, 1),
    })
    expect(elements(owned).flatMap(texts)).toEqual([
      '// STACKS UP [-]',
      '1',
      'wt-1',
      'worker-1',
      'running(1)',
    ])
  })

  it('the stacks view offers Bring down only on a removable stack and confirms only the stack it names', () => {
    const cx = { name: 'cx' }
    const ctx = viewContext()
    const drawn = stacksView(ctx, STACKS)
    const offered = elements(drawn).filter((e) => said(e, 'on_click').length > 0)
    // The heading, and one button for each stack nothing owns.
    expect(offered.flatMap(texts)).toEqual([
      '// STACKS UP [-]',
      'BRING DOWN WT-2…',
      'BRING DOWN WT-3…',
    ])
    expect(paint(drawing(drawn, 'BRING DOWN WT-3…'))).toEqual({
      bg: [],
      text: ['fg'],
      border: ['fg'],
    })
    click(drawing(drawn, 'BRING DOWN WT-3…'), cx)
    expect(ctx.ui.askBringDown.mock.calls).toEqual([['wt-3', cx]])
    expect(elements(drawn).flatMap(texts)).not.toContain('CONFIRM')

    const ask = { kind: 'stack', target: 'wt-3', title: 'Bring down wt-3?', detail: 'removes it' }
    const asking = viewContext({ confirmation: ask })
    const asked = stacksView(asking, STACKS)
    // Once, after the button of the stack it names.
    expect(elements(asked).flatMap(texts).slice(-6)).toEqual([
      'BRING DOWN WT-2…',
      'BRING DOWN WT-3…',
      'Bring down wt-3?',
      'removes it',
      'CONFIRM',
      'CANCEL',
    ])
    expect(paint(drawing(asked, 'Bring down wt-3?')).text).toEqual(['red'])
    const [box] = elements(asked).filter((e) => said(e, 'bg').includes('surface2'))
    expect(paint(box as Element)).toEqual({ bg: ['surface2'], text: [], border: ['red'] })
    expect(paint(drawing(asked, 'CONFIRM'))).toEqual({
      bg: ['red'],
      text: ['btn-fg'],
      border: ['red'],
    })
    expect(paint(drawing(asked, 'CANCEL'))).toEqual({ bg: [], text: ['fg'], border: ['fg'] })
    click(drawing(asked, 'CONFIRM'), cx)
    expect(asking.ui.confirm.mock.calls).toEqual([[cx]])
    expect(asking.ui.cancel).not.toHaveBeenCalled()
    click(drawing(asked, 'CANCEL'), cx)
    expect(asking.ui.cancel.mock.calls).toEqual([[cx]])
    expect(asking.ui.confirm).toHaveBeenCalledTimes(1)

    // Another kind, a stack that is not there, and a stack that is not removable: no question.
    for (const other of [
      { ...ask, kind: 'process' },
      { ...ask, target: 'wt-9' },
      { ...ask, target: 'wt-1' },
    ]) {
      const quiet = stacksView(viewContext({ confirmation: other }), STACKS)
      expect(elements(quiet).flatMap(texts), `${other.kind} ${other.target}`).not.toContain(
        'CONFIRM'
      )
    }
  })

  it("a folded section draws only its heading, and the heading's click toggles it", () => {
    const cx = { name: 'cx' }
    const sections = [
      {
        name: 'stacks',
        view: stacksView,
        model: { ...STACKS, open: false, error: 'no daemon' },
        drawn: ['// STACKS UP [+]', '3', '· 2 unowned'],
        colour: 'cyan',
      },
      {
        name: 'orphans',
        view: orphansView,
        model: { ...ORPHANS, open: false, dim: true, note: 'not live' },
        drawn: ['// ORPHANS [+]', '[2]'],
        colour: 'red',
      },
    ]
    for (const { name, view, model, drawn, colour } of sections) {
      const ctx = viewContext()
      const folded = (view as (c: unknown, m: unknown) => unknown)(ctx, model)
      expect(elements(folded).flatMap(texts), name).toEqual(drawn)
      const title = drawing(folded, drawn[0] as string)
      expect(paint(title).text, name).toEqual([colour])
      const clickable = elements(folded).filter((e) => said(e, 'on_click').length > 0)
      expect(clickable, name).toHaveLength(1)
      expect(clickable[0], name).toBe(title)
      expect(ctx.ui.toggle).not.toHaveBeenCalled()
      click(title, cx)
      expect(ctx.ui.toggle.mock.calls, name).toEqual([[name, cx]])
    }
  })

  it('the orphans view shows and terminates its own pid and confirms only the process it names', () => {
    const cx = { name: 'cx' }
    /** The card of each orphan, in order. */
    const cards = (root: unknown) => elements(root).filter((e) => said(e, 'mt').includes(10))
    const ctx = viewContext()
    const drawn = orphansView(ctx, ORPHANS)
    expect(cards(drawn)).toHaveLength(2)
    const [, second] = cards(drawn)
    click(drawing(second, 'SHOW PROCESS'), cx)
    expect(ctx.ui.showProcess.mock.calls).toEqual([[22, cx]])
    expect(ctx.ui.askTerminate).not.toHaveBeenCalled()
    click(drawing(second, 'TERMINATE…'), cx)
    expect(ctx.ui.askTerminate.mock.calls).toEqual([[22, cx]])
    expect(paint(drawing(second, 'TERMINATE…'))).toEqual({
      bg: ['red'],
      text: ['btn-fg'],
      border: ['red'],
    })
    expect(elements(drawn).flatMap(texts)).not.toContain('CONFIRM')

    const ask = { kind: 'process', target: '22', title: 'Terminate pid 22?', detail: 'SIGTERM' }
    const asked = orphansView(viewContext({ confirmation: ask }), ORPHANS)
    const [one, two] = cards(asked)
    expect(elements(one).flatMap(texts)).not.toContain('CONFIRM')
    expect(elements(two).flatMap(texts).slice(-4)).toEqual([
      'Terminate pid 22?',
      'SIGTERM',
      'CONFIRM',
      'CANCEL',
    ])
    expect(paint(drawing(asked, 'Terminate pid 22?')).text).toEqual(['red'])

    // Another kind with the same target, and another pid: no question.
    for (const other of [
      { ...ask, kind: 'stack' },
      { ...ask, target: '33' },
    ]) {
      const quiet = orphansView(viewContext({ confirmation: other }), ORPHANS)
      expect(elements(quiet).flatMap(texts), `${other.kind} ${other.target}`).not.toContain(
        'CONFIRM'
      )
    }
  })

  it('a section whose source is not live draws its note and dims its rows', () => {
    const note = 'as of 16:00 UTC · not live'
    const dimmed = (root: unknown) => elements(root).filter((e) => said(e, 'opacity').length > 0)
    const stale = orphansView(viewContext(), { ...ORPHANS, dim: true, note })
    expect(paint(drawing(stale, `! ${note}`)).text).toEqual(['red'])
    const [rows, ...rest] = dimmed(stale)
    expect(rest).toEqual([])
    expect(said(rows as Element, 'opacity')).toEqual([0.6])
    const inside = elements(rows).flatMap(texts)
    expect(inside).toContain('sleep · repo of 11')
    expect(inside).toContain('sleep · repo of 22')
    // The heading and the note stay at full strength.
    expect(inside).not.toContain('// ORPHANS [-]')
    expect(inside).not.toContain(`! ${note}`)

    const live = orphansView(viewContext(), ORPHANS)
    expect(dimmed(live)).toEqual([])
    expect(
      elements(live)
        .flatMap(texts)
        .filter((t) => t.startsWith('!'))
    ).toEqual([])
    expect(elements(live).flatMap(texts)).toContain('sleep · repo of 11')
  })

  it('a badge, a lane tag and a gate mark draw each kind with its colours, and glow only in the dark theme', () => {
    const ctx = viewContext()
    const small = badge(ctx, 'M', 'space-m') as unknown as Element
    expect(texts(small)).toEqual(['M'])
    expect([said(small, 'w'), said(small, 'h')]).toEqual([[16], [16]])
    expect(paint(small)).toEqual({ bg: ['space-m'], text: ['badge-fg'], border: [] })
    const large = badge(ctx, 'F', 'space-f', 24) as unknown as Element
    expect([said(large, 'w'), said(large, 'h')]).toEqual([[24], [24]])
    expect(paint(badge(ctx, 'X', 'no-such-token') as unknown as Element)).toEqual({
      bg: ['muted'],
      text: ['badge-fg'],
      border: [],
    })
    expect(paint(badge(ctx, '!', 'warn-fill') as unknown as Element)).toEqual({
      bg: ['warn-fill'],
      text: ['warn-fg'],
      border: [],
    })

    const lanes = {
      FULL: { bg: ['fg'], text: ['bg'], border: ['fg'], dashed: false },
      EXPRESS: { bg: [], text: ['muted'], border: ['muted'], dashed: true },
      NORMAL: { bg: [], text: ['fg'], border: ['fg'], dashed: false },
    }
    for (const [lane, { dashed, ...colours }] of Object.entries(lanes)) {
      const tag = laneTag(ctx, lane) as unknown as Element
      expect(texts(tag), lane).toEqual([lane])
      expect(paint(tag), lane).toEqual(colours)
      expect(said(tag, 'border_dashed').length > 0, lane).toBe(dashed)
    }

    const flat = {
      passed: { bg: ['cyan-dim'], text: [], border: [], dashed: false },
      held: { bg: ['warn-fill'], text: [], border: ['fg'], dashed: false },
      red: { bg: ['red-bg'], text: [], border: ['red'], dashed: false },
      omitted: { bg: [], text: [], border: ['muted'], dashed: true },
      notReached: { bg: ['track'], text: [], border: [], dashed: false },
    }
    for (const dark of [true, false]) {
      for (const [mark, { dashed, ...colours }] of Object.entries(flat)) {
        const box = gateMark(viewContext({ dark }), mark) as unknown as Element
        expect(paint(box), mark).toEqual(colours)
        expect(said(box, 'border_dashed').length > 0, mark).toBe(dashed)
        expect(images(box), mark).toEqual([])
      }
    }
    for (const [mark, colour] of [
      ['running', 'cyan'],
      ['needs', 'magenta'],
    ] as const) {
      const glowing = gateMark(viewContext(), mark)
      expect(images(glowing), mark).toEqual([`mods/factory/glow-${colour}.svg`])
      expect(
        elements(glowing).flatMap((e) => said(e, 'bg')),
        mark
      ).toEqual([colour])
      const light = gateMark(viewContext({ dark: false }), mark) as unknown as Element
      expect(images(light), mark).toEqual([])
      expect(paint(light), mark).toEqual({ bg: [colour], text: [], border: [] })
    }
  })

  it('a cat glows only when it works or needs the maintainer, in the dark theme', () => {
    const file = 'worker-working-head-dark.svg'
    const picture = `mods/factory/cats/${file}`
    const drawn = (dark: boolean, state: string) =>
      images(cat(viewContext({ dark }), file, 24, state))
    expect(drawn(true, 'working')).toEqual(['mods/factory/glow-cyan.svg', picture])
    expect(drawn(true, 'needs')).toEqual(['mods/factory/glow-magenta.svg', picture])
    for (const state of ['idle', 'held', 'red'])
      expect(drawn(true, state), state).toEqual([picture])
    for (const state of ['working', 'needs', 'idle', 'held', 'red'])
      expect(drawn(false, state), state).toEqual([picture])
    // No file: an empty box of the same size, so the row does not move.
    for (const none of [null, undefined]) {
      const box = cat(viewContext(), none, 24, 'working') as unknown as Element
      expect(images(box)).toEqual([])
      expect([said(box, 'w'), said(box, 'h')]).toEqual([[24], [24]])
    }
  })

  it('a disabled button is flat, has no click and shows its tip or the locked note', () => {
    const ctx = viewContext()
    const press = vi.fn()
    const options = { disabled: true, primary: true, click: press }
    const tipped = button(ctx, 'go', 'GO', {
      ...options,
      tip: 'no free slot',
    }) as unknown as Element
    const locked = button(ctx, 'stop', 'STOP', options) as unknown as Element
    expect(said(tipped, 'tooltip')).toEqual(['no free slot'])
    expect(said(locked, 'tooltip')).toEqual(['locked while no master answers'])
    for (const [text, el] of [
      ['GO', tipped],
      ['STOP', locked],
    ] as const) {
      expect(texts(el)).toEqual([text])
      expect(paint(el), text).toEqual({ bg: ['track'], text: ['muted'], border: ['track'] })
      expect(said(el, 'on_click'), text).toEqual([])
      expect(said(el, 'cursor_pointer'), text).toEqual([])
    }
    expect(press).not.toHaveBeenCalled()
  })
})

describe('the banner of the spaces', () => {
  const NOW = Date.parse('2026-11-26T12:00:00Z')
  const MICELIO = 'bogd3v/micelio'
  const CORE = 'bogd3v/micelio-plugin-core'
  const recorded = (name: string): unknown =>
    JSON.parse(readFileSync(join(ROOT, FIXTURES, 'spaces-check', name), 'utf8'))
  const milestonesOf = (repo: string) => `repos/${repo}/milestones?state=all&per_page=100`
  const epicOf = (repo: string, n: number) => `repos/${repo}/issues/${n}`
  const ANSWERS: Record<string, unknown> = {
    [milestonesOf(MICELIO)]: recorded('milestones-micelio.json'),
    [milestonesOf(CORE)]: recorded('milestones-micelio-pc.json'),
    [epicOf(MICELIO, 62)]: recorded('epic-micelio.json'),
    [epicOf(CORE, 62)]: recorded('epic-micelio-plugin-core-62.json'),
  }
  /** The first entry of the `spaces` installed on 2026-11-26, and the one that followed it. */
  const WRONG = { name: 'micelio', repo: MICELIO, milestone: 15, epic: 62 }
  const FOLLOWING = { name: 'micelio', repo: CORE, milestone: 4, epic: 62, tag: 'pc' }

  /**
   * One round of the panel over a `gh` that answers the endpoints of `answers`, and fails the others as
   * `gh api --include` does for a 404.
   */
  async function check(spaces: unknown[], answers: Record<string, unknown> = ANSWERS) {
    const config = readConfig({ ...props(null), spaces })
    const calls: string[] = []
    const a = createAdapters({
      exec: async (_cmd: string, args: string[]) => {
        const endpoint = String(args[1])
        calls.push(endpoint)
        return endpoint in answers
          ? {
              code: 0,
              stdout: `HTTP/2.0 200 OK\r\n\r\n${JSON.stringify(answers[endpoint])}`,
              stderr: '',
            }
          : {
              code: 1,
              stdout: 'HTTP/2.0 404 Not Found\r\n\r\n{"message":"Not Found"}',
              stderr: 'gh: Not Found (HTTP 404)\n',
            }
      },
      readTextFile,
      terminals: () => [],
      config,
      clock: () => NOW,
    })
    const read = await a.readMilestones(config.spaces)
    const epics = await readEpics(a, config.spaces, {
      sleep: () => new Promise<never>(() => {}),
      now: NOW,
      remote: true,
      previous: {},
    })
    const panel = buildPanel({
      now: NOW,
      state: buildState({ now: NOW, fetched: {} }),
      github: null,
      config,
      milestones: 'byRepo' in read ? read.byRepo : null,
      epics,
    })
    return { panel, calls }
  }
  const lines = async (spaces: unknown[], answers?: Record<string, unknown>) =>
    (await check(spaces, answers)).panel.banners.spaces

  it('a pair whose milestone is closed puts its line in the spaces banner', async () => {
    const open = { name: 'micelio', repo: MICELIO, milestone: 18 }
    expect(await lines([open])).toBeNull()
    // Every pair is checked, the tagged one too.
    const { panel } = await check([
      { ...open, milestone: 15 },
      { name: 'micelio', repo: CORE, milestone: 3, tag: 'pc' },
    ])
    expect(panel.banners.spaces).toEqual([
      `micelio: milestone 15 of ${MICELIO} is closed`,
      `micelio: milestone 3 of ${CORE} is closed`,
    ])
    const drawn = bannersView(viewContext(), panel.banners)
    expect(drawn).toHaveLength(1)
    expect(elements(drawn[0]).flatMap(texts)).toEqual(panel.banners.spaces)
    const box = drawn[0] as unknown as Element
    expect(said(box, 'border_color')).toEqual(['red'])
    expect(said(box, 'bg')).toEqual(['red-bg'])
  })

  it('a pair whose milestone its repository does not have puts its line in the spaces banner', async () => {
    expect(await lines([{ name: 'micelio', repo: MICELIO, milestone: 99 }])).toEqual([
      `micelio: ${MICELIO} has no milestone 99`,
    ])
  })

  it('a first pair whose epic is a pull request, a closed issue or an issue that is not an epic puts its line in the spaces banner', async () => {
    const issue = { state: 'open', title: 'Something', labels: [] as { name: string }[] }
    const pr = { pull_request: { url: 'https://example.com/pulls/7' } }
    const of = (epic: unknown) =>
      lines([{ name: 'micelio', repo: MICELIO, milestone: 18, epic: 7 }], {
        ...ANSWERS,
        [epicOf(MICELIO, 7)]: epic,
      })
    const line = [`micelio: #7 of ${MICELIO} is not an open epic`]
    // An open pull request that is titled and labelled as an epic is still not one.
    expect(await of({ ...issue, ...pr, title: 'Epic: x', labels: [{ name: 'épica' }] })).toEqual(
      line
    )
    expect(await of({ ...issue, state: 'closed', title: 'Epic: x' })).toEqual(line)
    expect(await of({ ...issue, labels: [{ name: 'micelio' }] })).toEqual(line)
    // The title or the label alone makes an open issue an epic.
    expect(await of({ ...issue, title: 'Epic: x' })).toBeNull()
    expect(await of({ ...issue, labels: [{ name: 'épica' }] })).toBeNull()
  })

  it('the installed spaces of 2026-11-26 give the lines of milestone 15 and of #62 of bogd3v/micelio, and the fixed ones give no banner', async () => {
    expect(await lines([WRONG, FOLLOWING])).toEqual([
      `micelio: milestone 15 of ${MICELIO} is closed`,
      `micelio: #62 of ${MICELIO} is not an open epic`,
    ])
    const fixed = await check([FOLLOWING])
    expect(fixed.panel.banners.spaces).toBeNull()
    expect(fixed.calls).toContain(epicOf(CORE, 62))
    expect(bannersView(viewContext(), fixed.panel.banners)).toEqual([])
  })

  it('the epic of a tagged pair is not checked', async () => {
    // `#62` of bogd3v/micelio, a pull request, as the epic of a tagged pair.
    const first = { name: 'micelio', repo: CORE, milestone: 4, epic: 62 }
    const tagged = { name: 'micelio', repo: MICELIO, milestone: 18, epic: 62, tag: 'm' }
    const { panel, calls } = await check([first, tagged])
    expect(panel.banners.spaces).toBeNull()
    expect(calls).not.toContain(epicOf(MICELIO, 62))
    // A first pair with no epic: the tagged pair's is not asked for in its place.
    const none = await check([{ ...first, epic: null }, tagged])
    expect(none.panel.banners.spaces).toBeNull()
    expect(none.calls.filter((c) => c.includes('/issues/'))).toEqual([])
  })

  it('a failed read of the milestones or of an epic gives no line', async () => {
    const noMilestones = await check([WRONG], {
      [epicOf(MICELIO, 62)]: ANSWERS[epicOf(MICELIO, 62)],
    })
    expect(noMilestones.panel.banners.spaces).toEqual([
      `micelio: #62 of ${MICELIO} is not an open epic`,
    ])
    const noEpic = await check([WRONG], {
      [milestonesOf(MICELIO)]: ANSWERS[milestonesOf(MICELIO)],
    })
    expect(noEpic.panel.banners.spaces).toEqual([`micelio: milestone 15 of ${MICELIO} is closed`])
    const neither = await check([WRONG], {})
    expect(neither.calls).toHaveLength(2)
    expect(neither.panel.banners.spaces).toBeNull()
  })
})
