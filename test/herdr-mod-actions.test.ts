import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createAdapters, oldestCreated, readConfig } from '../herdr/mod/factory/adapters.js'
import {
  armedNote,
  createActions,
  createRetries,
  retryLabel,
  retryThreshold,
  stackOwned,
} from '../herdr/mod/factory/lib/actions.js'
import { buildNeeds, parseHeld } from '../herdr/mod/factory/lib/needs.js'
import { buildGithub, buildPanel } from '../herdr/mod/factory/lib/panel.js'
import { parseAgents } from '../herdr/mod/factory/lib/agents.js'
import { buildState } from '../herdr/mod/factory/lib/state.js'

const ROOT = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '')
const SCRIPT = `${ROOT}/herdr/factory-slot.sh`
const DOCKER_HOST = 'unix:///run/user/1000/podman/podman.sock'
const NOW = Date.parse('2026-11-24T16:00:00Z')
const MIN = 60_000
const ME = 'ale9420'
const config = { checkout: ROOT, dockerHost: DOCKER_HOST }

type Call = [string, string[]]
interface Run {
  code: number
  stdout: string
  stderr: string
}
/** An `exec` that records its calls and answers with `answer`. */
function recorder(answer: (cmd: string, args: string[]) => Partial<Run> = () => ({})) {
  const calls: Call[] = []
  const exec = async (cmd: string, args: string[]): Promise<Run> => {
    calls.push([cmd, args])
    return { code: 0, stdout: '', stderr: '', ...answer(cmd, args) }
  }
  return { calls, exec }
}

const status = (lines: string[]) => lines.join('\n') + '\n'
const AT = new Date(NOW).toISOString()
const MACHINE = {
  at: AT,
  loadavg: '0.70 0.83 1.05 1/2073 1\n',
  meminfo: 'MemTotal: 1 kB\nMemAvailable: 1 kB\n',
  hwmon: [],
  cores: 32,
}
const stateOf = (text: string) =>
  buildState({ now: NOW, fetched: { slots: { at: AT, text }, machine: MACHINE } })
const panelOf = (text: string, extra: Record<string, unknown> = {}) =>
  buildPanel({
    now: NOW,
    state: stateOf(text),
    github: null,
    config: { spaces: [] },
    ...extra,
  })

const worker = (issue: number) => ({
  address: `t${issue}`,
  name: `worker-${issue}`,
  parent: null,
  status: 'working',
  foreground: { argv: ['claude'] },
  labels: {},
})
const STATUS = status([
  'heavy\t1\tworker-801\t10\t2026-11-24T10:32:35-0500\tsleep 600\talive',
  'workers\tworker-788\tworker-788\t-\t2026-11-24T10:32:35-0500\t-\t-',
  'orphan\t4242\t/srv/factory/tmp/r4-late\tvitest run ',
])
/** The facts of the panel: worker-792 is live, worker-788 has a lease, wt-760 and wt-160 have none. */
const facts = () => ({
  agents: parseAgents([worker(792)]),
  leases: [{ agent: 'worker-788' }],
  orphans: [{ pid: 4242, cwd: '/srv/factory/tmp/r4-late', command: 'vitest run' }],
  stacks: ['wt-792', 'wt-788', 'wt-760', 'wt-160'].map((name) => ({ name })),
})

