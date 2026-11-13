import { chmod, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { tempDir } from '../../../test/support/temp.js'
import { GhError, MARKER, applyReadiness, defaultGh, neutralise, runReady } from '../src/ready.js'
import type { Gh, ReadyParams } from '../src/ready.js'
import { backfillFields, parseProjectFields, runBackfill } from '../src/fields.js'
import type { ProjectFields } from '../src/fields.js'

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
    report: '**lint-issue** · `o/r#7` · 2026-10-24 · all 8 rules pass\n',
    project: { owner: 'bogd3v', number: 1 },
    readyStatus: 'Ready',
    notReadyStatus: 'Todo',
    author: 'micelio-bot[bot]',
    association: 'MEMBER',
    state: 'open',
    ...over,
  }
}

const FAILING = '**lint-issue** · `o/r#7` · 2026-10-24 · 1 of 8 rules fail\n\n- `delivery`: x.\n'
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
    const dir = tempDir('fake-gh-')
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

const RELEASE_LINE = 'PVTSSF_lADOE_m_z84Bn8wbzhnB4l0'
const FRONT = 'PVTSSF_lADOE_m_z84Bn8wbzhnB4kw'
const CORTE = 'Micelio · Corte 0.7 — El sitio y el fediverso'
const CONFIG: ProjectFields = {
  [CORTE]: { releaseLine: '0.7', front: 'Plugin core' },
}

type Value = { optionId: string; name: string } | null
/** The shape of `issue-fields.json`'s data. */
interface IssueData {
  repository: {
    issue: {
      milestone: { title: string } | null
      projectItems: { nodes: { releaseLine: Value; front: Value }[] }
    }
  }
}
/** The shape of the recorded project's data. */
interface ProjectData {
  organization: {
    projectV2: { fields: { nodes: { name?: string; options?: { name: string }[] }[] } }
  }
}

interface IssueFields {
  /** The milestone title; `null` for none (default: the recorded one, "Corte 0.7"). */
  milestone?: string | null
  /** Whether the issue is an item of the project (default: yes). */
  item?: boolean
  releaseLine?: { optionId: string; name: string } | null
  front?: { optionId: string; name: string } | null
}

/**
 * `fake` plus the issue's milestone and field values, from `issue-fields.json`: the answer for
 * bogd3v/micelio-cms#418 read on 2026-11-06, an item with neither field set.
 */
async function withFields(world: World, issue: IssueFields = {}): Promise<ReturnType<typeof fake>> {
  const recorded = await readFile(new URL('issue-fields.json', FIXTURES), 'utf8')
  const base = fake(world)
  const graphql = base.gh.graphql
  base.gh.graphql = async (query, variables) => {
    if (!query.includes('releaseLine:')) return graphql(query, variables)
    const data = (JSON.parse(recorded) as { data: IssueData }).data
    const node = data.repository.issue
    if (issue.milestone !== undefined)
      node.milestone = issue.milestone === null ? null : { title: issue.milestone }
    if (issue.item === false) node.projectItems.nodes = []
    if (issue.releaseLine) node.projectItems.nodes[0].releaseLine = issue.releaseLine
    if (issue.front) node.projectItems.nodes[0].front = issue.front
    return data
  }
  return base
}

/** The writes to Release line or Front, as `field option`. */
function fieldWrites(writes: string[]): string[] {
  return writes
    .filter((w) => w.includes(RELEASE_LINE) || w.includes(FRONT))
    .map((w) => {
      const v = JSON.parse(w.slice('status '.length)) as { field: string; option: string }
      return `${v.field === RELEASE_LINE ? 'Release line' : 'Front'} ${v.option}`
    })
}

