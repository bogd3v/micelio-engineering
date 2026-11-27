import { describe, expect, it } from 'vitest'
import { createAdapters, readConfig } from '../herdr/mod/factory/adapters.js'
import {
  createGate,
  EPIC_EVERY_MS,
  FAST_READ_MS,
  FAST_STEP_MS,
  readEpics,
  readFast,
  readSlow,
  SLOW_READ_MS,
  SLOW_STEP_MS,
  within,
} from '../herdr/mod/factory/lib/reads.js'
import { buildGithub } from '../herdr/mod/factory/lib/panel.js'

const NEVER = new Promise<never>(() => {})
const STATUS = 'heavy slots: 0/3\n'
const SPACES = [{ name: 'micelio-engineering', repo: 'bogd3v/micelio-engineering', milestone: 12 }]

const flush = async () => {
  for (let i = 0; i < 20; i += 1) await new Promise((r) => setImmediate(r))
}

/** A sleep that ends when the test moves the clock: no real time passes. */
function clock() {
  let t = 0
  const waiting: { at: number; done: () => void }[] = []
  return {
    sleep: (ms: number) =>
      new Promise<void>((done) => {
        waiting.push({ at: t + ms, done })
      }),
    async advance(ms: number) {
      // The steps that answer do so before the clock moves.
      await flush()
      t += ms
      for (const w of waiting.filter((x) => x.at <= t)) w.done()
      await flush()
    },
  }
}

const config = readConfig({
  checkout: '/checkout',
  maintainer: 'ale9420',
  dockerHost: '',
  fixture: null,
  spaces: SPACES,
})
interface Run {
  code: number
  stdout: string
  stderr: string
}
const ok = (stdout: string): Run => ({ code: 0, stdout, stderr: '' })

/** The adapters of a real run, over a stub `exec` and a stub `readTextFile`. */
const adapters = (
  readTextFile: (path: string) => Promise<string | null>,
  exec: (program: string) => Promise<Run> = async (program) =>
    ok(program === 'bash' ? STATUS : program === 'nproc' ? '8\n' : '[]')
) => createAdapters({ exec, readTextFile, terminals: () => [], config, clock: () => 1_000 })

const proc = (path: string): string | null =>
  path === '/proc/loadavg'
    ? '2.81 1.96 1.49 1/500 1234\n'
    : path === '/proc/meminfo'
      ? 'MemTotal: 16000000 kB\nMemAvailable: 8000000 kB\n'
      : null

