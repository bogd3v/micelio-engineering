import { type ChildProcess, spawn, spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  chmodSync,
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const SCRIPT = join(ROOT, 'herdr/factory-slot.sh')

/** Tools the script and the test commands need, linked into a PATH that has no `hc` or `herdr`. */
const TOOLS = [
  'bash',
  'sh',
  'env',
  'flock',
  'ps',
  'setsid',
  'sleep',
  'date',
  'sed',
  'grep',
  'find',
  'wc',
  'tr',
  'head',
  'mkdir',
  'rm',
  'mv',
  'readlink',
  'basename',
  'nproc',
  'cat',
  'touch',
  'tee',
  'echo',
]

let root: string
let env: NodeJS.ProcessEnv
const children: ChildProcess[] = []

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function until(condition: () => boolean, what: string, ms = 8000): Promise<void> {
  const end = Date.now() + ms
  while (!condition()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`)
    await sleepMs(50)
  }
}

/** Runs the script and returns when it exits. */
function slot(args: string[], extra: NodeJS.ProcessEnv = {}, path?: string) {
  const r = spawnSync('bash', [SCRIPT, ...args], {
    env: { ...env, ...extra, ...(path === undefined ? {} : { PATH: path }) },
    encoding: 'utf8',
  })
  return { code: r.status, out: r.stdout, err: r.stderr }
}

/** Starts the script in the background in its own group and returns its handle. */
function start(args: string[], extra: NodeJS.ProcessEnv = {}, cwd?: string) {
  const child = spawn('bash', [SCRIPT, ...args], {
    env: { ...env, ...extra },
    cwd,
    detached: true,
    stdio: 'ignore',
  })
  children.push(child)
  const exited = new Promise<number | null>((resolve) => child.on('exit', (code) => resolve(code)))
  return { child, exited }
}

/** A command that creates `<name>.up` and stays until `<name>.go` exists. */
function holder(name: string): string[] {
  const up = join(root, `${name}.up`)
  const go = join(root, `${name}.go`)
  return ['--', 'sh', '-c', `touch ${up}; while [ ! -e ${go} ]; do sleep 0.05; done`]
}
const upOf = (name: string): string => join(root, `${name}.up`)
const release = (name: string): void => writeFileSync(join(root, `${name}.go`), '')

/** The `TMPDIR` that `run` gives the command of the wrapper with this PID. */
const runTmpOf = (wrapper: number | undefined): string =>
  join(root, 'run-tmp', `run-${String(wrapper)}`)

/** The owner file of heavy slot 1, as key/value pairs. */
function owner(): Record<string, string> {
  const text = readFileSync(join(root, 'slots/heavy/slot-1.owner'), 'utf8')
  return Object.fromEntries(
    text
      .trim()
      .split('\n')
      .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)])
  )
}

/**
 * A stub `hc get` as hc 0.1.19 answers: a success on stdout, an error (exit 3 `not_found`
 * included) as JSON on stderr with an empty stdout.
 */
function stubHc(dir: string, exit: number, body: string): void {
  mkdirSync(dir, { recursive: true })
  const file = join(dir, 'hc')
  writeFileSync(file, `#!/bin/sh\necho '${body}'${exit === 0 ? '' : ' >&2'}\nexit ${exit}\n`)
  chmodSync(file, 0o755)
}

/**
 * A stub `herdr agent get <agent>` as herdr 0.9.5 answers: a success on stdout with exit 0, an
 * error as JSON on stderr with exit 1. Any other command line exits 64, so a script that asks
 * something else, or about another agent, gets no answer it can read.
 */
function stubHerdr(dir: string, agent: string, exit: number, body: string): void {
  mkdirSync(dir, { recursive: true })
  const file = join(dir, 'herdr')
  writeFileSync(
    file,
    `#!/bin/sh\nif [ "$*" != "agent get ${agent}" ]; then echo "unexpected: $*" >&2; exit 64; fi\n` +
      `echo '${body}'${exit === 0 ? '' : ' >&2'}\nexit ${exit}\n`
  )
  chmodSync(file, 0o755)
}

/** A directory of links to `TOOLS`: a PATH of it alone reaches neither the host's `hc` nor its `herdr`. */
function linkedTools(): string {
  const tools = join(root, 'tools')
  if (existsSync(tools)) return tools
  mkdirSync(tools)
  for (const tool of TOOLS) {
    const found = spawnSync('sh', ['-c', `command -v ${tool}`], {
      encoding: 'utf8',
    }).stdout.trim()
    if (found !== '') symlinkSync(found, join(tools, tool))
  }
  return tools
}

interface Answer {
  exit: number
  body: string
}

/** A PATH with the given stubs and the linked tools only; a tool left out is missing. */
function pathWith(agent: string, answers: { herdr?: Answer; hc?: Answer }): string {
  const bin = mkdtempSync(join(root, 'bin-'))
  if (answers.herdr !== undefined) {
    stubHerdr(bin, agent, answers.herdr.exit, answers.herdr.body)
  }
  if (answers.hc !== undefined) stubHc(bin, answers.hc.exit, answers.hc.body)
  return `${bin}:${linkedTools()}`
}

function groupAlive(pgid: number): boolean {
  try {
    process.kill(-pgid, 0)
    return true
  } catch {
    return false
  }
}

/** True when a slot directory is under the real one, `$HOME/Git/factory/run`; `~/Git/factory/tmp` is not. */
function underRealSlotDir(dir: string): boolean {
  const real = join(homedir(), 'Git/factory/run')
  return dir === real || dir.startsWith(real + '/')
}

beforeEach(() => {
  root = mkdtempSync(join(process.env['FACTORY_TEST_TMP'] ?? tmpdir(), 'factory-slot-'))
  const clean = { ...process.env }
  for (const key of Object.keys(clean)) {
    if (key.startsWith('FACTORY_') || key === 'HC_TERMINAL_ID') delete clean[key]
  }
  env = {
    ...clean,
    FACTORY_SLOT_DIR: join(root, 'slots'),
    FACTORY_TMP: join(root, 'tmp'),
    FACTORY_RUN_TMP: join(root, 'run-tmp'),
    FACTORY_CORES: '32',
    FACTORY_HEAVY_SLOTS: '1',
    FACTORY_REAP_GRACE: '0',
  }
  mkdirSync(join(root, 'tmp'), { recursive: true })
  expect(underRealSlotDir(env['FACTORY_SLOT_DIR'] ?? '')).toBe(false)
})

afterEach(() => {
  for (const child of children.splice(0)) {
    if (child.pid === undefined) continue
    try {
      process.kill(-child.pid, 'SIGKILL')
    } catch {
      // already gone
    }
  }
  // Commands the script started run in their own groups; stop any left in the slot files.
  const dir = join(root, 'slots/heavy')
  if (existsSync(dir)) {
    for (const name of readdirSync(dir).filter((n) => n.endsWith('.owner'))) {
      const pgid = /pgid=(\d+)/.exec(readFileSync(join(dir, name), 'utf8'))?.[1]
      if (pgid !== undefined) {
        try {
          process.kill(-Number(pgid), 'SIGKILL')
        } catch {
          // already gone
        }
      }
    }
  }
  rmSync(root, { recursive: true, force: true })
})

describe('factory-slot.sh run', () => {
  it('run waits while every slot of the pool is taken', async () => {
    const first = start(['run', ...holder('a')])
    await until(() => existsSync(upOf('a')), 'the first command')
    const second = start(['run', ...holder('b')])
    await sleepMs(1000)
    expect(existsSync(upOf('b'))).toBe(false)
    release('a')
    await first.exited
    await until(() => existsSync(upOf('b')), 'the second command once the slot is free')
    release('b')
    expect(await second.exited).toBe(0)
  })

  it('run gives the command VITEST_MAX_WORKERS as the cores divided by the slots', () => {
    const show = ['--', 'sh', '-c', 'echo "$VITEST_MAX_WORKERS"']
    const r = slot(['run', ...show], { FACTORY_CORES: '32', FACTORY_HEAVY_SLOTS: '3' })
    expect(r.out.trim()).toBe('10')
    const few = slot(['run', ...show], { FACTORY_CORES: '2', FACTORY_HEAVY_SLOTS: '3' })
    expect(few.out.trim()).toBe('1')
  })

  it('run hands free slots to waiters in the order they arrived', async () => {
    const first = start(['run', ...holder('a')])
    await until(() => existsSync(upOf('a')), 'the first command')
    const queue = join(root, 'slots/heavy/queue')
    // Start the waiters one at a time, each after the previous ticket is queued, so the arrival order is known.
    const waiters: { name: string; exited: Promise<number | null> }[] = []
    for (const name of ['b', 'c', 'd']) {
      const w = start(['run', ...holder(name)])
      waiters.push({ name, exited: w.exited })
      await until(
        () => existsSync(queue) && readdirSync(queue).length === waiters.length,
        `the ticket of ${name}`
      )
    }
    release('a')
    await first.exited
    const order: string[] = []
    for (const w of waiters) {
      await until(() => existsSync(upOf(w.name)), `${w.name} to run`)
      order.push(w.name)
      // no later waiter may have started before this one finishes
      for (const later of waiters.slice(waiters.indexOf(w) + 1)) {
        expect(existsSync(upOf(later.name))).toBe(false)
      }
      release(w.name)
      await w.exited
    }
    expect(order).toEqual(['b', 'c', 'd'])
  })

  it('run returns the exit code of the command', () => {
    expect(slot(['run', '--', 'sh', '-c', 'exit 7']).code).toBe(7)
    expect(slot(['run', '--', 'true']).code).toBe(0)
  })

  it('run gives the command its own TMPDIR and removes it when the command exits', () => {
    const show = ['--', 'sh', '-c', 'echo "$TMPDIR"; [ -d "$TMPDIR" ] && echo made']
    const r = slot(['run', ...show])
    const [path = '', made] = r.out.trim().split('\n')
    expect(r.code).toBe(0)
    expect(made).toBe('made')
    expect(path.slice(0, path.lastIndexOf('/'))).toBe(join(root, 'run-tmp'))
    expect(path.slice(path.lastIndexOf('/') + 1)).toMatch(/^run-\d+$/)
    expect(existsSync(path)).toBe(false)

    // Without FACTORY_RUN_TMP the directory is under the home directory's cache.
    const home = join(root, 'home')
    const byDefault = slot(['run', ...show], { HOME: home, FACTORY_RUN_TMP: undefined })
    const [fallback = ''] = byDefault.out.trim().split('\n')
    const parent = join(home, '.cache/micelio-factory/tmp')
    expect(fallback.slice(0, fallback.lastIndexOf('/'))).toBe(parent)
    expect(existsSync(fallback)).toBe(false)
    expect(readdirSync(parent)).toEqual([])
  })

  it("run removes the command's TMPDIR when the command fails", async () => {
    const seen = join(root, 'seen')
    const failing = `echo "$TMPDIR" >${seen}; exit 7`
    expect(slot(['run', '--', 'sh', '-c', failing]).code).toBe(7)
    const path = readFileSync(seen, 'utf8').trim()
    expect(path.startsWith(join(root, 'run-tmp', 'run-'))).toBe(true)
    expect(existsSync(path)).toBe(false)

    // A wrapper stopped by a signal stops its command and cleans up too.
    const stopped = start(['run', ...holder('a')])
    await until(() => existsSync(upOf('a')), 'the command')
    const dir = runTmpOf(stopped.child.pid)
    expect(existsSync(dir)).toBe(true)
    stopped.child.kill('SIGTERM')
    await stopped.exited
    expect(existsSync(dir)).toBe(false)
  })

  it('run starts the command on an empty TMPDIR when a dead wrapper left one with its PID', () => {
    // `exec` keeps the PID, so the directory planted here is the one the wrapper will use.
    const plant = 'mkdir -p "$RUN_TMP/run-$$" && touch "$RUN_TMP/run-$$/stale"'
    const list = `sh -c 'ls -A "$TMPDIR"'`
    const r = spawnSync('sh', ['-c', `${plant} && exec bash "$SCRIPT" run -- ${list}`], {
      env: { ...env, RUN_TMP: join(root, 'run-tmp'), SCRIPT },
      encoding: 'utf8',
    })
    expect(r.status).toBe(0)
    expect(r.stdout).toBe('')
  })

  it('run exits 2 without starting the command when it cannot create the TMPDIR', () => {
    const file = join(root, 'not-a-directory')
    writeFileSync(file, '')
    const marker = join(root, 'started')
    const r = slot(['run', '--', 'touch', marker], { FACTORY_RUN_TMP: file })
    expect(r.code).toBe(2)
    expect(r.err).toContain('cannot create')
    expect(existsSync(marker)).toBe(false)
  })

  it('run records HC_TERMINAL_ID as the agent when FACTORY_AGENT is unset', async () => {
    const hc = start(['run', ...holder('a')], { HC_TERMINAL_ID: 't42' })
    await until(() => existsSync(join(root, 'slots/heavy/slot-1.owner')), 'the owner file')
    expect(owner()['agent']).toBe('t42')
    expect(slot(['status']).out).toContain('t42')
    release('a')
    await hc.exited
    expect(existsSync(join(root, 'slots/heavy/slot-1.owner'))).toBe(false)

    const named = start(['run', ...holder('b')], {
      HC_TERMINAL_ID: 't42',
      FACTORY_AGENT: 'worker-9',
    })
    await until(() => existsSync(join(root, 'slots/heavy/slot-1.owner')), 'the second owner file')
    expect(owner()['agent']).toBe('worker-9')
    release('b')
    await named.exited
  })
})

describe('factory-slot.sh acquire and release', () => {
  it('acquire exits 75 when the workers pool is full', () => {
    // With no FACTORY_WORKER_SLOTS the pool holds 6 leases.
    for (let i = 1; i <= 6; i++) {
      expect(slot(['acquire', '--pool', 'workers', '--agent', `worker-${i}`]).code).toBe(0)
    }
    const full = slot(['acquire', '--pool', 'workers', '--agent', 'worker-7'])
    expect(full.code).toBe(75)
    expect(existsSync(join(root, 'slots/workers/lease-worker-7'))).toBe(false)
    expect(slot(['acquire', '--pool', 'workers', '--agent', 'a/b']).code).toBe(2)
    // The same agent asking again keeps its lease and takes no second one.
    expect(slot(['acquire', '--pool', 'workers', '--agent', 'worker-1']).code).toBe(0)
    expect(slot(['release', '--agent', 'worker-1']).code).toBe(0)
    expect(slot(['acquire', '--pool', 'workers', '--agent', 'worker-7']).code).toBe(0)
    // FACTORY_WORKER_SLOTS sizes the pool.
    expect(
      slot(['acquire', '--pool', 'workers', '--agent', 'worker-8'], { FACTORY_WORKER_SLOTS: '6' })
        .code
    ).toBe(75)
    expect(
      slot(['acquire', '--pool', 'workers', '--agent', 'worker-8'], { FACTORY_WORKER_SLOTS: '7' })
        .code
    ).toBe(0)
  })
})

describe('factory-slot.sh reap', () => {
  const finished = {
    exit: 0,
    body: '{"finished_ms":1,"state":"finished","status":{"state":"working"}}',
  }
  const notFound = { exit: 3, body: '{"error":{"kind":"not_found"}}' }
  const hcLive = { exit: 0, body: '{"finished_ms":null,"state":"live","status":{"state":"idle"}}' }
  const listed = (status: string): Answer => ({
    exit: 0,
    body: `{"id":"cli:agent:get","result":{"agent":{"agent_status":"${status}","pane_id":"w4:pE"},"type":"agent_info"}}`,
  })
  const agentNotFound = {
    exit: 1,
    body: '{"error":{"code":"agent_not_found","message":"agent target not found"},"id":"cli:agent:get"}',
  }
  const serverDown = {
    exit: 1,
    body: '{"error":{"code":"server_not_running","message":"no herdr server is running"},"id":"cli:agent:get"}',
  }
  const owned = (): string => join(root, 'slots/heavy/slot-1.owner')
  const leaseOf = (agent: string): string => join(root, `slots/workers/lease-${agent}`)

  async function startOwned(agent: string, extra: NodeJS.ProcessEnv = {}) {
    const run = start(['run', ...holder('a')], { FACTORY_AGENT: agent, ...extra })
    await until(() => existsSync(join(root, 'slots/heavy/slot-1.owner')), 'the owner file')
    await until(() => existsSync(upOf('a')), 'the command')
    return { run, pgid: Number(owner()['pgid']) }
  }

  it('reap leaves a slot and a lease alone while herdr lists the agent, though hc answers not_found', async () => {
    const { run, pgid } = await startOwned('worker-5')
    expect(slot(['acquire', '--pool', 'workers', '--agent', 'worker-5']).code).toBe(0)
    const path = pathWith('worker-5', { herdr: listed('working'), hc: notFound })
    const r = slot(['reap'], {}, path)
    expect(r.code).toBe(0)
    expect(r.out).toBe('')
    expect(groupAlive(pgid)).toBe(true)
    expect(existsSync(owned())).toBe(true)
    expect(existsSync(leaseOf('worker-5'))).toBe(true)
    release('a')
    await run.exited
  })

  it('reap leaves a slot alone while herdr lists an agent whose status is done', async () => {
    const { run, pgid } = await startOwned('worker-5')
    for (const status of ['done', 'idle']) {
      const path = pathWith('worker-5', { herdr: listed(status), hc: finished })
      expect(slot(['reap'], {}, path).out).toBe('')
      expect(groupAlive(pgid)).toBe(true)
      expect(existsSync(owned())).toBe(true)
    }
    release('a')
    await run.exited
  })

  it('reap leaves a slot alone while hc lists its terminal, though herdr answers agent_not_found', async () => {
    const { run, pgid } = await startOwned('', { HC_TERMINAL_ID: 't42' })
    expect(owner()['agent']).toBe('t42')
    const path = pathWith('t42', { herdr: agentNotFound, hc: hcLive })
    expect(slot(['reap'], {}, path).out).toBe('')
    expect(groupAlive(pgid)).toBe(true)
    expect(existsSync(owned())).toBe(true)
    release('a')
    await run.exited
  })

  it('reap counts an agent as running when one tool lists it, whatever the other answers', async () => {
    const { run, pgid } = await startOwned('worker-5')
    const broken = { exit: 1, body: 'boom' }
    const pairs: { herdr?: Answer; hc?: Answer }[] = [
      { herdr: listed('working') },
      { herdr: listed('working'), hc: broken },
      { hc: hcLive },
      { herdr: serverDown, hc: hcLive },
      { herdr: broken, hc: hcLive },
    ]
    for (const pair of pairs) {
      expect(slot(['reap'], {}, pathWith('worker-5', pair)).out).toBe('')
      expect(groupAlive(pgid)).toBe(true)
      expect(existsSync(owned())).toBe(true)
    }
    release('a')
    await run.exited
  })

  it('reap kills the process group of a slot whose agent neither herdr nor hc lists', async () => {
    for (const answer of [finished, notFound]) {
      const { run, pgid } = await startOwned('worker-5')
      const path = pathWith('worker-5', { herdr: agentNotFound, hc: answer })
      const r = slot(['reap'], {}, path)
      expect(r.code).toBe(0)
      expect(r.out).toContain(`killed ${owned()}`)
      await run.exited
      expect(groupAlive(pgid)).toBe(false)
      expect(existsSync(owned())).toBe(false)
      // the next round needs the holder's marker files gone
      rmSync(upOf('a'), { force: true })
    }
  })

  it('reap releases a lease whose agent neither herdr nor hc lists', () => {
    for (const answer of [finished, notFound]) {
      expect(slot(['acquire', '--pool', 'workers', '--agent', 'worker-3']).code).toBe(0)
      const path = pathWith('worker-3', { herdr: agentNotFound, hc: answer })
      const r = slot(['reap'], {}, path)
      expect(r.code).toBe(0)
      expect(r.out).toContain(`released ${leaseOf('worker-3')}`)
      expect(existsSync(leaseOf('worker-3'))).toBe(false)
    }
  })

  it('reap prints unknown and leaves a slot alone when herdr is missing or answers another error', async () => {
    const { run, pgid } = await startOwned('worker-5')
    expect(slot(['acquire', '--pool', 'workers', '--agent', 'worker-5']).code).toBe(0)
    const answers: (Answer | undefined)[] = [
      undefined,
      serverDown,
      { exit: 1, body: 'boom' },
      { exit: 2, body: agentNotFound.body },
      { exit: 0, body: 'not json' },
      { exit: 0, body: agentNotFound.body },
      { exit: 1, body: listed('working').body },
    ]
    for (const herdr of answers) {
      for (const hc of [notFound, finished]) {
        const path = pathWith('worker-5', { ...(herdr === undefined ? {} : { herdr }), hc })
        const r = slot(['reap'], {}, path)
        expect(r.out).toContain(`unknown ${owned()}`)
        expect(r.out).toContain(`unknown ${leaseOf('worker-5')}`)
        expect(groupAlive(pgid)).toBe(true)
        expect(existsSync(owned())).toBe(true)
        expect(existsSync(leaseOf('worker-5'))).toBe(true)
      }
    }
    release('a')
    await run.exited
  })

  it('reap prints unknown and leaves a slot alone when hc is missing, though herdr answers agent_not_found', async () => {
    const { run, pgid } = await startOwned('worker-5')
    const r = slot(['reap'], {}, pathWith('worker-5', { herdr: agentNotFound }))
    expect(r.out).toContain(`unknown ${owned()}`)
    expect(groupAlive(pgid)).toBe(true)
    expect(existsSync(owned())).toBe(true)
    release('a')
    await run.exited
  })

  it('reap leaves a slot alone when hc cannot say whether its agent runs', async () => {
    const { run, pgid } = await startOwned('worker-5')

    // neither tool on PATH
    const missing = slot(['reap'], {}, pathWith('worker-5', {}))
    expect(missing.out).toContain('unknown')
    expect(groupAlive(pgid)).toBe(true)
    expect(existsSync(owned())).toBe(true)

    // hc exits 1
    const broken = slot(
      ['reap'],
      {},
      pathWith('worker-5', { herdr: agentNotFound, hc: { exit: 1, body: 'boom' } })
    )
    expect(broken.out).toContain('unknown')
    expect(groupAlive(pgid)).toBe(true)
    expect(existsSync(owned())).toBe(true)

    // hc exits 0 with a state that is not finished: the agent runs
    const running = slot(
      ['reap'],
      {},
      pathWith('worker-5', {
        herdr: agentNotFound,
        hc: { exit: 0, body: '{"finished_ms":null,"state":"live","status":{"state":"finished"}}' },
      })
    )
    expect(running.out).not.toContain('unknown')
    expect(groupAlive(pgid)).toBe(true)

    release('a')
    await run.exited
  })

  it('reap prints unknown and leaves a slot alone when hc answers finished without a numeric finished_ms', async () => {
    const { run, pgid } = await startOwned('worker-5')
    expect(slot(['acquire', '--pool', 'workers', '--agent', 'worker-5']).code).toBe(0)
    const bodies = [
      '{"finished_ms":null,"state":"finished","status":{"state":"working"}}',
      '{"state":"finished","status":{"state":"working"}}',
      '{"finished_ms":"1","state":"finished"}',
      // a finished_ms that belongs to the nested status is not the terminal's
      '{"finished_ms":null,"state":"finished","status":{"finished_ms":1,"state":"finished"}}',
    ]
    for (const body of bodies) {
      const path = pathWith('worker-5', { herdr: agentNotFound, hc: { exit: 0, body } })
      const r = slot(['reap'], {}, path)
      expect(r.out).toContain(`unknown ${owned()}`)
      expect(r.out).toContain(`unknown ${leaseOf('worker-5')}`)
      expect(groupAlive(pgid)).toBe(true)
      expect(existsSync(owned())).toBe(true)
      expect(existsSync(leaseOf('worker-5'))).toBe(true)
    }
    release('a')
    await run.exited
  })

  it('reap prints unknown when the exit code of hc does not go with its answer', async () => {
    const { run, pgid } = await startOwned('worker-5')
    const answers: Answer[] = [
      { exit: 1, body: finished.body },
      { exit: 3, body: finished.body },
      { exit: 2, body: hcLive.body },
      { exit: 1, body: notFound.body },
      { exit: 0, body: notFound.body },
      { exit: 3, body: '{"error":{"kind":"timeout"}}' },
    ]
    for (const hc of answers) {
      const r = slot(['reap'], {}, pathWith('worker-5', { herdr: agentNotFound, hc }))
      expect(r.out).toContain(`unknown ${owned()}`)
      expect(groupAlive(pgid)).toBe(true)
      expect(existsSync(owned())).toBe(true)
    }
    release('a')
    await run.exited
  })

  it('reap reads the state of the terminal, not the one nested in its status', async () => {
    const { run, pgid } = await startOwned('worker-5')
    const live = [
      '{"finished_ms":null,"state":"live","status":{"finished_ms":1,"state":"finished"}}',
      '{"status":{"finished_ms":1,"state":"finished"},"state":"live","finished_ms":null}',
      '{"title":"a } \\" { b","finished_ms":null,"state":"live","status":{"state":"finished"}}',
      '{\n  "finished_ms": null,\n  "state": "live",\n  "status": { "state": "finished" }\n}',
    ]
    for (const body of live) {
      const path = pathWith('worker-5', { herdr: agentNotFound, hc: { exit: 0, body } })
      expect(slot(['reap'], {}, path).out).toBe('')
      expect(groupAlive(pgid)).toBe(true)
      expect(existsSync(owned())).toBe(true)
    }
    // only a nested state says nothing about the terminal
    const nested = '{"finished_ms":1,"status":{"finished_ms":1,"state":"finished"}}'
    const path = pathWith('worker-5', { herdr: agentNotFound, hc: { exit: 0, body: nested } })
    expect(slot(['reap'], {}, path).out).toContain(`unknown ${owned()}`)
    expect(groupAlive(pgid)).toBe(true)
    release('a')
    await run.exited
  })

  it('reap counts a finished terminal as gone wherever its keys come in the answer', () => {
    const bodies = [
      '{"status":{"state":"working"},"state":"finished","finished_ms":1}',
      '{\n  "finished_ms": 1,\n  "state": "finished",\n  "status": { "state": "working" }\n}',
    ]
    for (const body of bodies) {
      expect(slot(['acquire', '--pool', 'workers', '--agent', 'worker-3']).code).toBe(0)
      const path = pathWith('worker-3', { herdr: agentNotFound, hc: { exit: 0, body } })
      expect(slot(['reap'], {}, path).out).toContain(`released ${leaseOf('worker-3')}`)
      expect(existsSync(leaseOf('worker-3'))).toBe(false)
    }
  })

  it('reap removes the owner file of a dead PID', async () => {
    const { run, pgid } = await startOwned('')
    process.kill(-pgid, 'SIGKILL')
    await run.exited
    // The wrapper removes its file at the end; plant it again as a crash would leave it.
    writeFileSync(owned(), `pid=${pgid}\npgid=${pgid}\nagent=\nstart=0\ncommand=x\n`)
    const r = slot(['reap'], {}, pathWith('', {}))
    expect(r.out).toContain('removed')
    expect(existsSync(owned())).toBe(false)
  })

  it('reap removes the TMPDIR of a run whose wrapper is dead', async () => {
    const { run, pgid } = await startOwned('')
    const wrapper = run.child.pid as number
    const dir = runTmpOf(wrapper)

    // While the wrapper lives its directory stays.
    expect(slot(['reap'], {}, pathWith('', {})).out).toBe('')
    expect(existsSync(dir)).toBe(true)

    // A killed wrapper never reaches its own cleanup.
    process.kill(wrapper, 'SIGKILL')
    await run.exited
    process.kill(-pgid, 'SIGKILL')
    await until(() => !groupAlive(pgid), 'the command to die')
    expect(existsSync(dir)).toBe(true)

    // Only a directory named after a PID is a run's: these two are not, and they stay.
    const otherName = join(root, 'run-tmp', 'run-notapid')
    mkdirSync(otherName)
    const aFile = runTmpOf(pgid)
    writeFileSync(aFile, '')

    const r = slot(['reap'], {}, pathWith('', {}))
    expect(r.code).toBe(0)
    expect(r.out).toContain(`removed ${dir}`)
    expect(existsSync(dir)).toBe(false)
    expect(existsSync(otherName)).toBe(true)
    expect(existsSync(aFile)).toBe(true)
  })

  it('reap keeps a lease younger than the grace period', () => {
    const path = pathWith('worker-3', { herdr: agentNotFound, hc: notFound })
    const lease = leaseOf('worker-3')
    slot(['acquire', '--pool', 'workers', '--agent', 'worker-3'])
    const kept = slot(['reap'], { FACTORY_REAP_GRACE: '300' }, path)
    expect(kept.code).toBe(0)
    expect(existsSync(lease)).toBe(true)
    // Past the grace period the same answer releases it.
    const released = slot(['reap'], { FACTORY_REAP_GRACE: '0' }, path)
    expect(released.out).toContain('released')
    expect(existsSync(lease)).toBe(false)
  })
})

describe('factory-slot.sh status', () => {
  it('status lists a process under the factory tmp directory that holds no slot as orphan', async () => {
    const dir = join(root, 'tmp/r4-late')
    mkdirSync(dir)
    const loose = spawn('sleep', ['60'], { cwd: dir, detached: true, stdio: 'ignore' })
    children.push(loose)
    const pid = loose.pid as number

    const run = start(['run', ...holder('a')], { FACTORY_AGENT: 'worker-1' }, dir)
    await until(() => existsSync(upOf('a')), 'the slot command')

    const listing = slot(['status']).out
    const orphans = listing.split('\n').filter((l) => l.startsWith('orphan'))
    expect(orphans.some((l) => l.split('\t')[1] === String(pid))).toBe(true)
    // the command that holds a slot is not an orphan, even with its cwd under the tmp directory
    // nor is the run wrapper, nor a wrapper still waiting for a slot
    const waiting = start(['run', '--', 'true'], { FACTORY_AGENT: 'worker-2' }, dir)
    await until(() => readdirSync(join(root, 'slots/heavy/queue')).length === 1, 'a ticket')
    const again = slot(['status'])
      .out.split('\n')
      .filter((l) => l.startsWith('orphan'))
    expect(again.some((l) => l.split('\t')[1] === String(run.child.pid))).toBe(false)
    expect(again.some((l) => l.split('\t')[1] === String(waiting.child.pid))).toBe(false)
    const slotPgid = Number(owner()['pgid'])
    expect(orphans.some((l) => l.split('\t')[1] === String(slotPgid))).toBe(false)
    expect(listing).toMatch(/^heavy\t1\tworker-1\t\d+\t.*\talive$/m)

    // reap never kills an orphan
    const gone = {
      herdr: { exit: 1, body: '{"error":{"code":"agent_not_found"}}' },
      hc: { exit: 3, body: '{"error":{"kind":"not_found"}}' },
    }
    slot(['reap'], {}, pathWith('worker-1', gone))
    expect(() => process.kill(pid, 0)).not.toThrow()
    release('a')
    await run.exited
    await waiting.exited
  })
})

describe('the guard of beforeEach', () => {
  it('the guard fails a FACTORY_SLOT_DIR under ~/Git/factory/run and passes one under ~/Git/factory/tmp', () => {
    const factory = join(homedir(), 'Git/factory')
    expect(underRealSlotDir(join(factory, 'run/slots'))).toBe(true)
    expect(underRealSlotDir(join(factory, 'run'))).toBe(true)
    expect(underRealSlotDir(join(factory, 'tmp/worker-1/factory-slot-x/slots'))).toBe(false)
    expect(underRealSlotDir(join(factory, 'runner/slots'))).toBe(false)
    expect(underRealSlotDir(join(tmpdir(), 'factory-slot-x/slots'))).toBe(false)
  })
})

describe('factory-slot.sh pause and hold', () => {
  const acquire = (agent: string) => slot(['acquire', '--pool', 'workers', '--agent', agent])

  it('acquire prints paused, exits 75 and writes no lease while paused, and works again after resume', () => {
    expect(slot(['pause']).code).toBe(0)
    const paused = acquire('worker-1')
    expect(paused.code).toBe(75)
    expect(paused.out.trim()).toBe('paused')
    expect(existsSync(join(root, 'slots/workers/lease-worker-1'))).toBe(false)
    expect(slot(['resume']).code).toBe(0)
    expect(acquire('worker-1').code).toBe(0)
    expect(existsSync(join(root, 'slots/workers/lease-worker-1'))).toBe(true)
  })

  it('run starts its command while paused', () => {
    slot(['pause'])
    const r = slot(['run', '--', 'sh', '-c', 'exit 7'])
    expect(r.code).toBe(7)
    expect(slot(['release', '--agent', 'worker-1']).code).toBe(0)
  })

  it('a held slot counts as taken: with two commands running and one slot held, a third run waits', async () => {
    const three = { FACTORY_HEAVY_SLOTS: '3' }
    expect(slot(['hold', '--agent', 'maintainer'], three).code).toBe(0)
    const a = start(['run', ...holder('a')], three)
    const b = start(['run', ...holder('b')], three)
    await until(() => existsSync(upOf('a')) && existsSync(upOf('b')), 'two commands')
    const c = start(['run', ...holder('c')], three)
    await until(() => readdirSync(join(root, 'slots/heavy/queue')).length === 1, 'a ticket')
    await sleepMs(500)
    expect(existsSync(upOf('c'))).toBe(false)
    release('a')
    await a.exited
    await until(() => existsSync(upOf('c')), 'the third command')
    release('b')
    release('c')
    await b.exited
    await c.exited
  })

  it('hold exits 75 when every heavy slot is taken', async () => {
    const run = start(['run', ...holder('a')])
    await until(() => existsSync(upOf('a')), 'the slot command')
    const r = slot(['hold', '--agent', 'maintainer'])
    expect(r.code).toBe(75)
    expect(r.out.trim()).toBe('no free slot')
    expect(readdirSync(join(root, 'slots/heavy')).some((n) => n.endsWith('.hold'))).toBe(false)
    expect(slot(['hold', '--agent', 'worker-1']).code).toBe(2)
    release('a')
    await run.exited
  })

  it('release --agent maintainer frees the held slot, and reap never removes a hold', () => {
    expect(slot(['hold', '--agent', 'maintainer']).code).toBe(0)
    const hold = join(root, 'slots/heavy/slot-1.hold')
    expect(existsSync(hold)).toBe(true)
    expect(slot(['reap']).code).toBe(0)
    expect(existsSync(hold)).toBe(true)
    expect(slot(['release', '--agent', 'maintainer']).code).toBe(0)
    expect(existsSync(hold)).toBe(false)
    expect(slot(['hold', '--agent', 'maintainer']).code).toBe(0)
  })

  it('status prints paused first and the held slot with the agent maintainer', () => {
    expect(slot(['status']).out).not.toMatch(/^paused$/m)
    slot(['pause'])
    slot(['hold', '--agent', 'maintainer'])
    const lines = slot(['status']).out.trim().split('\n')
    expect(lines[0]).toBe('paused')
    expect(lines[1]).toMatch(/^heavy\t1\tmaintainer\t-\t.+\thold\theld$/)
  })
})
