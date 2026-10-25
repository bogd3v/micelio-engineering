import { chmod, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { GhError, MARKER, applyReadiness, defaultGh, neutralise, runReady } from '../src/ready.js'
import type { Gh, ReadyParams } from '../src/ready.js'

const FIXTURES = new URL('./fixtures/ready/', import.meta.url)

/**
 * `project-today.json` is the answer of the organisation project read on 2026-10-24, before the
 * Ready option existed; `project-with-ready.json` is the same with the option added by hand.
 */
async function recorded(name: string): Promise<{ data: unknown }> {
  return JSON.parse(await readFile(new URL(name, FIXTURES), 'utf8')) as { data: unknown }
}

interface World {
  /** Whether the repository has the label. */
  label?: boolean
  /** Whether the issue has the label. */
  labelled?: boolean
  comments?: { id: number; login: string; body: string }[]
  /** Whether the issue already is an item of the project (default: yes). */
  item?: boolean
  /** The option id of the item's Status, or null if it has none. */
  current?: { optionId: string; name: string } | null
  project: { data: unknown }
}

/** A fake GitHub that answers from recorded shapes and keeps every call that changes something. */
function fake(world: World): { gh: Gh; writes: string[] } {
  const writes: string[] = []
  const gh: Gh = {
    rest: async (method, path, body) => {
      if (method === 'GET' && path === '/repos/o/r/labels/ready') {
        if (world.label === false) throw new GhError('Not Found (HTTP 404)', 404)
        return { name: 'ready' }
      }
      if (method === 'GET' && path.startsWith('/repos/o/r/issues/7/comments')) {
        const all = world.comments ?? []
        const page = Number(/[?&]page=(\d+)/.exec(path)?.[1])
        return all
          .slice((page - 1) * 100, page * 100)
          .map((c) => ({ id: c.id, body: c.body, user: { login: c.login, type: 'Bot' } }))
      }
      if (method === 'DELETE' && path === '/repos/o/r/issues/7/labels/ready') {
        writes.push('DELETE label')
        if (!world.labelled) throw new GhError('Label does not exist (HTTP 404)', 404)
        return []
      }
      writes.push(`${method} ${path} ${JSON.stringify(body)}`)
      return {}
    },
    graphql: async (query, variables) => {
      if (query.includes('projectV2(number')) return world.project.data
      if (query.includes('issue(number')) {
        const nodes =
          world.item === false ? [] : [{ id: 'PVTI_7', project: { id: 'PVT_kwDOE_m_z84Bn8wb' } }]
        return { repository: { issue: { id: 'I_7', projectItems: { nodes } } } }
      }
      if (query.includes('addProjectV2ItemById')) {
        writes.push('add to project')
        return { addProjectV2ItemById: { item: { id: 'PVTI_7' } } }
      }
      if (query.includes('fieldValueByName')) {
        return { node: { fieldValueByName: world.current ?? null } }
      }
      writes.push(`status ${JSON.stringify(variables)}`)
      return { updateProjectV2ItemFieldValue: { projectV2Item: { id: 'PVTI_7' } } }
    },
  }
  return { gh, writes }
}

function params(over: Partial<ReadyParams> = {}): ReadyParams {
  return {
    ref: { repo: 'o/r', number: 7 },
    passed: true,
    report: '**lint-issue** · `o/r#7` · 2026-10-24 · all 7 rules pass\n',
    project: { owner: 'bogd3v', number: 1 },
    readyStatus: 'Ready',
    notReadyStatus: 'Todo',
    author: 'micelio-bot[bot]',
    association: 'MEMBER',
    state: 'open',
    ...over,
  }
}

const FAILING = '**lint-issue** · `o/r#7` · 2026-10-24 · 1 of 7 rules fail\n\n- `delivery`: x.\n'
const ready = { optionId: 'a1b2c3d4', name: 'Ready' }
const todo = { optionId: 'f75ad846', name: 'Todo' }

describe('applyReadiness', () => {
  it('on a pass adds the label and sets Ready, without a comment it did not have', async () => {
    const { gh, writes } = fake({
      labelled: false,
      current: todo,
      project: await recorded('project-with-ready.json'),
    })
    const done = await applyReadiness(gh, params())
    expect(done).toEqual(['label ready added', 'status set to Ready'])
    expect(writes).toEqual([
      'POST /repos/o/r/issues/7/labels {"labels":["ready"]}',
      'add to project',
      'status {"project":"PVT_kwDOE_m_z84Bn8wb","item":"PVTI_7","field":"PVTSSF_lADOE_m_z84Bn8wbzhmfBh0","option":"a1b2c3d4"}',
    ])
  })

  it('on a fail removes the label, creates the one comment and moves a Ready issue back to Todo', async () => {
    const { gh, writes } = fake({
      labelled: true,
      current: ready,
      project: await recorded('project-with-ready.json'),
    })
    const done = await applyReadiness(gh, params({ passed: false, report: FAILING }))
    expect(done).toEqual(['label ready removed', 'comment created', 'status set to Todo'])
    expect(writes[1]).toBe(
      `POST /repos/o/r/issues/7/comments ${JSON.stringify({ body: `${MARKER}\n${FAILING}` })}`
    )
    expect(writes[2]).toBe(
      'status {"project":"PVT_kwDOE_m_z84Bn8wb","item":"PVTI_7","field":"PVTSSF_lADOE_m_z84Bn8wbzhmfBh0","option":"f75ad846"}'
    )
  })

  it('on a fail never adds the issue to the project', async () => {
    const { gh, writes } = fake({
      labelled: false,
      item: false,
      current: null,
      project: await recorded('project-with-ready.json'),
    })
    const done = await applyReadiness(gh, params({ passed: false, report: FAILING }))
    expect(done.at(-1)).toBe('not in the project, left alone')
    expect(writes.some((w) => w === 'add to project' || w.startsWith('status'))).toBe(false)
  })

  it('on a fail leaves an item on Todo or with no Status as it is', async () => {
    for (const current of [todo, null]) {
      const { gh, writes } = fake({
        labelled: false,
        current,
        project: await recorded('project-with-ready.json'),
      })
      const done = await applyReadiness(gh, params({ passed: false, report: FAILING }))
      expect(done.at(-1)).toMatch(/^status left as it is/)
      expect(writes.some((w) => w.startsWith('status'))).toBe(false)
    }
  })

  it('updates its own comment in place, on a fail and then on a pass', async () => {
    const comments = [
      { id: 1, login: 'someone', body: `${MARKER}\nforged` },
      { id: 2, login: 'micelio-bot[bot]', body: `${MARKER}\nold` },
    ]
    const world = {
      labelled: true,
      comments,
      current: todo,
      project: await recorded('project-with-ready.json'),
    }
    const failed = fake(world)
    await applyReadiness(failed.gh, params({ passed: false, report: FAILING }))
    expect(failed.writes).toContain(
      `PATCH /repos/o/r/issues/comments/2 ${JSON.stringify({ body: `${MARKER}\n${FAILING}` })}`
    )
    expect(failed.writes.filter((w) => w.startsWith('POST') && w.includes('comments'))).toEqual([])

    const passed = fake(world)
    await applyReadiness(passed.gh, params())
    expect(passed.writes.some((w) => w.startsWith('PATCH /repos/o/r/issues/comments/2'))).toBe(true)
    expect(passed.writes.some((w) => w.includes('/comments/1'))).toBe(false)
  })

  it('is idempotent: a second run with the same result changes nothing but the label call', async () => {
    const body = `${MARKER}\n${FAILING}`
    const { gh, writes } = fake({
      labelled: false,
      comments: [{ id: 2, login: 'micelio-bot[bot]', body }],
      current: todo,
      project: await recorded('project-with-ready.json'),
    })
    const done = await applyReadiness(gh, params({ passed: false, report: FAILING }))
    expect(done).toEqual([
      'label ready removed',
      'comment unchanged',
      'status left as it is (Todo)',
    ])
    expect(writes).toEqual(['DELETE label'])
  })

  it('creates the label when the repository lacks it', async () => {
    const { gh, writes } = fake({
      label: false,
      current: null,
      project: await recorded('project-with-ready.json'),
    })
    const done = await applyReadiness(gh, params())
    expect(done[0]).toBe('label ready created')
    expect(writes[0]).toContain('POST /repos/o/r/labels {"name":"ready","color":"0e8a16"')
  })

  it('finds its comment on a later page', async () => {
    const filler = Array.from({ length: 100 }, (_, i) => ({ id: 100 + i, login: 'x', body: 'hi' }))
    const { gh, writes } = fake({
      labelled: true,
      comments: [...filler, { id: 2, login: 'micelio-bot[bot]', body: `${MARKER}\nold` }],
      current: todo,
      project: await recorded('project-with-ready.json'),
    })
    await applyReadiness(gh, params({ passed: false, report: FAILING }))
    expect(writes.some((w) => w.startsWith('PATCH /repos/o/r/issues/comments/2'))).toBe(true)
  })

  it('leaves a Status the project set by itself', async () => {
    for (const passed of [true, false]) {
      const { gh, writes } = fake({
        labelled: true,
        current: { optionId: '47fc9ee4', name: 'In Progress' },
        project: await recorded('project-with-ready.json'),
      })
      const done = await applyReadiness(gh, params({ passed, report: FAILING }))
      expect(done.at(-1)).toBe('status left as it is (In Progress)')
      expect(writes.some((w) => w.startsWith('status'))).toBe(false)
    }
  })

  it('fails with a clear message, before changing anything, when the Ready option is missing', async () => {
    const { gh, writes } = fake({ project: await recorded('project-today.json') })
    await expect(applyReadiness(gh, params())).rejects.toThrow(
      'the Status of project bogd3v/1 has no option "Ready" (it has: Todo, In Progress, Done); add it in the project settings'
    )
    expect(writes).toEqual([])
  })

  it('fails when the project cannot be read', async () => {
    const { gh } = fake({ project: { data: { organization: { projectV2: null } } } })
    await expect(applyReadiness(gh, params())).rejects.toThrow('project bogd3v/1 not found')
  })

  it('never touches the issue body or another field', async () => {
    const { gh, writes } = fake({
      labelled: true,
      current: null,
      project: await recorded('project-with-ready.json'),
    })
    await applyReadiness(gh, params({ passed: false, report: FAILING }))
    expect(writes.join('\n')).not.toMatch(/PATCH \/repos\/o\/r\/issues\/7 /)
    expect(writes.join('\n')).not.toMatch(/PVTSSF_lADOE_m_z84Bn8wbzhnB4/)
  })

  it('creates the label once when another run created it first', async () => {
    const { gh } = fake({
      label: false,
      current: null,
      project: await recorded('project-with-ready.json'),
    })
    const rest = gh.rest
    gh.rest = async (method, path, body) => {
      if (method === 'POST' && path === '/repos/o/r/labels')
        throw new GhError('Validation Failed (HTTP 422)', 422)
      return rest(method, path, body)
    }
    const done = await applyReadiness(gh, params())
    expect(done[0]).toBe('label ready added')
  })

  it('neutralises mentions, images and raw HTML in a hostile report', async () => {
    const hostile =
      '- `depends`: @maintainer @org/team ![x](https://evil.test/p.png) <img src="https://evil.test/p.png"> &#64;user\n'
    const { gh, writes } = fake({
      labelled: true,
      current: todo,
      project: await recorded('project-with-ready.json'),
    })
    await applyReadiness(gh, params({ passed: false, report: hostile }))
    const posted = writes.find((w) => w.startsWith('POST /repos/o/r/issues/7/comments')) ?? ''
    const body = (JSON.parse(posted.slice(posted.indexOf('{'))) as { body: string }).body
    expect(body).not.toMatch(/@[a-z]/)
    expect(body).not.toContain('![')
    expect(body).toContain('@\u200dmaintainer')
    expect(body).not.toContain('<img')
    expect(body).toContain('&amp;#64;user')
    expect(neutralise('a@b')).toBe('a@\u200db')
  })
})

describe('who can trigger it', () => {
  const cases: [string, string, boolean][] = [
    ['OWNER', 'open', true],
    ['MEMBER', 'open', true],
    ['COLLABORATOR', 'open', true],
    ['CONTRIBUTOR', 'open', false],
    ['FIRST_TIME_CONTRIBUTOR', 'open', false],
    ['FIRST_TIMER', 'open', false],
    ['NONE', 'open', false],
    ['MEMBER', 'closed', false],
  ]
  for (const [association, state, allowed] of cases) {
    for (const passed of [true, false]) {
      it(`${association} ${state}, ${passed ? 'pass' : 'fail'}: ${allowed ? 'writes' : 'writes nothing'}`, async () => {
        const { gh, writes } = fake({
          labelled: true,
          current: todo,
          project: await recorded('project-with-ready.json'),
        })
        const done = await applyReadiness(
          gh,
          params({ passed, association, state, report: FAILING })
        )
        if (allowed) {
          expect(writes.length).toBeGreaterThan(0)
        } else {
          expect(done).toHaveLength(1)
          expect(done[0]).toMatch(/^skipped: /)
          expect(writes).toEqual([])
        }
      })
    }
  }

  it('skips before reading the project, so a missing option is not an error for an outsider', async () => {
    const { gh } = fake({ project: await recorded('project-today.json') })
    await expect(applyReadiness(gh, params({ association: 'NONE' }))).resolves.toHaveLength(1)
  })
})

describe('the gh adapter', () => {
  const saved = process.env.PATH
  afterEach(() => {
    process.env.PATH = saved
  })

  it('turns "gh: Not Found (HTTP 404)" on stderr into a GhError with status 404', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fake-gh-'))
    const script = join(dir, 'gh')
    await writeFile(
      script,
      '#!/bin/sh\ncat >/dev/null\necho "gh: Not Found (HTTP 404)" >&2\nexit 1\n'
    )
    await chmod(script, 0o755)
    process.env.PATH = `${dir}:${saved ?? ''}`
    let error: unknown
    try {
      await defaultGh.rest('GET', '/repos/o/r/labels/ready')
    } catch (caught) {
      error = caught
    }
    expect(error).toBeInstanceOf(GhError)
    expect((error as GhError).status).toBe(404)
  })
})