describe('the time limits of the reads', () => {
  it('a readTextFile that never settles ends the machine read at its time limit, and the slots and agents of the same read land', async () => {
    const time = clock()
    const a = adapters(async (path) => (path.startsWith('/sys/') ? NEVER : proc(path)))
    const pending = readFast(a, { sleep: time.sleep })
    await time.advance(FAST_STEP_MS)
    const read = await pending
    expect(read.machine).toEqual({ error: 'readMachine: no answer in 20 s' })
    expect((read.slots as { text: string }).text).toBe(STATUS)
    expect((read.agents as { terminals: unknown[] }).terminals).toEqual([])
    expect((read.stacks as { text: string }).text).toBe('[]')
    expect(read.now).toBe(1_000)
  })

  it('an exec that never settles ends the slots read at its time limit with an error that names the step', async () => {
    const time = clock()
    const a = adapters(
      async (path) => proc(path),
      async (program) => (program === 'bash' ? NEVER : ok(program === 'nproc' ? '8\n' : '[]'))
    )
    const pending = readFast(a, { sleep: time.sleep })
    await time.advance(FAST_STEP_MS - 1)
    await time.advance(1)
    const read = await pending
    expect(read.slots).toEqual({ error: 'readSlots: no answer in 20 s' })
    expect((read.machine as { loadavg: string }).loadavg).toContain('2.81')
  })

  it('a step that rejects ends as an error of its own source and the other sources of the read land', async () => {
    const time = clock()
    const good = adapters(async (path) => proc(path))
    const read = await readFast(
      {
        ...good,
        readMachine: () => Promise.reject(new Error('EIO: sensor gone\nsecond line')),
        readAgents: () => {
          throw new Error('terminals broke')
        },
      },
      { sleep: time.sleep }
    )
    expect(read.machine).toEqual({ error: 'readMachine: EIO: sensor gone' })
    expect(read.agents).toEqual({ error: 'readAgents: terminals broke' })
    expect((read.slots as { text: string }).text).toBe(STATUS)
    expect((read.stacks as { text: string }).text).toBe('[]')
    // `within` alone: the value of a promise that settles in time.
    expect(await within(1000, 'step', Promise.resolve(7), time.sleep)).toBe(7)
  })

  it('a read past its limit does not keep the next one from starting, and its late result is dropped', () => {
    const gate = createGate(FAST_READ_MS)
    const first = gate.start(0)
    expect(first).not.toBeNull()
    expect(gate.start(FAST_READ_MS - 1)).toBeNull()
    const second = gate.start(FAST_READ_MS)
    expect(second).not.toBeNull()
    expect(second).not.toBe(first)
    expect(gate.isCurrent(first)).toBe(false)
    expect(gate.isCurrent(second)).toBe(true)
    // The late end of the first read does not free the second.
    gate.end(first)
    expect(gate.start(FAST_READ_MS + 1)).toBeNull()
    gate.end(second)
    expect(gate.start(FAST_READ_MS + 2)).not.toBeNull()
  })

  it('a read whose task never ends, its finally never run, does not keep the next one from starting', () => {
    const fast = createGate(FAST_READ_MS)
    expect(fast.start(0)).not.toBeNull()
    expect(fast.start(5_000)).toBeNull()
    expect(fast.start(FAST_READ_MS)).not.toBeNull()
    const slow = createGate(SLOW_READ_MS)
    expect(slow.start(0)).not.toBeNull()
    expect(slow.start(SLOW_READ_MS - 1)).toBeNull()
    expect(slow.start(SLOW_READ_MS)).not.toBeNull()
  })

  it("a GitHub step that never settles ends the slow read at its time limit and GitHub is stale with the step's name", async () => {
    const time = clock()
    const now = Date.parse('2026-11-25T12:00:00Z')
    const good = {
      at: new Date(now).toISOString(),
      issues: [],
      comments: {},
      maintainer: 'ale9420',
    }
    const first = await readSlow(
      { now: async () => now, readGithub: async () => good, readPulls: async () => [] },
      SPACES,
      { sleep: time.sleep }
    )
    const github = buildGithub({ now, spaces: SPACES, reads: first.reads })
    expect(github.spaces['micelio-engineering']!.stale).toBe(false)
    const pending = readSlow(
      { now: async () => now + 60_000, readGithub: () => NEVER, readPulls: async () => [] },
      SPACES,
      { sleep: time.sleep }
    )
    await time.advance(SLOW_STEP_MS)
    const second = await pending
    const stale = buildGithub({
      now: now + 60_000,
      spaces: SPACES,
      reads: second.reads,
      previous: github,
    })
    expect(stale.spaces['micelio-engineering']).toMatchObject({
      stale: true,
      error: 'readGithub: no answer in 45 s',
    })
  })

  it('a readPulls that never settles leaves the read of its space good, with no pull requests', async () => {
    const time = clock()
    const good = { at: '2026-11-25T12:00:00.000Z', issues: [], comments: {}, maintainer: 'ale9420' }
    const pending = readSlow(
      { now: async () => 1, readGithub: async () => good, readPulls: () => NEVER },
      SPACES,
      { sleep: time.sleep }
    )
    await time.advance(SLOW_STEP_MS)
    const { reads } = await pending
    expect(reads['micelio-engineering']).toEqual({ ...good, pulls: [] })
  })

  it('a hwmon file whose read rejects is left out, and the load, the memory and the cores are still read', async () => {
    const files: Record<string, string | Error> = {
      '/sys/class/hwmon/hwmon0/name': new Error('EIO'),
      '/sys/class/hwmon/hwmon1/name': 'hidpp_battery_0\n',
      '/sys/class/hwmon/hwmon1/temp1_input': new Error('ENODEV'),
      '/sys/class/hwmon/hwmon3/name': 'k10temp\n',
      '/sys/class/hwmon/hwmon3/temp1_input': '42000\n',
    }
    const a = adapters(async (path) => {
      const file = files[path]
      if (file instanceof Error) throw file
      return file ?? proc(path)
    })
    const read = await a.readMachine()
    expect(read.error).toBeUndefined()
    expect(read.loadavg).toContain('2.81')
    expect(read.meminfo).toContain('MemTotal')
    expect(read.cores).toBe(8)
    expect(read.hwmon).toEqual([
      { name: 'hidpp_battery_0', temp1_input: null },
      { name: 'k10temp', temp1_input: '42000\n' },
    ])
  })
})