describe('the header buttons', () => {
  it('pause and resume call the slot script, and the header shows the paused line while status says paused', async () => {
    const { calls, exec } = recorder()
    const actions = createActions({ exec, config, facts })
    expect((await actions.pause()).ok).toBe(true)
    expect((await actions.resume()).ok).toBe(true)
    expect(calls).toEqual([
      ['bash', [SCRIPT, 'pause']],
      ['bash', [SCRIPT, 'resume']],
    ])
    const running = panelOf(STATUS)
    expect(running.header.pause).toEqual({ on: false, label: 'Pause new workers' })
    expect(running.banners.paused).toBeNull()
    const paused = panelOf('paused\n' + STATUS)
    expect(paused.header.pause).toEqual({ on: true, label: 'Resume workers' })
    expect(paused.banners.paused).toBe(
      'paused: masters start no new worker. Running agents and gates continue.'
    )
  })

  it('a hold that exits 75 shows no free slot and holds nothing', async () => {
    const { calls, exec } = recorder(() => ({ code: 75 }))
    const actions = createActions({ exec, config, facts })
    const held = await actions.reserve()
    expect(held).toMatchObject({ ok: false, code: 75, note: 'no free slot' })
    expect(calls).toEqual([['bash', [SCRIPT, 'hold', '--agent', 'maintainer']]])
    // Status shows no hold, so the button still offers to reserve.
    expect(panelOf(STATUS).header.reserve).toEqual({ on: false, label: 'Reserve a slot' })
    // Another failure is not "no free slot".
    const broken = createActions({
      exec: recorder(() => ({ code: 2, stderr: 'usage\n' })).exec,
      config,
      facts,
    })
    expect(await broken.reserve()).toMatchObject({ ok: false, note: 'usage' })
  })

  it('a reserved slot shows Release my slot, and releasing calls the slot script', async () => {
    const reserved = status([
      'heavy\t3\tmaintainer\t-\t2026-11-24T10:32:45-0500\thold\theld',
      'heavy\t1\tworker-801\t10\t2026-11-24T10:32:35-0500\tsleep 600\talive',
    ])
    expect(panelOf(reserved).header.reserve).toEqual({ on: true, label: 'Release my slot' })
    const { calls, exec } = recorder()
    await createActions({ exec, config, facts }).release()
    expect(calls).toEqual([['bash', [SCRIPT, 'release', '--agent', 'maintainer']]])
  })
})

/** The comments of an issue held at G4. */
const heldComments = (extra: { body: string; minutesAgo: number }[] = []) =>
  [
    {
      body: 'held | 2026-11-24 | #393 | G4 | 6 runs failed on hook timeouts at load 81',
      minutesAgo: 6,
    },
    ...extra,
  ].map((c, id) => ({
    user: { login: ME },
    body: c.body,
    created_at: new Date(NOW - c.minutesAgo * MIN).toISOString(),
    id: id + 1,
  }))

/** The cards of "Needs you" for one issue, #393, with a master in its space. */
function needsFor(comments: ReturnType<typeof heldComments>, armed: Record<string, boolean> = {}) {
  const github = buildGithub({
    now: NOW,
    spaces: [{ name: 'micelio', repo: 'bogd3v/micelio-engineering', milestone: 1 }],
    reads: {
      micelio: {
        at: AT,
        issues: [{ number: 393, title: 'a title', state: 'open', body: null, created_at: AT }],
        comments: { 393: comments },
        maintainer: ME,
      },
    },
  })
  const agents = parseAgents([
    {
      address: 'tm',
      name: null,
      parent: null,
      status: 'idle',
      foreground: { argv: ['claude', '--agent', 'master'] },
      labels: { 'herdr.space': 'sp-1', where: 'micelio / 1' },
    },
  ])
  return buildNeeds({
    now: NOW,
    config: { spaces: [{ name: 'micelio', repo: 'bogd3v/micelio-engineering', milestone: 1 }] },
    github,
    agents,
    armed,
    cores: 32,
  })
}

