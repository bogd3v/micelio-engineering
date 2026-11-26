import { spawn } from 'node:child_process'
import type { ExecLimit, ExecResult } from './verify-draft.js'

// How `verify-draft` runs a command: in its own process group, with a time limit, and with every
// group it started ended when `verify-draft` is stopped or exits.

const MAX_BUFFER = 256 * 1024 * 1024

/** How long a timed-out command's process group has between `SIGTERM` and `SIGKILL`. */
export const KILL_GRACE_MS = 10_000

/** Sends `signal` to the process group `pgid`; a group that is already gone is not an error. */
function signalGroup(pgid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pgid, signal)
  } catch {
    // the group is gone
  }
}

/** Whether a process of the group `pgid` is still there. */
function groupAlive(pgid: number): boolean {
  try {
    process.kill(-pgid, 0)
    return true
  } catch {
    return false
  }
}

/** The signals that end `verify-draft`, which it passes on to the process groups of its runs. */
const STOP_SIGNALS: NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGHUP']

/**
 * The process groups of the runs in progress, each with the promise of its command's end. A group
 * that outlives its command stays: until its `SIGKILL` is sent when the run timed out, else until
 * `verify-draft` exits, which sends it `SIGKILL` (`leftovers`).
 */
const running = new Map<number, Promise<void>>()
/** Set by `stop`: no run starts after it. */
let stopping = false

/**
 * Ends `verify-draft` on `signal` the way it would have ended without a run in progress, after the
 * runs' groups: a run's group is not ours (it is `detached`), so `herdr/factory-slot.sh run`, which
 * signals its own group, would never reach it. Each group gets `signal`, then `SIGKILL` after
 * `KILL_GRACE_MS` unless it is gone, and then the process raises `signal` again with no listener.
 */
function stop(signal: NodeJS.Signals): void {
  stopping = true
  for (const name of STOP_SIGNALS) process.removeListener(name, stop)
  const groups = [...running.keys()]
  for (const pgid of groups) signalGroup(pgid, signal)
  let raised = false
  const raise = (): void => {
    if (raised) return
    raised = true
    for (const pgid of groups) signalGroup(pgid, 'SIGKILL')
    process.kill(process.pid, signal)
  }
  const kill = setTimeout(raise, KILL_GRACE_MS)
  const ended = [...running.values()]
  void (async () => {
    await Promise.all(ended)
    if (groups.every((pgid) => !groupAlive(pgid))) {
      clearTimeout(kill)
      raise()
    }
  })()
}

/** On exit, ends the groups still recorded: processes a command left behind, which no slot reaches. */
function leftovers(): void {
  for (const pgid of running.keys()) signalGroup(pgid, 'SIGKILL')
}

/** Records the group of a run; the first one makes `stop` listen for `STOP_SIGNALS` and `leftovers` for the exit. */
function track(pgid: number, ended: Promise<void>): void {
  if (running.size === 0) {
    for (const name of STOP_SIGNALS) process.on(name, stop)
    process.on('exit', leftovers)
  }
  running.set(pgid, ended)
}

/** Forgets the group of a run that is gone; the last one removes the listeners. */
function untrack(pgid: number): void {
  if (!running.delete(pgid)) return
  if (running.size === 0) {
    for (const name of STOP_SIGNALS) process.removeListener(name, stop)
    process.removeListener('exit', leftovers)
  }
}

/**
 * The real `VerifyDraftDeps.exec`, on `spawn`: as `execFile` with a `maxBuffer` of 256 MiB (a stream
 * that passes it ends the command, code 1), plus the process group and the time limit of `limit`.
 */
export const execInGroup = (
  file: string,
  args: string[],
  cwd: string,
  limit?: ExecLimit
): Promise<ExecResult> =>
  new Promise<ExecResult>((resolve) => {
    if (stopping) {
      resolve({ code: 1, output: '' })
      return
    }
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    const size = { stdout: 0, stderr: 0 }
    let failed = false
    let timedOut = false
    let settled = false
    let kill: NodeJS.Timeout | undefined
    const child = spawn(file, args, {
      cwd,
      detached: limit !== undefined,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const pgid = limit === undefined ? undefined : child.pid
    let closed = (): void => undefined
    if (pgid !== undefined) {
      track(
        pgid,
        new Promise<void>((done) => {
          closed = done
        })
      )
    }
    const end = (signal: NodeJS.Signals): void => {
      if (pgid === undefined) child.kill(signal)
      else signalGroup(pgid, signal)
    }
    const collect =
      (name: 'stdout' | 'stderr', chunks: Buffer[]) =>
      (chunk: Buffer): void => {
        size[name] += chunk.length
        if (size[name] > MAX_BUFFER) {
          if (!failed) end('SIGTERM')
          failed = true
          return
        }
        chunks.push(chunk)
      }
    child.stdout.on('data', collect('stdout', stdout))
    child.stderr.on('data', collect('stderr', stderr))
    const timer =
      limit === undefined
        ? undefined
        : setTimeout(() => {
            timedOut = true
            end('SIGTERM')
            kill = setTimeout(() => {
              end('SIGKILL')
              if (pgid !== undefined) untrack(pgid)
              // A process that left the group may still hold the pipes: stop waiting for them.
              child.stdout.destroy()
              child.stderr.destroy()
            }, limit.graceMs)
          }, limit.timeoutMs)
    const finish = (code: number): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      // The command ended, but a process it started may still run (or ignore the SIGTERM): the
      // SIGKILL stays due and the group stays recorded unless the whole group is gone.
      const lingers = pgid !== undefined && groupAlive(pgid)
      if (kill !== undefined && !lingers) clearTimeout(kill)
      if (pgid !== undefined && !lingers) untrack(pgid)
      closed()
      resolve({
        code: failed ? 1 : code,
        output: `${Buffer.concat(stdout).toString('utf8')}${Buffer.concat(stderr).toString('utf8')}`,
        ...(timedOut ? { timedOut } : {}),
      })
    }
    child.on('error', () => {
      failed = true
      finish(1)
    })
    child.on('close', (code) => finish(code ?? 1))
  })