describe('Release line and Front', () => {
  it("sets Release line and Front from the milestone's entry", async () => {
    const { gh, writes } = await withFields({
      labelled: false,
      current: todo,
      project: await recorded('project-with-ready.json'),
    })
    const done = await applyReadiness(gh, params({ fields: CONFIG }))
    expect(done).toEqual([
      'label ready added',
      'status set to Ready',
      'Release line set to 0.7',
      'Front set to Plugin core',
    ])
    expect(fieldWrites(writes)).toEqual(['Release line 9fa44fbc', 'Front 61f3d615'])
  })

  it('keeps a field that already has a value', async () => {
    const { gh, writes } = await withFields(
      { labelled: false, current: todo, project: await recorded('project-with-ready.json') },
      { releaseLine: { optionId: 'f0546171', name: '0.6' } }
    )
    const done = await applyReadiness(gh, params({ fields: CONFIG }))
    expect(done.slice(-2)).toEqual(['Release line left as it is (0.6)', 'Front set to Plugin core'])
    expect(fieldWrites(writes)).toEqual(['Front 61f3d615'])
  })

  it('a milestone with no entry changes nothing and says so', async () => {
    const { gh, writes } = await withFields(
      { labelled: false, current: todo, project: await recorded('project-with-ready.json') },
      { milestone: 'Micelio · Otra' }
    )
    const done = await applyReadiness(gh, params({ fields: CONFIG }))
    expect(done.at(-1)).toBe(
      'fields left alone: the milestone "Micelio · Otra" has no entry in .github/project-fields.json'
    )
    expect(fieldWrites(writes)).toEqual([])
  })

  it('frontByRepository wins over front for that repository', async () => {
    const { gh, writes } = await withFields({
      labelled: false,
      current: todo,
      project: await recorded('project-with-ready.json'),
    })
    const fields = {
      [CORTE]: { ...CONFIG[CORTE]!, frontByRepository: { r: 'Fediverse', x: 'Themes' } },
    }
    const done = await applyReadiness(gh, params({ fields }))
    expect(done.at(-1)).toBe('Front set to Fediverse')
    expect(fieldWrites(writes)).toEqual(['Release line 9fa44fbc', 'Front b66c961e'])
  })

  it('an issue with no milestone, or not in the project, changes nothing and says so', async () => {
    const project = await recorded('project-with-ready.json')
    const none = await withFields({ labelled: false, current: todo, project }, { milestone: null })
    const done = await applyReadiness(none.gh, params({ fields: CONFIG }))
    expect(done.at(-1)).toBe('fields left alone: the issue has no milestone')
    expect(fieldWrites(none.writes)).toEqual([])

    const out = await withFields({ labelled: false, item: false, project }, { item: false })
    const failed = await applyReadiness(
      out.gh,
      params({ passed: false, report: FAILING, fields: CONFIG })
    )
    expect(failed.at(-1)).toBe('fields left alone: not in the project')
    expect(fieldWrites(out.writes)).toEqual([])
  })

  it('a missing field or option fails before anything is written, naming it', async () => {
    const option = await withFields({ project: await recorded('project-with-ready.json') })
    const typo = { [CORTE]: { releaseLine: '0.7', front: 'Plugin' } }
    await expect(applyReadiness(option.gh, params({ fields: typo }))).rejects.toThrow(
      'the Front of project bogd3v/1 has no option "Plugin" (it has: Themes, Fediverse, Foundations, Plugin core, Builder); add it in the project settings'
    )
    expect(option.writes).toEqual([])

    const project = (await recorded('project-with-ready.json')) as { data: ProjectData }
    const nodes = project.data.organization.projectV2.fields.nodes as { name?: string }[]
    project.data.organization.projectV2.fields.nodes = nodes.filter(
      (n) => n.name !== 'Release line'
    )
    const field = await withFields({ project })
    await expect(applyReadiness(field.gh, params({ fields: CONFIG }))).rejects.toThrow(
      'project bogd3v/1 has no single-select field named "Release line"'
    )
    expect(field.writes).toEqual([])
  })

  it('runReady reads --project-fields and prints a line per field', async () => {
    const { gh } = await withFields({
      labelled: false,
      current: todo,
      project: await recorded('project-with-ready.json'),
    })
    const files: Record<string, string> = {
      'report.md': 'report\n',
      'f.json': JSON.stringify(CONFIG),
    }
    const args = [
      'issue-ready',
      'o/r#7',
      '--passed',
      'true',
      '--report',
      'report.md',
      '--project',
      'bogd3v/1',
    ]
    const result = await runReady(
      [
        ...args,
        '--author',
        'b[bot]',
        '--association',
        'MEMBER',
        '--state',
        'open',
        '--project-fields',
        'f.json',
      ],
      { gh, readText: async (path) => files[path] ?? '' }
    )
    expect(result.stdout).toBe(
      'label ready added\nstatus set to Ready\nRelease line set to 0.7\nFront set to Plugin core\n'
    )
  })

  it("names only options the recorded project has, in this repository's file", async () => {
    const file = new URL('../../../.github/project-fields.json', import.meta.url)
    const config = parseProjectFields(await readFile(file, 'utf8'))
    const project = (await recorded('project-with-ready.json')).data as ProjectData
    const options = (name: string): string[] =>
      (
        project.organization.projectV2.fields.nodes as {
          name?: string
          options?: { name: string }[]
        }[]
      )
        .find((n) => n.name === name)!
        .options!.map((o) => o.name)
    expect(Object.keys(config)).toContain(CORTE)
    for (const entry of Object.values(config)) {
      expect(options('Release line')).toContain(entry.releaseLine)
      for (const front of [entry.front, ...Object.values(entry.frontByRepository ?? {})])
        expect(options('Front')).toContain(front)
    }
  })

  it('rejects a file with the wrong shape', () => {
    expect(() => parseProjectFields('[]')).toThrow('the file must be an object of milestones')
    expect(() => parseProjectFields('{"m": {"front": "x"}}')).toThrow(
      '"m" needs releaseLine and front as strings'
    )
    expect(() =>
      parseProjectFields(
        '{"m": {"releaseLine": "0.7", "front": "x", "frontByRepository": {"r": 1}}}'
      )
    ).toThrow('frontByRepository of "m" must map names to strings')
  })
})