describe('a held check', () => {
  it('an armed retry sends retry #N once, when the load falls under three quarters of the cores', () => {
    const sent: [string, string][] = []
    const retries = createRetries({
      send: (target: string, text: string) => sent.push([target, text]),
    })
    // Not armed: nothing is sent, whatever the load.
    expect(retries.check(1, 32)).toEqual([])
    retries.arm('held:micelio#393', 393, 'tm')
    // At three quarters of 32 cores (24) and above, and with no reading: it waits.
    for (const load of [81, 30, 24, null]) expect(retries.check(load, 32)).toEqual([])
    expect(sent).toEqual([])
    expect(retries.check(23.9, 32)).toEqual(['retry #393'])
    // Once per arming: the next readings send nothing.
    expect(retries.check(5, 32)).toEqual([])
    expect(sent).toEqual([['tm', 'retry #393']])
    // The threshold follows the core count, it is not 24.
    retries.arm('held:micelio#393', 393, 'tm')
    expect(retries.check(5, 8)).toEqual(['retry #393'])
    retries.arm('held:micelio#393', 393, 'tm')
    expect(retries.check(6, 8)).toEqual([])
    expect(retries.check(5.9, 8)).toEqual(['retry #393'])
    expect(sent).toHaveLength(3)
    // A cancelled retry is not sent.
    retries.arm('held:micelio#393', 393, 'tm')
    retries.cancel('held:micelio#393')
    expect(retries.check(1, 32)).toEqual([])
    expect(sent).toHaveLength(3)
    // A card that is gone cancels its retry.
    retries.arm('held:micelio#393', 393, 'tm')
    retries.keep(new Set())
    expect(retries.check(1, 32)).toEqual([])
  })

  it('an armed retry of an issue of another repository sends retry owner/repo#N once', () => {
    const spaces = readConfig({
      spaces: [
        { name: 'micelio', repo: 'bogd3v/micelio', milestone: 18 },
        { name: 'micelio', repo: 'bogd3v/micelio-cms', milestone: 12, tag: 'c' },
      ],
    }).spaces
    const held = (line: string) => [
      { user: { login: ME }, body: line, created_at: new Date(NOW - 6 * MIN).toISOString(), id: 1 },
    ]
    const github = buildGithub({
      now: NOW,
      spaces,
      reads: {
        micelio: {
          at: AT,
          issues: [{ number: 531, title: 'own', state: 'open', body: null, created_at: AT }],
          comments: {},
          maintainer: ME,
          others: [
            {
              issues: [{ number: 531, title: 'cms', state: 'open', body: null, created_at: AT }],
              comments: {
                531: held('held | 2026-11-24 | bogd3v/micelio-cms#531 | G2 | timeouts at load 81'),
              },
            },
          ],
        },
      },
    })
    const agents = parseAgents([
      {
        address: 'tm',
        name: null,
        parent: null,
        status: 'idle',
        foreground: { argv: ['claude', '--agent', 'master'] },
        labels: { 'herdr.space': 'sp-1', where: 'micelio / 1' },
      },
    ])
    const { cards } = buildNeeds({ now: NOW, config: { spaces }, github, agents, cores: 32 })
    // Only the issue of the other repository is held; #531 of the space's repository is not.
    expect(cards).toHaveLength(1)
    const [card] = cards
    expect(card).toMatchObject({
      kind: 'held',
      key: 'held:micelio bogd3v/micelio-cms#531',
      head: 'micelio bogd3v/micelio-cms#531 · G2 · HELD',
      ref: 'bogd3v/micelio-cms#531',
      master: 'tm',
    })
    const sent: [string, string][] = []
    const retries = createRetries({
      send: (target: string, text: string) => sent.push([target, text]),
    })
    retries.arm(card!.key, card!.ref!, card!.master!)
    expect(retries.check(30, 32)).toEqual([])
    expect(retries.check(5, 32)).toEqual(['retry bogd3v/micelio-cms#531'])
    expect(retries.check(5, 32)).toEqual([])
    expect(sent).toEqual([['tm', 'retry bogd3v/micelio-cms#531']])
  })

  it('shows its reason and the button that arms it, with the threshold of the machine', () => {
    const { cards } = needsFor(heldComments())
    expect(cards).toHaveLength(1)
    expect(cards[0]).toMatchObject({
      kind: 'held',
      key: 'held:micelio#393',
      master: 'tm',
      head: 'micelio#393 · G4 · HELD',
      text: '6 runs failed on hook timeouts at load 81',
      armed: false,
      retryLabel: 'Retry when load < 24',
      armedNote: null,
    })
    const armed = needsFor(heldComments(), { 'held:micelio#393': true }).cards[0]
    expect(armed).toMatchObject({
      armed: true,
      retryLabel: 'Armed · cancel',
      armedNote: 'armed: the master reruns it once, in a slot, when the load is under 24.',
    })
    expect(retryThreshold(6)).toBe('4.5')
    expect(retryLabel(6, false)).toBe('Retry when load < 4.5')
    // No core count: no number is named, and nothing is sent.
    expect(retryLabel(0, false)).toBe('Retry when load falls')
    expect(armedNote(0)).toBe('armed: the master reruns it once, in a slot, when the load falls.')
  })

  it('is held until a later comment of its gate reports the rerun, and only for its own issue', () => {
    const rerun = { body: '**Gate 4, round 2 (verifier-393)** · 0 mismatches', minutesAgo: 1 }
    expect(parseHeld(heldComments([rerun]), ME, 393)).toBeNull()
    const other = { body: '**Gate 2, round 2 (worker-393)** · pass', minutesAgo: 1 }
    expect(parseHeld(heldComments([other]), ME, 393)).toMatchObject({ gate: 4 })
    expect(parseHeld(heldComments(), ME, 394)).toBeNull()
    expect(parseHeld(heldComments(), 'someone-else', 393)).toBeNull()
    expect(needsFor(heldComments([rerun])).cards).toEqual([])
  })
})

