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
    FACTORY_CORES: '32',
    FACTORY_HEAVY_SLOTS: '1',
    FACTORY_REAP_GRACE: '0',
  }
  mkdirSync(join(root, 'tmp'), { recursive: true })
  expect(env['FACTORY_SLOT_DIR']?.startsWith(homedir() + '/Git/factory')).toBe(false)
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