describe('the backfill', () => {
  /**
   * The milestones and open issues of bogd3v/micelio-plugin-fediverse read on 2026-11-06 (trimmed to
   * the keys the backfill reads), a pull request added, and `issue-fields.json` for each issue.
   */
  async function world(
    over: { values?: Record<number, { optionId: string; name: string }> } = {}
  ): Promise<{ gh: Gh; writes: string[] }> {
    const milestones = JSON.parse(
      await readFile(new URL('fediverse-milestones.json', FIXTURES), 'utf8')
    ) as unknown[]
    const issues = JSON.parse(
      await readFile(new URL('fediverse-issues.json', FIXTURES), 'utf8')
    ) as unknown[]
    const issue = await readFile(new URL('issue-fields.json', FIXTURES), 'utf8')
    const project = await recorded('project-with-ready.json')
    const writes: string[] = []
    const gh: Gh = {
      rest: async (method, path) => {
        if (path.startsWith('/repos/bogd3v/micelio-plugin-fediverse/milestones?state=all'))
          return milestones
        if (path.startsWith('/repos/bogd3v/micelio-plugin-fediverse/issues?milestone=1&state=open'))
          return [...issues, { number: 9, pull_request: {} }]
        if (path.startsWith('/repos/bogd3v/micelio-themes/milestones')) return []
        writes.push(`${method} ${path}`)
        return []
      },
      graphql: async (query, variables) => {
        if (query.includes('projectV2(number')) return project.data
        if (query.includes('releaseLine:')) {
          const data = (JSON.parse(issue) as { data: IssueData }).data
          const value = over.values?.[variables.number as number]
          if (value) data.repository.issue.projectItems.nodes[0].releaseLine = value
          return data
        }
        writes.push(`status ${JSON.stringify(variables)}`)
        return {}
      },
    }
    return { gh, writes }
  }

  const config: ProjectFields = {
    [CORTE]: {
      releaseLine: '0.7',
      front: 'Plugin core',
      frontByRepository: { 'micelio-plugin-fediverse': 'Fediverse' },
    },
  }

  it('sets both fields on every open issue of the milestone, keeping a value set by hand', async () => {
    const { gh, writes } = await world({ values: { 5: { optionId: 'f0546171', name: '0.6' } } })
    const done = await backfillFields(gh, {
      project: { owner: 'bogd3v', number: 1 },
      milestone: CORTE,
      config,
      repositories: ['micelio-plugin-fediverse', 'micelio-themes'],
    })
    expect(done[0]).toBe(`bogd3v/micelio-themes: no milestone "${CORTE}"`)
    expect(done).toContain('bogd3v/micelio-plugin-fediverse#6: Release line set to 0.7')
    expect(done).toContain('bogd3v/micelio-plugin-fediverse#6: Front set to Fediverse')
    expect(done).toContain('bogd3v/micelio-plugin-fediverse#5: Release line left as it is (0.6)')
    expect(done.some((line) => line.includes('#9'))).toBe(false)
    expect(fieldWrites(writes)).toHaveLength(11)
    expect(fieldWrites(writes).filter((w) => w.startsWith('Front'))).toEqual(
      Array.from({ length: 6 }, () => 'Front b66c961e')
    )
  })

  it('a milestone with no entry, or a missing option, writes nothing', async () => {
    const { gh, writes } = await world()
    const params = {
      project: { owner: 'bogd3v', number: 1 },
      repositories: ['micelio-plugin-fediverse'],
    }
    await expect(backfillFields(gh, { ...params, milestone: 'Otra', config })).resolves.toEqual([
      'nothing changed: the milestone "Otra" has no entry in .github/project-fields.json',
    ])
    const typo = { [CORTE]: { releaseLine: '0.9', front: 'Fediverse' } }
    await expect(backfillFields(gh, { ...params, milestone: CORTE, config: typo })).rejects.toThrow(
      'the Release line of project bogd3v/1 has no option "0.9"'
    )
    expect(writes).toEqual([])
  })

  it('runBackfill reads its arguments and the file, and rejects missing ones', async () => {
    const { gh } = await world()
    const ok = await runBackfill(
      [
        'project-fields-backfill',
        '--milestone',
        CORTE,
        '--project',
        'bogd3v/1',
        '--project-fields',
        'f.json',
        '--repositories',
        'micelio-themes',
      ],
      { gh, readText: async () => JSON.stringify(config) }
    )
    expect(ok).toEqual({
      code: 0,
      stdout: `bogd3v/micelio-themes: no milestone "${CORTE}"\n`,
      stderr: '',
    })
    const bad = await runBackfill(['project-fields-backfill', '--milestone', CORTE], {
      gh,
      readText: async () => '',
    })
    expect(bad.code).toBe(2)
    expect(bad.stderr).toContain('--project-fields and --repositories are required')
  })
})