describe('runReady', () => {
  const args = [
    'issue-ready',
    'o/r#7',
    '--passed',
    'true',
    '--report',
    'report.md',
    '--project',
    'bogd3v/1',
    '--author',
    'micelio-bot[bot]',
    '--association',
    'MEMBER',
    '--state',
    'open',
  ]

  it('prints one line per change', async () => {
    const { gh } = fake({
      labelled: false,
      current: todo,
      project: await recorded('project-with-ready.json'),
    })
    const result = await runReady(args, { gh, readText: async () => 'report\n' })
    expect(result).toEqual({
      code: 0,
      stdout: 'label ready added\nstatus set to Ready\n',
      stderr: '',
    })
  })

  it('exits 2 with the reason on a missing option', async () => {
    const { gh } = fake({ project: await recorded('project-today.json') })
    const result = await runReady(args, { gh, readText: async () => 'report\n' })
    expect(result.code).toBe(2)
    expect(result.stderr).toMatch(/^error: the Status of project bogd3v\/1 has no option "Ready"/)
  })

  it('rejects wrong arguments', async () => {
    const { gh } = fake({ project: await recorded('project-today.json') })
    const bad = await runReady(['issue-ready', 'o/r#7', '--passed', 'maybe'], {
      gh,
      readText: async () => '',
    })
    expect(bad.code).toBe(2)
    expect(bad.stderr).toContain('--passed must be true or false')
  })
})