describe('the stacks', () => {
  it('a stack owned by a live agent or a lease offers no removal', async () => {
    expect(stackOwned('wt-792', facts().agents, facts().leases)).toBe(true)
    expect(stackOwned('wt-788', facts().agents, facts().leases)).toBe(true)
    expect(stackOwned('wt-760', facts().agents, facts().leases)).toBe(false)
    const stacks = ['wt-792', 'wt-788', 'wt-760'].map((name) => ({ name, status: 'running(1)' }))
    const rows = panelOf(STATUS, {
      stacks: { value: stacks, at: null, stale: false, error: null },
      state: buildState({
        now: NOW,
        fetched: {
          slots: { at: AT, text: STATUS },
          machine: MACHINE,
          agents: { at: AT, terminals: [worker(792)] },
        },
      }),
      stackAges: { 'wt-760': NOW - 3 * 60 * MIN },
    }).sections.stacks.rows
    expect(rows.map((r: { name: string; removable: boolean }) => [r.name, r.removable])).toEqual([
      ['wt-792', false],
      ['wt-788', false],
      ['wt-760', true],
    ])
    expect(rows.map((r: { age: string | null }) => r.age)).toEqual([null, null, '3 h'])
    // Asking for the removal of an owned stack is refused, and nothing runs.
    const { calls, exec } = recorder()
    const actions = createActions({ exec, config, facts })
    for (const name of ['wt-792', 'wt-788', 'wt-999']) {
      expect(actions.askBringDown(name).ok).toBe(false)
      expect(actions.pending()).toBeNull()
    }
    expect(calls).toEqual([])
  })

  it('no removal runs before its confirmation, and the confirmation names the project or the process', async () => {
    const { calls, exec } = recorder()
    const actions = createActions({ exec, config, facts })
    expect(actions.askBringDown('wt-760')).toEqual({ ok: true, note: null })
    expect(actions.pending()).toMatchObject({ kind: 'stack', target: 'wt-760' })
    expect(actions.pending()?.title).toContain('wt-760')
    expect(calls).toEqual([])
    actions.cancel()
    expect(actions.pending()).toBeNull()
    expect(await actions.confirm()).toEqual({ ok: false, note: 'nothing to confirm' })
    expect(calls).toEqual([])

    expect(actions.askTerminate(4242).ok).toBe(true)
    expect(actions.pending()?.title).toContain('4242')
    expect(actions.pending()?.title).toContain('vitest')
    expect(calls).toEqual([])
    actions.cancel()
    expect(calls).toEqual([])

    // A process that is no longer an orphan cannot be asked for.
    expect(actions.askTerminate(1)).toEqual({ ok: false, note: 'pid 1 is no longer an orphan' })

    // Confirming after the stack got an owner runs nothing.
    let owned = false
    const moving = createActions({
      exec,
      config,
      facts: () => ({ ...facts(), agents: owned ? parseAgents([worker(760)]) : [] }),
    })
    moving.askBringDown('wt-760')
    owned = true
    expect(await moving.confirm()).toEqual({
      ok: false,
      note: 'wt-760 has a live agent or a lease',
    })
    expect(calls).toEqual([])
  })

  it('bringing a stack down runs docker -H <dockerHost> compose -p <project> down -v', async () => {
    const { calls, exec } = recorder()
    const actions = createActions({ exec, config, facts })
    actions.askBringDown('wt-760')
    expect(await actions.confirm()).toEqual({ ok: true, note: 'wt-760 is down' })
    expect(calls).toEqual([
      ['docker', ['-H', DOCKER_HOST, 'compose', '-p', 'wt-760', 'down', '-v']],
    ])
    // A layout with no dockerHost runs it with no -H, as every docker call does.
    const bare = recorder()
    const none = createActions({
      exec: bare.exec,
      config: { checkout: ROOT, dockerHost: '' },
      facts,
    })
    none.askBringDown('wt-160')
    await none.confirm()
    expect(bare.calls).toEqual([['docker', ['compose', '-p', 'wt-160', 'down', '-v']]])
    // A failure is said, not hidden.
    const failing = createActions({
      exec: recorder(() => ({ code: 1, stderr: 'permission denied\n' })).exec,
      config,
      facts,
    })
    failing.askBringDown('wt-760')
    expect(await failing.confirm()).toEqual({ ok: false, note: 'permission denied' })
  })
})