describe('the read of the epics', () => {
  const REPO = 'bogd3v/micelio'
  const SPACES_OF_EPICS = readConfig({
    spaces: [
      { name: 'micelio', repo: REPO, milestone: 18, epic: 872 },
      { name: 'fediverse', repo: 'bogd3v/fediverse', milestone: 3 },
    ],
  }).spaces
  const EPIC = { state: 'open', title: 'Epic: x', labels: [] }

  it('the epic of each space is read when the panel starts and at most once an hour after', async () => {
    const time = clock()
    const calls: string[][] = []
    let answer: 'ok' | 'fail' | 'silent' = 'ok'
    const a = createAdapters({
      exec: async (cmd: string, args: string[]) => {
        calls.push([cmd, ...args])
        if (answer === 'silent') return NEVER
        return answer === 'ok'
          ? ok(`HTTP/2.0 200 OK\r\n\r\n${JSON.stringify(EPIC)}`)
          : {
              code: 1,
              stdout: 'HTTP/2.0 404 Not Found\r\n\r\n{"message":"Not Found"}',
              stderr: 'gh: Not Found (HTTP 404)\n',
            }
      },
      readTextFile: async () => null,
      terminals: () => [],
      config: readConfig({ spaces: SPACES_OF_EPICS }),
    })
    const read = (now: number, previous: Awaited<ReturnType<typeof readEpics>>, remote = true) =>
      readEpics(a, SPACES_OF_EPICS, {
        sleep: time.sleep,
        now,
        remote,
        previous,
      })
    // The pace of the quota or a hidden window says no: nothing is read and nothing counts.
    expect(await read(0, {}, false)).toEqual({})
    expect(calls).toEqual([])
    const first = await read(0, {})
    expect(calls).toEqual([['gh', 'api', `repos/${REPO}/issues/872`, '--include']])
    expect(first).toEqual({ micelio: { at: 0, issue: EPIC } })
    expect(await read(EPIC_EVERY_MS - 1, first)).toEqual(first)
    expect(calls).toHaveLength(1)
    expect(EPIC_EVERY_MS).toBe(3_600_000)
    // A try that fails counts, and keeps the last good answer.
    answer = 'fail'
    const second = await read(EPIC_EVERY_MS, first)
    expect(calls).toHaveLength(2)
    expect(second).toEqual({ micelio: { at: EPIC_EVERY_MS, issue: EPIC } })
    await read(EPIC_EVERY_MS + 60_000, second)
    expect(calls).toHaveLength(2)
    // A read that never answers is cut at the limit of a GitHub step.
    answer = 'silent'
    const pending = read(2 * EPIC_EVERY_MS, {})
    await time.advance(SLOW_STEP_MS)
    expect(await pending).toEqual({ micelio: { at: 2 * EPIC_EVERY_MS, issue: null } })
  })

  it('with fixture the epic comes from epic-<space>.json and no gh runs', async () => {
    const calls: string[] = []
    const real = createAdapters({
      exec: async (cmd: string) => {
        calls.push(cmd)
        return ok('')
      },
      readTextFile: async (path: string) =>
        path === '/checkout/recorded/epic-micelio.json' ? JSON.stringify(EPIC) : null,
      terminals: () => [],
      config: readConfig({ checkout: '/checkout', fixture: 'recorded', spaces: SPACES_OF_EPICS }),
    })
    expect(await real.readEpic(SPACES_OF_EPICS[0]!)).toEqual({ issue: EPIC })
    // No recording is a failed read.
    expect(await real.readEpic(SPACES_OF_EPICS[1]!)).toEqual({ error: 'no epic of fediverse' })
    expect(calls).toEqual([])
  })
})
