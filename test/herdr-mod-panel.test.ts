import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
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
import { buildState } from '../herdr/mod/factory/lib/state.js'
// @ts-expect-error a plain JavaScript module of the mod, with no declarations
import { THEMES } from '../herdr/mod/factory/lib/tokens.js'

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
        if (cmd === 'gh' && String(args[1]).includes('/comments'))
          return { code: 0, stdout: '[]', stderr: '' }
        if (cmd === 'gh') {
          return {
            code: 0,
            stdout: JSON.stringify([{ number: 5, title: 't', state: 'open', body: null }]),
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
      expect(args).toHaveLength(2)
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
        if (cmd === 'gh') return { code: 0, stdout: '[]', stderr: '' }
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
    })
  })
})