describe('the orphans', () => {
  it('ends the process group of an orphan only after the confirmation', async () => {
    const { calls, exec } = recorder()
    const actions = createActions({ exec, config, facts })
    actions.askTerminate(4242)
    expect(calls).toEqual([])
    expect(await actions.confirm()).toEqual({ ok: true, note: 'pid 4242 ended' })
    expect(calls).toHaveLength(1)
    const [call] = calls
    if (!call) throw new Error('no command ran')
    const [cmd, args] = call
    expect(cmd).toBe('sh')
    expect(args[1]).toContain('kill -TERM -- "-$pg"')
    expect(args.at(-1)).toBe('4242')
  })

  it('confirming Terminate runs nothing when the pid left the orphans after it was asked', async () => {
    const { calls, exec } = recorder()
    let left = false
    const actions = createActions({
      exec,
      config,
      facts: () => ({ ...facts(), orphans: left ? [] : facts().orphans }),
    })
    expect(actions.askTerminate(4242).ok).toBe(true)
    left = true
    expect(await actions.confirm()).toEqual({ ok: false, note: 'pid 4242 is no longer an orphan' })
    expect(calls).toEqual([])
  })

  it("Show process reads the process's cores and age with ps, and a fixture reads its file", async () => {
    const { calls, exec } = recorder(() => ({ stdout: '  2820  1000.0\n' }))
    const adapters = createAdapters({
      exec,
      readTextFile: async () => null,
      terminals: () => [],
      config: readConfig({ checkout: ROOT, dockerHost: DOCKER_HOST }),
    })
    expect(await adapters.readProcess(4242)).toEqual({ cores: 10, ageMs: 2_820_000 })
    expect(calls).toEqual([['ps', ['-o', 'etimes=,pcpu=', '-p', '4242']]])
    const gone = createAdapters({
      exec: recorder(() => ({ code: 1, stdout: '' })).exec,
      readTextFile: async () => null,
      terminals: () => [],
      config: readConfig({}),
    })
    expect(await gone.readProcess(1)).toBeNull()
    const fixture = createAdapters({
      exec: recorder().exec,
      readTextFile: async (path: string) =>
        path.endsWith('/process-4242.json') ? '{"cores":10,"minutes":47}' : null,
      terminals: () => [],
      config: readConfig({ checkout: ROOT, fixture: ['x'] }),
    })
    expect(await fixture.readProcess(4242)).toEqual({ cores: 10, ageMs: 47 * MIN })
  })

  it("a stack's age is read from its oldest container, through dockerArgs", async () => {
    expect(
      oldestCreated(
        '2026-11-24 10:32:45 -0500 EST\n2026-11-24 09:00:00.123456 +0000 UTC\nnot a date\n'
      )
    ).toBe(Date.parse('2026-11-24T09:00:00.123456+00:00'))
    expect(oldestCreated('')).toBeNull()
    const { calls, exec } = recorder(() => ({ stdout: '2026-11-24 13:00:00 +0000 UTC\n' }))
    const adapters = createAdapters({
      exec,
      readTextFile: async () => null,
      terminals: () => [],
      config: readConfig({ checkout: ROOT, dockerHost: DOCKER_HOST }),
    })
    expect(await adapters.readStackAge('wt-160')).toBe(Date.parse('2026-11-24T13:00:00Z'))
    expect(calls).toEqual([
      [
        'docker',
        [
          '-H',
          DOCKER_HOST,
          'ps',
          '-a',
          '--filter',
          'label=com.docker.compose.project=wt-160',
          '--format',
          '{{.CreatedAt}}',
        ],
      ],
    ])
  })
})

