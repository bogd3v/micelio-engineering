import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { createAdapters, readConfig } from '../herdr/mod/factory/adapters.js'
import { buildGithub, buildPanel } from '../herdr/mod/factory/lib/panel.js'
import {
  backoffOf,
  COMMENTS_MAX_AGE_MS,
  createRateLimitWatch,
  paceOf,
  parseReply,
  readsNow,
  secondaryOf,
} from '../herdr/mod/factory/lib/quota.js'
import { buildState } from '../herdr/mod/factory/lib/state.js'

const REPO = 'bogd3v/micelio-engineering'
const SPACE = { name: 'micelio-engineering', repo: REPO, milestone: 11, epic: null }
const CONFIG = readConfig({
  checkout: '/x',
  maintainer: 'ale9420',
  dockerHost: '',
  fixture: null,
  spaces: [SPACE],
})
const RESET = 1_795_641_631
const T0 = (RESET - 3000) * 1000

/**
 * A GitHub that answers `gh api <endpoint> --include` as `gh` 2.97.0 does: a `200` with an `Etag` and the
 * rate-limit headers, or, for an `If-None-Match` that is the current `Etag`, `gh: HTTP 304` on the
 * standard error, exit 1 and the status line and the headers on the standard output.
 */
function github(bodies: Record<string, unknown>, remaining = { value: 4000 }) {
  const calls: string[][] = []
  const version: Record<string, number> = {}
  const rate = () => `X-Ratelimit-Remaining: ${remaining.value}\r\nX-Ratelimit-Reset: ${RESET}\r\n`
  const exec = async (cmd: string, args: string[]) => {
    calls.push([cmd, ...args])
    const endpoint = String(args[1])
    const tag = `W/"${endpoint}-${version[endpoint] ?? 0}"`
    const sent = args.indexOf('--header') === -1 ? null : String(args[args.indexOf('--header') + 1])
    if (sent === `If-None-Match: ${tag}`) {
      return {
        code: 1,
        stdout: `HTTP/2.0 304 Not Modified\r\nEtag: ${tag}\r\n${rate()}\r\n`,
        stderr: 'gh: HTTP 304\n',
      }
    }
    remaining.value -= 1
    const body = JSON.stringify(bodies[endpoint] ?? [])
    return {
      code: 0,
      stdout: `HTTP/2.0 200 OK\r\nContent-Type: application/json\r\nEtag: ${tag}\r\n${rate()}\r\n${body}`,
      stderr: '',
    }
  }
  return { calls, exec, version, bodies }
}

const ISSUES = `repos/${REPO}/issues?milestone=11&state=all&per_page=100`
const PULLS = `repos/${REPO}/pulls?state=open&per_page=100`
const MILESTONES = `repos/${REPO}/milestones?state=all&per_page=100`
const issueComments = (n: number) => `repos/${REPO}/issues/${n}/comments?per_page=100`
const reviews = (n: number) => `repos/${REPO}/pulls/${n}/reviews?per_page=100`

function adaptersOf(
  exec: (cmd: string, args: string[]) => Promise<{ code: number; stdout: string; stderr: string }>,
  clock: { value: number }
) {
  return createAdapters({
    exec,
    readTextFile: async () => null,
    terminals: () => [],
    config: CONFIG,
    clock: () => clock.value,
  })
}