describe('the views', () => {
  it('call the machine through ctx.ui and name no program', () => {
    for (const f of ['header', 'stacks', 'orphans', 'needs']) {
      const text = readFileSync(join(ROOT, 'herdr/mod/factory/views', `${f}.js`), 'utf8')
      expect(text).not.toMatch(/\b(hc|run|exec|docker|kill)\(/)
    }
  })
})

describe('a panel that reads recordings', () => {
  it('runs no action and sends no retry, whatever a click asks for', async () => {
    const { calls, exec } = recorder()
    const actions = createActions({ exec, config, facts, disabled: true })
    const note = 'Fixture: nothing was run.'
    expect(await actions.pause()).toMatchObject({ ok: false, note })
    expect(await actions.resume()).toMatchObject({ ok: false, note })
    expect(await actions.reserve()).toMatchObject({ ok: false, note })
    expect(await actions.release()).toMatchObject({ ok: false, note })
    expect(actions.askBringDown('wt-760').ok).toBe(true)
    expect(await actions.confirm()).toEqual({ ok: false, note })
    expect(actions.askTerminate(4242).ok).toBe(true)
    expect(await actions.confirm()).toEqual({ ok: false, note })
    expect(actions.pending()).toBeNull()
    expect(calls).toEqual([])
    const sent: string[] = []
    const retries = createRetries({
      send: (_t: string, text: string) => sent.push(text),
      disabled: true,
    })
    retries.arm('held:micelio#393', 393, 'tm')
    expect(retries.check(1, 32)).toEqual([])
    expect(sent).toEqual([])
    // It stays armed, so the panel can show the armed state.
    expect(retries.isArmed('held:micelio#393')).toBe(true)
  })

  it('the fixture of the actions holds the paused state, a held check, an unowned stack and an orphan', async () => {
    const folder = join(ROOT, 'test/fixtures/herdr-mod/actions')
    const read = (name: string) => readFileSync(join(folder, name), 'utf8')
    const slots = read('status.txt')
    expect(slots.split('\n')[0]).toBe('paused')
    expect(slots).toContain('\thold\theld')
    expect(slots).toMatch(/^orphan\t4242\t/m)
    const comments = JSON.parse(read('comments-393.json')) as Parameters<typeof parseHeld>[0]
    expect(parseHeld(comments, ME, 393)).toMatchObject({ gate: 4 })
    const stacks = (JSON.parse(read('docker-compose-ls.json')) as { Name: string }[]).map(
      (s) => s.Name
    )
    const agents = parseAgents(
      JSON.parse(read('terminals.json')) as Parameters<typeof parseAgents>[0]
    )
    const leases = [...slots.matchAll(/^workers\t(\S+)/gm)].map((m) => ({ agent: m[1]! }))
    expect(stacks.filter((n: string) => !stackOwned(n, agents, leases))).toEqual(['wt-160'])
    // Read as the panel reads it, with no program run.
    const a = createAdapters({
      exec: async () => Promise.reject(new Error('a fixture runs no program')),
      readTextFile: async (path: string) => {
        try {
          return readFileSync(path, 'utf8')
        } catch {
          return null
        }
      },
      terminals: () => [],
      config: readConfig({ checkout: ROOT, dockerHost: DOCKER_HOST, fixture: [folder] }),
    })
    expect(await a.readStackAge('wt-160')).toBe(NOW - 180 * MIN)
    expect(await a.readProcess(4242)).toEqual({ cores: 10, ageMs: 47 * MIN })
  })
})