describe('the conditional requests of the mod', () => {
  it('a second read of an endpoint sends the Etag of the first as If-None-Match, and a 304 gives the body of the first', async () => {
    const g = github({ [MILESTONES]: [{ number: 11, title: 'm' }] })
    const a = adaptersOf(g.exec, { value: T0 })
    const first = await a.readMilestones([SPACE])
    expect(g.calls[0]).toEqual(['gh', 'api', MILESTONES, '--include'])
    const second = await a.readMilestones([SPACE])
    expect(g.calls[1]).toEqual([
      'gh',
      'api',
      MILESTONES,
      '--include',
      '--header',
      `If-None-Match: W/"${MILESTONES}-0"`,
    ])
    expect(second).toEqual(first)
    expect(second).toMatchObject({ byRepo: { [REPO]: [{ number: 11, title: 'm' }] } })
    // A body that changed has a new Etag: the next read gets its 200.
    g.version[MILESTONES] = 1
    g.bodies[MILESTONES] = [{ number: 11, title: 'changed' }]
    expect(await a.readMilestones([SPACE])).toMatchObject({
      byRepo: { [REPO]: [{ title: 'changed' }] },
    })
  })

  it('every gh call is gh api, the endpoint, --include and at most one If-None-Match header', async () => {
    const g = github({
      [ISSUES]: [{ number: 5, state: 'open', updated_at: 'a' }],
      [PULLS]: [{ number: 9, body: null, created_at: 'c', updated_at: 'p' }],
    })
    const clock = { value: T0 }
    const a = adaptersOf(g.exec, clock)
    for (let round = 0; round < 2; round += 1) {
      await a.readGithub(SPACE)
      await a.readPulls(SPACE)
      await a.readMilestones([SPACE])
      clock.value += 11 * 60_000
    }
    expect(g.calls.length).toBeGreaterThan(6)
    for (const call of g.calls) {
      expect(call[0]).toBe('gh')
      expect(call[1]).toBe('api')
      expect(call[2]).toMatch(/^repos\/bogd3v\/micelio-engineering\//)
      expect(call[3]).toBe('--include')
      expect(call.length === 4 || (call.length === 6 && call[4] === '--header')).toBe(true)
      if (call.length === 6) expect(call[5]).toMatch(/^If-None-Match: W\/"/)
      expect(call.join(' ')).not.toMatch(
        /--method|--field|--raw-field|--input|-X|-f |-F |Authorization/
      )
    }
    expect(g.calls.some((c) => c.length === 6)).toBe(true)
  })

  it('a second slow read of an unchanged milestone with one open pull request makes 3 gh calls, each answered 304', async () => {
    const g = github({
      [ISSUES]: [{ number: 5, state: 'open', updated_at: 'a' }],
      [PULLS]: [{ number: 9, body: 'Closes #5', created_at: 'c', updated_at: 'p' }],
    })
    const clock = { value: T0 }
    const a = adaptersOf(g.exec, clock)
    const slow = async () => {
      const read = await a.readGithub(SPACE)
      const pulls = await a.readPulls(SPACE)
      await a.readMilestones([SPACE])
      return { read, pulls }
    }
    const first = await slow()
    // 1 issues + 1 comments + 1 pulls + 2 for the pull request + 1 milestones.
    expect(g.calls).toHaveLength(6)
    g.calls.length = 0
    clock.value += 60_000
    const second = await slow()
    expect(g.calls.map((c) => c[2])).toEqual([ISSUES, PULLS, MILESTONES])
    expect(g.calls.every((c) => c[5]?.startsWith('If-None-Match: '))).toBe(true)
    expect(second.pulls).toEqual(first.pulls)
    expect({ ...second.read, at: '' }).toEqual({ ...first.read, at: '' })
  })

  it("an issue's comments are read again only when its updated_at changed or 10 minutes passed", async () => {
    const issues = [{ number: 5, state: 'open', updated_at: 'a' }]
    const g = github({ [ISSUES]: issues, [issueComments(5)]: [{ body: 'one' }] })
    const clock = { value: T0 }
    const a = adaptersOf(g.exec, clock)
    const commentCalls = () => g.calls.filter((c) => c[2] === issueComments(5)).length
    const first = (await a.readGithub(SPACE)) as { comments: Record<number, unknown> }
    expect(first.comments[5]).toEqual([{ body: 'one' }])
    expect(commentCalls()).toBe(1)
    clock.value += 60_000
    const again = (await a.readGithub(SPACE)) as { comments: Record<number, unknown> }
    expect(commentCalls()).toBe(1)
    expect(again.comments[5]).toEqual([{ body: 'one' }])
    // updated_at changed
    issues[0] = { number: 5, state: 'open', updated_at: 'b' }
    g.version[ISSUES] = 1
    g.version[issueComments(5)] = 1
    g.bodies[issueComments(5)] = [{ body: 'one' }, { body: 'two' }]
    clock.value += 60_000
    const changed = (await a.readGithub(SPACE)) as { comments: Record<number, unknown[]> }
    expect(commentCalls()).toBe(2)
    expect(changed.comments[5]).toHaveLength(2)
    // 10 minutes minus a second: still the last ones; 10 minutes: read again.
    clock.value += COMMENTS_MAX_AGE_MS - 1000
    await a.readGithub(SPACE)
    expect(commentCalls()).toBe(2)
    clock.value += 1000
    await a.readGithub(SPACE)
    expect(commentCalls()).toBe(3)
  })

  it("a pull request's comments and reviews are read again only when its updated_at changed or 10 minutes passed", async () => {
    const pulls = [{ number: 9, body: null, created_at: 'c', updated_at: 'p1' }]
    const g = github({
      [PULLS]: pulls,
      [issueComments(9)]: [{ body: 'c1' }],
      [reviews(9)]: [{ body: 'r1' }],
    })
    const clock = { value: T0 }
    const a = adaptersOf(g.exec, clock)
    const reads = () =>
      g.calls.filter((c) => c[2] === issueComments(9) || c[2] === reviews(9)).length
    const first = await a.readPulls(SPACE)
    expect(first).toEqual([
      {
        number: 9,
        issue: null,
        created_at: 'c',
        comments: [{ body: 'c1' }],
        reviews: [{ body: 'r1' }],
      },
    ])
    expect(reads()).toBe(2)
    clock.value += 60_000
    expect(await a.readPulls(SPACE)).toEqual(first)
    expect(reads()).toBe(2)
    pulls[0] = { number: 9, body: null, created_at: 'c', updated_at: 'p2' }
    g.version[PULLS] = 1
    clock.value += 60_000
    await a.readPulls(SPACE)
    expect(reads()).toBe(4)
    clock.value += COMMENTS_MAX_AGE_MS - 1000
    await a.readPulls(SPACE)
    expect(reads()).toBe(4)
    clock.value += 1000
    await a.readPulls(SPACE)
    expect(reads()).toBe(6)
  })
})

describe('the pace of the slow read', () => {
  it('the pace is normal at 500 remaining, slow below 500 until the reset, stopped at 0, and normal after the reset', () => {
    const now = (RESET - 600) * 1000
    expect(paceOf(null, now)).toBe('normal')
    expect(paceOf({ remaining: 500, reset: RESET }, now)).toBe('normal')
    expect(paceOf({ remaining: 499, reset: RESET }, now)).toBe('slow')
    expect(paceOf({ remaining: 1, reset: RESET }, now)).toBe('slow')
    expect(paceOf({ remaining: 0, reset: RESET }, now)).toBe('stopped')
    expect(paceOf({ remaining: 0, reset: RESET }, RESET * 1000 - 1)).toBe('stopped')
    expect(paceOf({ remaining: 0, reset: RESET }, RESET * 1000)).toBe('normal')
    expect(paceOf({ remaining: 3, reset: RESET }, RESET * 1000 + 5000)).toBe('normal')
    // The pace gives the reads: normal every tick, slow once in 5 minutes, stopped none.
    const read = (pace: 'normal' | 'slow' | 'stopped', lastAt: number | null, at = now) =>
      readsNow({ pace, lastAt, now: at, visible: true })
    expect(read('normal', now - 1)).toBe(true)
    expect(read('slow', null)).toBe(true)
    expect(read('slow', now - 299_999)).toBe(false)
    expect(read('slow', now - 300_000)).toBe(true)
    expect(read('stopped', null)).toBe(false)
  })

  it("a 403 with X-Ratelimit-Remaining 0 stops the GitHub reads until its reset and makes GitHub stale with gh's text", async () => {
    const clock = { value: T0 }
    let denied = false
    const exec = async (cmd: string, args: string[]) => {
      if (denied) {
        return {
          code: 1,
          stdout: `HTTP/2.0 403 Forbidden\r\nX-Ratelimit-Remaining: 0\r\nX-Ratelimit-Reset: ${RESET}\r\n\r\n{"message":"API rate limit exceeded"}`,
          stderr: 'gh: API rate limit exceeded for user ID 1. (HTTP 403)\n',
        }
      }
      return github({ [ISSUES]: [] }).exec(cmd, args)
    }
    const a = adaptersOf(exec, clock)
    let gh = buildGithub({
      now: clock.value,
      spaces: [SPACE],
      reads: { [SPACE.name]: await a.readGithub(SPACE) },
    })
    expect(paceOf(a.quota(), clock.value)).toBe('normal')
    denied = true
    clock.value += 60_000
    const failed = await a.readGithub(SPACE)
    expect(failed).toEqual({ error: 'gh: API rate limit exceeded for user ID 1. (HTTP 403)' })
    expect(a.quota()).toEqual({ remaining: 0, reset: RESET })
    gh = buildGithub({
      now: clock.value,
      spaces: [SPACE],
      previous: gh,
      reads: { [SPACE.name]: failed },
    })
    expect(gh.spaces[SPACE.name]?.stale).toBe(true)
    expect(gh.spaces[SPACE.name]?.error).toContain('API rate limit exceeded')
    // No read until the reset, then the pace is normal again.
    const pace = (at: number) => paceOf(a.quota(), at)
    expect(pace(clock.value)).toBe('stopped')
    expect(readsNow({ pace: pace(clock.value), lastAt: T0, now: clock.value, visible: true })).toBe(
      false
    )
    expect(pace(RESET * 1000 - 1)).toBe('stopped')
    expect(pace(RESET * 1000)).toBe('normal')
    // A 429 with the same header reads the same.
    expect(
      parseReply(
        'HTTP/2.0 429 Too Many Requests\r\nX-Ratelimit-Remaining: 0\r\nX-Ratelimit-Reset: 5\r\n\r\n'
      )
    ).toMatchObject({ status: 429, remaining: 0, reset: 5 })
  })

  it('no slow read while window().visible is false, and one on the first tick after it is true', () => {
    const now = T0
    const read = (visible: boolean | undefined, pace: 'normal' | 'slow' | 'stopped' = 'normal') =>
      readsNow({ pace, lastAt: null, now, visible })
    expect(read(false)).toBe(false)
    expect(read(false, 'slow')).toBe(false)
    expect(read(true)).toBe(true)
    // No window (herdr-app check): `window()?.visible` is undefined, and it reads.
    expect(read(undefined)).toBe(true)
    // Hidden ticks, then the first visible one reads.
    const ticks = [false, false, true, true].map((visible, i) =>
      readsNow({ pace: 'normal', lastAt: null, now: now + i * 60_000, visible })
    )
    expect(ticks).toEqual([false, false, true, true])
  })
})

describe('the header', () => {
  it("the header's sync label names the quota and the time to the reset while the pace is slow or stopped", () => {
    const state = buildState({ now: T0, fetched: {} })
    const label = (quota: { remaining: number; reset: number } | null, now = T0) =>
      buildPanel({ now, state, github: null, config: CONFIG, quota }).header.sync
    const plain = label(null).text
    expect(plain).toMatch(/^sync [^·]*$/)
    expect(label({ remaining: 500, reset: RESET }).text).toBe(plain)
    expect(label({ remaining: 120, reset: RESET }).text).toBe(`${plain} · quota 120 · slow 50 min`)
    expect(label({ remaining: 0, reset: RESET }).text).toBe(`${plain} · quota 0 · paused 50 min`)
    // At the reset the label is the plain one again.
    expect(label({ remaining: 0, reset: RESET }, RESET * 1000).text).toBe(plain)
    expect(label({ remaining: 120, reset: RESET }).stale).toBe(false)
  })
})

/**
 * What `gh api … --include` gives for an error reply, as `gh` 2.97.0 does: exit 1, the status line, the
 * headers and the body on the standard output, and `gh: <message> (HTTP <status>)` on the standard
 * error. `Retry-After` and the message of a secondary limit are as GitHub's REST documentation gives them.
 */
function refused(
  status: number,
  {
    retryAfter,
    remaining = 4000,
    message = 'You have exceeded a secondary rate limit.',
  }: { retryAfter?: number; remaining?: number; message?: string } = {}
) {
  const retry = retryAfter === undefined ? '' : `Retry-After: ${retryAfter}\r\n`
  return {
    code: 1,
    stdout: `HTTP/2.0 ${status} Refused\r\n${retry}X-Ratelimit-Remaining: ${remaining}\r\nX-Ratelimit-Reset: ${RESET}\r\n\r\n${JSON.stringify({ message })}`,
    stderr: `gh: ${message} (HTTP ${status})\n`,
  }
}

/** A GitHub whose next replies are the ones set in `next`, a `200` of an empty list when none is. */
function scripted() {
  const calls: string[][] = []
  const next: { value: { code: number; stdout: string; stderr: string } | null } = { value: null }
  const exec = async (cmd: string, args: string[]) => {
    calls.push([cmd, ...args])
    return next.value ?? { code: 0, stdout: 'HTTP/2.0 200 OK\r\n\r\n[]', stderr: '' }
  }
  return { calls, next, exec }
}

describe('a secondary rate limit', () => {
  it('a 403 or 429 of a secondary rate limit, with X-Ratelimit-Remaining above 0, pauses every gh call of the adapters for its Retry-After and runs no gh while paused', async () => {
    for (const status of [403, 429]) {
      const g = scripted()
      const clock = { value: T0 }
      const a = adaptersOf(g.exec, clock)
      expect(a.backoff()).toBeNull()
      g.next.value = refused(status, { retryAfter: 90, message: 'Slow down.' })
      expect(await a.readMilestones([SPACE])).toEqual({
        error: `gh: Slow down. (HTTP ${status})`,
      })
      expect(a.backoff()).toEqual({ until: T0 + 90_000, streak: 1 })
      g.next.value = null
      g.calls.length = 0
      clock.value = T0 + 89_999
      const paused = {
        error: `secondary rate limit: paused until ${new Date(T0 + 90_000).toISOString().slice(11, 16)}`,
      }
      expect(await a.readGithub(SPACE)).toEqual(paused)
      expect(await a.readMilestones([SPACE])).toEqual(paused)
      expect(await a.readRateLimit()).toEqual(paused)
      expect(await a.readPulls(SPACE)).toEqual([])
      expect(g.calls).toEqual([])
      clock.value = T0 + 90_000
      expect(await a.readMilestones([SPACE])).toHaveProperty('byRepo')
      expect(g.calls).toHaveLength(1)
      expect(a.backoff()).toBeNull()
    }
  })

  it('without Retry-After a secondary limit pauses 60 s, then 120, 240 and 480 s, never more than 15 minutes, and a 200 or a 304 ends the pause', async () => {
    const reply = (text: string) => parseReply(text)
    const secondary = reply(refused(403).stdout)
    expect(secondary.retryAfter).toBeNull()
    let backoff = null as ReturnType<typeof backoffOf>
    const waits = [60, 120, 240, 480, 900, 900]
    for (const [i, seconds] of waits.entries()) {
      backoff = backoffOf(backoff, secondary, T0)
      expect(backoff).toEqual({ until: T0 + seconds * 1000, streak: i + 1 })
    }
    // A reply that is neither a success nor a secondary limit changes nothing.
    expect(backoffOf(backoff, reply(refused(500).stdout), T0)).toBe(backoff)
    expect(backoffOf(backoff, reply(''), T0)).toBe(backoff)
    expect(backoffOf(backoff, reply('HTTP/2.0 200 OK\r\n\r\n[]'), T0)).toBeNull()
    expect(backoffOf(backoff, reply('HTTP/2.0 304 Not Modified\r\n\r\n'), T0)).toBeNull()
    // The message is matched whatever its case, and a 429 needs none.
    expect(secondaryOf(reply(refused(403, { message: 'SECONDARY Rate Limit' }).stdout))).toBe(true)
    expect(secondaryOf(reply(refused(429, { message: 'Too many' }).stdout))).toBe(true)
    // Through the adapters: each secondary reply after a pause doubles it, and a success starts over.
    const g = scripted()
    const clock = { value: T0 }
    const a = adaptersOf(g.exec, clock)
    for (const seconds of [60, 120]) {
      g.next.value = refused(403)
      await a.readMilestones([SPACE])
      expect(a.backoff()?.until).toBe(clock.value + seconds * 1000)
      clock.value += seconds * 1000
    }
    g.next.value = null
    await a.readMilestones([SPACE])
    expect(a.backoff()).toBeNull()
    g.next.value = refused(403)
    await a.readMilestones([SPACE])
    expect(a.backoff()).toEqual({ until: clock.value + 60_000, streak: 1 })
  })

  it('a 200 or a 304 of a gh call that was already running when a secondary reply set the pause does not end it', async () => {
    for (const late of [
      { code: 0, stdout: 'HTTP/2.0 200 OK\r\n\r\n[]', stderr: '' },
      { code: 1, stdout: 'HTTP/2.0 304 Not Modified\r\n\r\n', stderr: 'gh: HTTP 304\n' },
    ]) {
      // Each call stays running until the test answers it.
      const running: ((reply: typeof late) => void)[] = []
      const exec = () => new Promise<typeof late>((resolve) => running.push(resolve))
      const clock = { value: T0 }
      const a = adaptersOf(exec, clock)
      const first = a.readMilestones([SPACE])
      const second = a.readMilestones([SPACE])
      await expect.poll(() => running.length).toBe(2)
      running[0]?.(refused(403, { retryAfter: 90 }))
      await first
      running[1]?.(late)
      await second
      expect(a.backoff()).toEqual({ until: T0 + 90_000, streak: 1 })
      await a.readMilestones([SPACE])
      expect(running).toHaveLength(2)
      // A call started after the pause ran out ends it.
      clock.value = T0 + 90_000
      const after = a.readMilestones([SPACE])
      await expect.poll(() => running.length).toBe(3)
      running[2]?.({ code: 0, stdout: 'HTTP/2.0 200 OK\r\n\r\n[]', stderr: '' })
      await after
      expect(a.backoff()).toBeNull()
    }
  })

  it('a 403 that is no rate limit, with no Retry-After, no secondary message and remaining above 0, pauses nothing', async () => {
    const g = scripted()
    const a = adaptersOf(g.exec, { value: T0 })
    g.next.value = refused(403, { message: 'Resource not accessible by integration' })
    await a.readMilestones([SPACE])
    await a.readMilestones([SPACE])
    expect(a.backoff()).toBeNull()
    expect(g.calls).toHaveLength(2)
    // Nor a body that is not JSON, nor a body of `null`, nor the primary limit, whatever it carries.
    for (const body of ['<html></html>', 'null', '{"message":7}']) {
      expect(secondaryOf(parseReply(`HTTP/2.0 403 Forbidden\r\n\r\n${body}`))).toBe(false)
    }
    for (const status of [403, 429]) {
      const primary = parseReply(refused(status, { remaining: 0, retryAfter: 60 }).stdout)
      expect(secondaryOf(primary)).toBe(false)
      expect(backoffOf(null, primary, T0)).toBeNull()
    }
  })

  it("the header's sync label says secondary and the time left while a secondary limit pauses the reads", () => {
    const state = buildState({ now: T0, fetched: {} })
    const sync = (extra: Partial<Parameters<typeof buildPanel>[0]> = {}) =>
      buildPanel({ now: T0, state, github: null, config: CONFIG, ...extra }).header.sync.text
    const plain = sync()
    const backoff = { until: T0 + 40_000, streak: 1 }
    expect(sync({ backoff })).toBe(`${plain} · secondary · paused 40 s`)
    expect(sync({ backoff: { until: T0 + 480_000, streak: 4 } })).toBe(
      `${plain} · secondary · paused 8 min`
    )
    expect(sync({ backoff: { until: T0, streak: 1 } })).toBe(plain)
    expect(sync({ backoff: null })).toBe(plain)
    // After the quota's own text, and after `GH STALE` too.
    expect(sync({ backoff, quota: { remaining: 120, reset: RESET } })).toBe(
      `${plain} · quota 120 · slow 50 min · secondary · paused 40 s`
    )
    const github = buildGithub({
      now: T0,
      spaces: [SPACE],
      reads: { [SPACE.name]: { error: 'secondary rate limit: paused until 12:00' } },
    })
    expect(sync({ backoff, github })).toMatch(/^GH STALE .* · secondary · paused 40 s$/)
  })
})

describe('the GraphQL points', () => {
  it('rate_limit is read with gh api rate_limit --include at most once every 5 minutes, never while paused or hidden, and the label names the GraphQL points left below 500 and the time to their reset', async () => {
    // The fields of `.resources.graphql` as `gh api rate_limit --include` prints them.
    const points = { value: 499 }
    const calls: string[][] = []
    const exec = async (cmd: string, args: string[]) => {
      calls.push([cmd, ...args])
      const graphql = { limit: 5000, used: 1, remaining: points.value, reset: RESET }
      return {
        code: 0,
        stdout: `HTTP/2.0 200 OK\r\nX-Ratelimit-Remaining: 4000\r\nX-Ratelimit-Reset: ${RESET}\r\n\r\n${JSON.stringify({ resources: { graphql } })}`,
        stderr: '',
      }
    }
    const clock = { value: T0 }
    const a = adaptersOf(exec, clock)
    const watch = createRateLimitWatch()
    const tick = (at: number, visible: boolean | undefined = true) => {
      clock.value = at
      return watch.tick({ backoff: null, now: at, visible, read: () => a.readRateLimit() })
    }
    expect(watch.graphql()).toBeNull()
    await tick(T0, false)
    expect(calls).toEqual([])
    await tick(T0)
    expect(calls).toEqual([['gh', 'api', 'rate_limit', '--include']])
    expect(watch.graphql()).toEqual({ remaining: 499, reset: RESET })
    await tick(T0 + 60_000)
    await tick(T0 + 299_999)
    expect(calls).toHaveLength(1)
    points.value = 12
    await tick(T0 + 300_000, undefined)
    expect(calls).toHaveLength(2)
    expect(watch.graphql()).toEqual({ remaining: 12, reset: RESET })
    // Never while paused, however old the last read is.
    await watch.tick({
      backoff: { until: T0 + 900_001, streak: 1 },
      now: T0 + 900_000,
      visible: true,
      read: () => a.readRateLimit(),
    })
    expect(calls).toHaveLength(2)
    // A read that fails keeps the last points.
    await watch.tick({
      backoff: null,
      now: T0 + 900_000,
      visible: true,
      read: async () => ({ error: 'gh: network error' }),
    })
    expect(watch.graphql()).toEqual({ remaining: 12, reset: RESET })

    const state = buildState({ now: T0, fetched: {} })
    const sync = (graphql: { remaining: number; reset: number } | null, now = T0) =>
      buildPanel({ now, state, github: null, config: CONFIG, graphql }).header.sync.text
    const plain = sync(null)
    expect(sync({ remaining: 500, reset: RESET })).toBe(plain)
    expect(sync({ remaining: 499, reset: RESET })).toBe(`${plain} · graphql 499 · reset 50 min`)
    expect(sync({ remaining: 0, reset: RESET })).toBe(`${plain} · graphql 0 · reset 50 min`)
    expect(sync({ remaining: 0, reset: RESET }, RESET * 1000)).toBe(plain)

    // A reply with no graphql resource is an error, and a fixture runs no program.
    expect(await adaptersOf(scripted().exec, { value: T0 }).readRateLimit()).toEqual({
      error: 'gh api rate_limit: no graphql resource',
    })
    const none = scripted()
    const fixture = createAdapters({
      exec: none.exec,
      readTextFile: async () => null,
      terminals: () => [],
      config: { ...CONFIG, fixture: ['/x'] },
    })
    expect(await fixture.readRateLimit()).toHaveProperty('error')
    expect(none.calls).toEqual([])

    // `main.js` runs only inside the app: its source shows that the slow read ticks the watch with the
    // pause and the window, and that the header is given both.
    const main = readFileSync(new URL('../herdr/mod/factory/main.js', import.meta.url), 'utf8')
    const slow = main.slice(main.indexOf('\n  slow(cx) {'), main.indexOf('\n  async readShare('))
    expect(slow).toMatch(
      /this\.rateLimit\.tick\(\{\s+backoff: this\.adapters\.backoff\(\),\s+now,\s+visible: window\(\)\?\.visible,[^}]*this\.adapters\.readRateLimit\(\)/
    )
    expect(main).toContain(
      'backoff: this.adapters.backoff(),\n      graphql: this.rateLimit.graphql(),'
    )
  })
})
