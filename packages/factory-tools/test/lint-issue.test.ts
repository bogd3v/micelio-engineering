import { spawnSync } from 'node:child_process'
import { chmod, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { issueFromGh, issueFromMarkdown, sections } from '../src/issue.js'
import type { Issue, IssueRef } from '../src/issue.js'
import { RULE_IDS, lintIssue } from '../src/rules.js'
import type { RuleId } from '../src/rules.js'
import { issueLane, parseLanes } from '../src/lane.js'
import { run } from '../src/run.js'
import type { RunDeps } from '../src/run.js'

const PACKAGE = fileURLToPath(new URL('../', import.meta.url))
const FIXTURES = `${PACKAGE}test/fixtures/`
const PILOT = `${FIXTURES}builder-fase-1/`
const CLI = `${PACKAGE}dist/cli.js`

/** Offline dependencies: files from the fixtures folder, issues from `issues`, a fixed day. */
function deps(issues: Record<string, Issue & { closed?: boolean }> = {}): RunDeps {
  const find = (ref: IssueRef): Issue & { closed?: boolean } => {
    const issue = issues[`${ref.repo}#${ref.number}`]
    if (!issue) throw new Error(`no issue ${ref.repo}#${ref.number}`)
    return issue
  }
  return {
    readIssue: async (ref) => find(ref),
    isClosed: async (ref) => find(ref).closed === true,
    readText: (path) => readFile(new URL(path, `file://${PACKAGE}`), 'utf8'),
    readLanes: async () => null,
    today: () => '2026-10-24',
  }
}

async function fixture(name: string): Promise<string> {
  return readFile(`${FIXTURES}${name}`, 'utf8')
}

/** The rule ids a report names, in order. */
function failedRules(report: string): string[] {
  return [...report.matchAll(/^- `([a-z-]+)`/gm)].map((match) => match[1] ?? '')
}

/** `pass.md` with `old` replaced, as an issue of `example/site`. */
async function variant(old: string | RegExp, replacement: string): Promise<Issue> {
  const text = await fixture('pass.md')
  const changed = text.replace(old, replacement)
  expect(changed).not.toBe(text)
  return issueFromMarkdown(changed, 'example/site')
}

async function failing(issue: Issue, closed: Record<string, boolean> = {}): Promise<RuleId[]> {
  const results = await lintIssue(issue, async (ref) => {
    const state = closed[`${ref.repo}#${ref.number}`]
    if (state === undefined) throw new Error('not found')
    return state
  })
  return results.filter((item) => !item.ok).map((item) => item.rule)
}

describe('lint-issue on the fixtures', () => {
  it('passes test/fixtures/pass.md with exit 0', async () => {
    const result = await run(['lint-issue', '--file', 'test/fixtures/pass.md'], deps())
    expect(result).toEqual({
      code: 0,
      stdout:
        'lane: full\n**lint-issue** · `test/fixtures/pass.md` · 2026-10-24 · all 8 rules pass\n',
      stderr: '',
    })
  })

  it.each(RULE_IDS)(
    'fails test/fixtures/fail-%s.md with exit 1, naming only that rule',
    async (rule) => {
      const path = `test/fixtures/fail-${rule}.md`
      const result = await run(['lint-issue', '--file', path], deps())
      expect(result.code).toBe(1)
      expect(result.stdout.split('\n')[1]).toBe(
        `**lint-issue** · \`${path}\` · 2026-10-24 · 1 of 8 rules fail`
      )
      expect(failedRules(result.stdout)).toEqual([rule])
    }
  )

  it('has exactly one fail fixture per rule', async () => {
    const names = (await readdir(FIXTURES)).filter((name) => name.startsWith('fail-')).sort()
    expect(names).toEqual(RULE_IDS.map((rule) => `fail-${rule}.md`).sort())
  })
})

describe('the reports of milestone "Builder, fase 1"', async () => {
  const inputs = (await readdir(PILOT)).filter((name) => name.endsWith('.input.md'))

  it('has the nine inputs, each next to its report', async () => {
    expect(inputs).toHaveLength(9)
    const names = await readdir(PILOT)
    for (const input of inputs) expect(names).toContain(input.replace('.input.md', '.md'))
  })

  it.each(inputs)('%s fails the offline rules its report names', async (input) => {
    const issue = issueFromMarkdown(await readFile(`${PILOT}${input}`, 'utf8'), 'example/site')
    const saved = await readFile(`${PILOT}${input.replace('.input.md', '.md')}`, 'utf8')
    // The states of the dependencies come from GitHub on the day of the run, so they stay out.
    // The reports predate the `lane` rule, which needs a criterion they never had.
    const skipped = (rule: string): boolean => rule === 'depends-on' || rule === 'lane'
    const offline = (await failing(issue, {})).filter((rule) => !skipped(rule))
    expect(offline).toEqual(failedRules(saved).filter((rule) => !skipped(rule)))
  })
})

describe('the rules', () => {
  it('asks for `!` when the body has a BREAKING CHANGE: paragraph', async () => {
    const issue = await variant(
      '## Requirements\n',
      '## Requirements\n\nBREAKING CHANGE: renames it.\n'
    )
    expect(await failing(issue)).toEqual(['title'])
    expect(await failing({ ...issue, title: 'feat(widgets)!: a counter widget' })).toEqual([])
    const quoted = await variant(
      '## Requirements\n',
      '## Requirements\n\nA `!` when the body says "BREAKING CHANGE".\n'
    )
    expect(await failing(quoted)).toEqual([])
  })

  it.each([
    ['a plain line', 'BREAKING CHANGE: renames it.'],
    ['a bullet', '- BREAKING CHANGE: renames it.'],
    ['a numbered item', '1. BREAKING CHANGE: renames it.'],
    ['a bold bullet', '* **BREAKING CHANGE:** renames it.'],
  ])('asks for `!` when BREAKING CHANGE: is %s', async (_form, line) => {
    const issue = await variant('## Requirements\n', `## Requirements\n\n${line}\n`)
    expect(await failing(issue)).toEqual(['title'])
  })

  it('takes only the prefixes of the Task template', async () => {
    const issue = await variant(/^# .*$/m, '# feature: a counter widget')
    expect(await failing(issue)).toEqual(['title'])
    expect(await failing({ ...issue, title: 'fix: a counter widget' })).toEqual([])
  })

  it('names the missing and the empty Task parts', async () => {
    const issue = await variant('### Progress\n\nNothing yet.\n', '')
    const results = await lintIssue({ ...issue, body: `${issue.body}\n## Why\n` }, async () => true)
    expect(results.find((item) => item.rule === 'task-parts')?.detail).toBe(
      'Task parts missing "Progress"'
    )
    const empty = await variant('Nothing yet.', '<!-- later -->')
    const emptyResults = await lintIssue(empty, async () => true)
    expect(emptyResults.find((item) => item.rule === 'task-parts')?.detail).toBe(
      'Task parts empty "Progress"'
    )
  })

  it('counts `npm run` without a backtick as naming a command', async () => {
    const issue = await variant(
      '- [ ] `npm run test` passes with a unit test of `counter.ts`.',
      '- [ ] npm run test passes.'
    )
    expect(await failing(issue)).toEqual([])
  })

  it('asks for a file path and a document separately', async () => {
    const noPath = await variant(
      /`src\/widgets\/counter\.ts`|`docs\/widgets\.md`|`counter\.ts`/g,
      'it'
    )
    expect(await failing(noPath)).toEqual(['citations'])
    const results = await lintIssue(noPath, async () => true)
    expect(results.find((item) => item.rule === 'citations')?.detail).toBe(
      'the body cites no file path'
    )
    const standard = await variant(
      /ADR-0001 says|`docs\/widgets\.md`/g,
      'Section 4 of the standard says'
    )
    expect(await failing(standard)).toEqual([])
  })

  it('accepts an "Out of scope:" line instead of a section', async () => {
    const issue = await variant(
      '## Out of scope\n\nThe styling of the widget: example/site#2.\n',
      'Out of scope: the styling of the widget.\n'
    )
    expect(await failing(issue)).toEqual([])
  })

  it('fails while a "Depends on" issue is open, on its line or in its section', async () => {
    const line = await variant('Part of example/site#1.', 'Part of example/site#1. Depends on #3.')
    expect(await failing(line, { 'example/site#3': false })).toEqual(['depends-on'])
    expect(await failing(line, { 'example/site#3': true })).toEqual([])
    const heading = await variant(
      '### Progress',
      '## Depends on\n\nother/repo#9 and https://github.com/other/repo/issues/10\n\n### Progress'
    )
    const results = await lintIssue(heading, async (ref) => ref.number === 10)
    expect(results.find((item) => item.rule === 'depends-on')?.detail).toBe(
      'depends on other/repo#9 is open'
    )
  })

  it('reports a dependency it cannot read, or one with no repository', async () => {
    const issue = await variant('Part of example/site#1.', 'Depends on #3.')
    expect(await failing(issue)).toEqual(['depends-on'])
    const results = await lintIssue({ ...issue, repo: null }, async () => true)
    expect(results.find((item) => item.rule === 'depends-on')?.detail).toBe(
      'depends on #3 has no repository (read the file with `--repo owner/repo`)'
    )
  })

  it('ignores the empty "Depends on #." the template leaves and a quoted "Depends on"', async () => {
    const issue = await variant(
      'Part of example/site#1.',
      'Part of #. Depends on #.\n\nEvery "Depends on" issue, see #4.'
    )
    expect(await failing(issue)).toEqual([])
  })
})

describe('comments, code blocks, nesting and references', () => {
  /** The Requirements comment of `template/.github/ISSUE_TEMPLATE/task.md`, verbatim. */
  const TEMPLATE_COMMENT =
    '<!-- What must stay true: contracts that may not break (docs/engineering-standard.md, section 6), budgets, behaviour that existing sites keep. Say whether the change is breaking and what the version bump is (section 7). -->'

  it('does not count a citation inside an HTML comment', async () => {
    const text = await fixture('fail-citations.md')
    const issue = issueFromMarkdown(
      text.replace('## Requirements\n', `## Requirements\n\n${TEMPLATE_COMMENT}\n`),
      'example/site'
    )
    expect(await failing(issue)).toEqual(['citations'])
  })

  it('ignores BREAKING CHANGE: and Depends on inside a fenced block or a comment', async () => {
    const issue = await variant(
      '## Requirements\n',
      '## Requirements\n\n```text\nBREAKING CHANGE: an example commit\n- BREAKING CHANGE: another\nDepends on #3.\n```\n\n<!-- - BREAKING CHANGE: a note. Depends on #4. -->\n'
    )
    expect(await failing(issue)).toEqual([])
  })

  it('keeps the text of deeper subheadings in their part', async () => {
    const issue = await variant(
      /## Acceptance criteria\n\n[\s\S]*?\n\n## Out of scope/,
      '## Acceptance criteria\n\n### Unit\n\n- [ ] `npm test` passes.\n- [ ] Verified by the maintainer on the stack.\n\n## Out of scope'
    )
    expect(await failing(issue)).toEqual([])
  })

  it('still ends Delivery at its ### Progress', async () => {
    const issue = await variant(/## Delivery\n\n.*\n/, '## Delivery\n\n')
    const results = await lintIssue(issue, async () => true)
    expect(results.find((item) => item.rule === 'delivery')?.detail).toBe(
      'the "Delivery" section is empty'
    )
  })

  it('reads only the list right after "Depends on"', async () => {
    const issue = await variant(
      'Part of example/site#1.',
      'Depends on #3. Part of #1.\n\nDepends on #3 (see also #9); blocks #10.'
    )
    expect(await failing(issue, { 'example/site#3': true, 'example/site#1': false })).toEqual([])
  })

  it('matches a heading that starts with the part name', async () => {
    const issue = await variant(
      /## Why\n([\s\S]*)## Out of scope\n/,
      '## Why this matters\n$1## Out of scope (tracked in example/site#2)\n'
    )
    expect(await failing(issue)).toEqual([])
    const word = await variant('## Why\n', '## Whyever\n')
    expect(await failing(word)).toEqual(['task-parts'])
  })

  it('does not take Node.js or Vue.js for a file path', async () => {
    const text = (await fixture('pass.md')).replace(
      /`src\/widgets\/counter\.ts`|`docs\/widgets\.md`|`counter\.ts`/g,
      'Node.js'
    )
    const results = await lintIssue(issueFromMarkdown(text, 'example/site'), async () => true)
    expect(results.find((item) => item.rule === 'citations')?.detail).toBe(
      'the body cites no file path'
    )
  })

  it('puts one line of a gh error in the report', async () => {
    const issue = await variant('Part of example/site#1.', 'Depends on #3.')
    const error = Object.assign(new Error('Command failed: gh issue view 3\nmore'), {
      stderr: '\nGraphQL: Could not resolve to an issue (repository.issue)\nsecond line\n',
    })
    const results = await lintIssue(issue, async () => {
      throw error
    })
    expect(results.find((item) => item.rule === 'depends-on')?.detail).toBe(
      'depends on example/site#3 could not be read (GraphQL: Could not resolve to an issue (repository.issue))'
    )
  })

  it('closes a fence only on its own marker', () => {
    const body = '## Why\n\n````md\n```\n## Not a heading\n````\n\n## What to build\n\nIt.\n'
    expect(sections(body).map((part) => part.name)).toEqual(['why', 'what to build'])
  })

  it('refuses an owner that starts with "-"', async () => {
    expect((await run(['lint-issue', '-x/repo#5'], deps())).code).toBe(2)
    expect(
      (await run(['lint-issue', '--file', 'test/fixtures/pass.md', '--repo', '-x/r'], deps())).code
    ).toBe(2)
  })
})

describe('sections', () => {
  it('drops template comments and empty bullets, and skips headings in code blocks', () => {
    const body =
      '## Why\n\n<!-- fill me -->\n\n-\n\n## What to build\n\n```\n# not a heading\n```\n'
    expect(sections(body)).toEqual([
      { name: 'why', content: '' },
      { name: 'what to build', content: '```\n# not a heading\n```' },
    ])
  })
})

// An issue body may hold 65,536 characters. A regular expression that backtracks takes seconds
// (quadratic) to hours (cubic) on these lines; a linear pass takes a few milliseconds. 200 ms is
// far below the first and leaves a slow CI runner room above the second.
describe('linear time on a long line of an untrusted body', () => {
  const SPACES = ' '.repeat(65_000)
  const LIMIT_MS = 200

  async function within<T>(work: () => T | Promise<T>): Promise<T> {
    const start = performance.now()
    const value = await work()
    expect(performance.now() - start).toBeLessThan(LIMIT_MS)
    return value
  }

  it('reads a heading followed by a long run of spaces', async () => {
    const names = await within(() => sections(`# a${SPACES}!`).map((part) => part.name))
    expect(names).toEqual([`a${SPACES}!`])
  })

  it('reads the title line of a file followed by a long run of spaces', async () => {
    await within(() => {
      expect(() => issueFromMarkdown(`# a${SPACES}\rb\n`, null)).toThrow('# <title>')
    })
  })

  it('looks for a breaking change in a body of 65,000 line breaks', async () => {
    const issue = { title: 'feat: a', body: '\n'.repeat(65_000), repo: null }
    expect(await within(() => failing(issue))).not.toContain('title')
  })

  it('keeps a bullet with a long run of spaces before its text', async () => {
    const [why] = await within(() => sections(`## Why\n-${SPACES}x\n`))
    expect(why?.content).toBe(`-${SPACES}x`)
  })
})

describe('the command line', () => {
  it('reads an issue with gh when given owner/repo#n', async () => {
    const issue = issueFromMarkdown(await fixture('fail-delivery.md'), 'example/site')
    const result = await run(['lint-issue', 'example/site#5'], deps({ 'example/site#5': issue }))
    expect(result.code).toBe(1)
    expect(result.stdout.split('\n')[1]).toBe(
      '**lint-issue** · `example/site#5` · 2026-10-24 · 1 of 8 rules fail'
    )
  })

  it('exits 2 on a bad target, a missing file or an unknown command', async () => {
    expect((await run(['lint-issue', 'example#5'], deps())).code).toBe(2)
    expect((await run(['lint-issue', '--file', 'test/fixtures/none.md'], deps())).code).toBe(2)
    expect((await run(['dashboard'], deps())).stderr).toContain('unknown command "dashboard"')
  })

  it('runs as the built bin with the exit codes of the report', async () => {
    // A folder with no `AGENTS.md` and no repository: every issue is `full`.
    const cwd = await mkdtemp(join(tmpdir(), 'lint-issue-'))
    try {
      const pass = spawnSync('node', [CLI, 'lint-issue', '--file', `${FIXTURES}pass.md`], {
        cwd,
        encoding: 'utf8',
      })
      expect(pass.status).toBe(0)
      expect(pass.stdout).toMatch(/all 8 rules pass\n$/)
      const fail = spawnSync('node', [CLI, 'lint-issue', '--file', `${FIXTURES}fail-title.md`], {
        cwd,
        encoding: 'utf8',
      })
      expect(fail.status).toBe(1)
      expect(failedRules(fail.stdout)).toEqual(['title'])
    } finally {
      await rm(cwd, { recursive: true })
    }
  })
})

describe('the lanes of the own repository of the issue', () => {
  /** A `gh` on the PATH that answers `api repos/example/site/issues/5` with `issue` and the `AGENTS.md` call with `agents` (null: 404). */
  async function withFakeGh(
    issue: Issue,
    agents: string | null,
    check: (env: NodeJS.ProcessEnv) => void
  ): Promise<void> {
    const dir = await mkdtemp(join(tmpdir(), 'lint-issue-gh-'))
    try {
      await writeFile(join(dir, 'issue.json'), JSON.stringify(issue))
      if (agents !== null) await writeFile(join(dir, 'AGENTS.md'), agents)
      const script = [
        '#!/bin/sh',
        'case "$*" in',
        `  *contents/AGENTS.md*) ${agents === null ? 'echo "gh: Not Found (HTTP 404)" >&2; exit 1' : `cat "${dir}/AGENTS.md"`} ;;`,
        `  "api repos/example/site/issues/5") cat "${dir}/issue.json" ;;`,
        '  *) echo "unexpected: $*" >&2; exit 1 ;;',
        'esac',
        '',
      ].join('\n')
      await writeFile(join(dir, 'gh'), script)
      await chmod(join(dir, 'gh'), 0o755)
      check({ ...process.env, PATH: `${dir}:${process.env.PATH ?? ''}` })
    } finally {
      await rm(dir, { recursive: true })
    }
  }

  const lint = (env: NodeJS.ProcessEnv) =>
    // The working directory is this repository, whose `AGENTS.md` has a `## Lanes` block.
    spawnSync('node', [CLI, 'lint-issue', 'example/site#5'], {
      cwd: PACKAGE,
      encoding: 'utf8',
      env,
    })

  it('a repository whose AGENTS.md is not found keeps its issues full, whatever the checkout says', async () => {
    const issue = issueFromMarkdown(await fixture('pass.md'), 'example/site')
    await withFakeGh(issue, null, (env) => {
      const result = lint(env)
      expect(result.stderr).toBe('')
      expect(result.stdout.split('\n')[0]).toBe('lane: full')
      expect(result.status).toBe(0)
    })
  })

  it('reads the Lanes block of the repository of the issue through gh', async () => {
    const text = (await fixture('pass.md'))
      .replace(/(?:src\/widgets\/)?counter\.ts/g, 'docs/widgets.md')
      .replace('on the stack', 'by reading the diff')
    const issue = issueFromMarkdown(text, 'example/site')
    const agents = '## Lanes\n\nexpress: docs/**/*.md\n'
    await withFakeGh(issue, agents, (env) => {
      const result = lint(env)
      expect(result.stdout.split('\n')[0]).toBe('lane: express')
      expect(result.status).toBe(0)
    })
  })

  it('reads the AGENTS.md of the checkout only for --file', async () => {
    const seen: (string | null)[] = []
    const lanes = { ...deps(), readLanes: async (repo: string | null) => (seen.push(repo), null) }
    const issue = issueFromMarkdown(await fixture('pass.md'), 'example/site')
    await run(['lint-issue', 'example/site#5'], { ...lanes, readIssue: async () => issue })
    await run(['lint-issue', '--file', 'test/fixtures/pass.md'], lanes)
    expect(seen).toEqual(['example/site', null])
  })

  it('--file with --repo reads the lanes of that repository', async () => {
    const seen: (string | null)[] = []
    const lanes = { ...deps(), readLanes: async (repo: string | null) => (seen.push(repo), null) }
    await run(['lint-issue', '--file', 'test/fixtures/pass.md', '--repo', 'example/site'], lanes)
    expect(seen).toEqual(['example/site'])
  })

  it('the CLI with --file and --repo takes the lane from gh, not from the checkout', async () => {
    const issue = issueFromMarkdown(await fixture('pass.md'), 'example/site')
    await withFakeGh(issue, null, (env) => {
      // The working directory is this repository, whose `## Lanes` block would give `normal`.
      const result = spawnSync(
        'node',
        [CLI, 'lint-issue', '--file', `${FIXTURES}pass.md`, '--repo', 'example/site'],
        { cwd: PACKAGE, encoding: 'utf8', env }
      )
      expect(result.stderr).toBe('')
      expect(result.stdout.split('\n')[0]).toBe('lane: full')
      expect(result.status).toBe(0)
    })
  })
})

describe('the live form, over the REST API', () => {
  /**
   * Runs the built CLI on `example/site#5`, which depends on `#3`, with a `gh` that answers as
   * `gh api repos/<repo>/issues/<n>` does: the REST object, whose `state` is `open` or `closed`.
   * Any other call fails. Returns the report and the calls made.
   */
  async function live(
    state: 'open' | 'closed',
    pull?: { merged_at: string | null }
  ): Promise<{ stdout: string; stderr: string; status: number | null; calls: string[] }> {
    const issue = await variant('Part of example/site#1.', 'Depends on #3.')
    const dir = await mkdtemp(join(tmpdir(), 'lint-issue-rest-'))
    try {
      await writeFile(
        join(dir, '5.json'),
        JSON.stringify({ number: 5, title: issue.title, body: issue.body, state: 'open' })
      )
      await writeFile(
        join(dir, '3.json'),
        JSON.stringify({ number: 3, title: 'x', state, pull_request: pull })
      )
      const script = [
        '#!/bin/sh',
        `echo "$*" >> "${dir}/calls"`,
        'case "$*" in',
        '  *contents/AGENTS.md*) echo "gh: Not Found (HTTP 404)" >&2; exit 1 ;;',
        `  "api repos/example/site/issues/5") cat "${dir}/5.json" ;;`,
        `  "api repos/example/site/issues/3") cat "${dir}/3.json" ;;`,
        '  *) echo "unexpected: $*" >&2; exit 1 ;;',
        'esac',
        '',
      ].join('\n')
      await writeFile(join(dir, 'gh'), script, { mode: 0o755 })
      const result = spawnSync('node', [CLI, 'lint-issue', 'example/site#5'], {
        cwd: PACKAGE,
        encoding: 'utf8',
        env: { ...process.env, PATH: `${dir}:${process.env.PATH ?? ''}` },
      })
      const calls = (await readFile(join(dir, 'calls'), 'utf8')).trim().split('\n')
      return { stdout: result.stdout, stderr: result.stderr, status: result.status, calls }
    } finally {
      await rm(dir, { recursive: true })
    }
  }

  it('the live form reads the issue and the state of each dependency with gh api repos/<repo>/issues/<n> and runs no gh issue or graphql call', async () => {
    const { stderr, calls } = await live('closed')
    expect(stderr).toBe('')
    expect(calls).toEqual([
      'api repos/example/site/issues/5',
      'api -H Accept: application/vnd.github.raw repos/example/site/contents/AGENTS.md',
      'api repos/example/site/issues/3',
    ])
    for (const call of calls) expect(call).not.toMatch(/^issue|graphql/)
  })

  it('a dependency whose REST state is closed passes the depends-on rule, and one that is open fails it', async () => {
    const closed = await live('closed')
    expect(closed.stdout).not.toContain('`depends-on`')
    expect(closed.status).toBe(0)
    const open = await live('open')
    expect(open.stdout).toContain('`depends-on`: depends on example/site#3 is open.')
    expect(open.status).toBe(1)
  })

  it('a dependency that is a merged pull request fails depends-on, and one closed without merging passes it, as with gh issue view', async () => {
    const merged = await live('closed', { merged_at: '2026-11-26T20:35:34Z' })
    expect(merged.stdout).toContain('`depends-on`: depends on example/site#3 is open.')
    expect(merged.status).toBe(1)
    const unmerged = await live('closed', { merged_at: null })
    expect(unmerged.stdout).not.toContain('`depends-on`')
    expect(unmerged.status).toBe(0)
  })

  it('reads an issue whose REST body is null as one with an empty body', () => {
    expect(issueFromGh({ title: 'chore: x', body: null }, 'example/site')).toEqual({
      title: 'chore: x',
      body: '',
      repo: 'example/site',
    })
    expect(() => issueFromGh({ title: 'chore: x' }, 'example/site')).toThrow('no title or body')
  })
})

describe('the lane rule', () => {
  const AGENTS = [
    '## Lanes',
    '',
    'stack: src/**',
    'contract: api/**',
    'express: docs/**/*.md',
  ].join('\n')
  const globs = parseLanes(AGENTS)
  const READING = '- [ ] Verified by the maintainer by reading the diff.'
  const STACK = '- [ ] Verified by the maintainer on the stack.'

  /** `pass.md` with its maintainer criterion replaced by `criteria` and `path` named in What to build. */
  async function laneIssue(criteria: string[], path = 'docs/widgets.md'): Promise<Issue> {
    const text = (await fixture('pass.md'))
      .replace(`${STACK}\n`, criteria.map((line) => `${line}\n`).join(''))
      .replace(/(?:src\/widgets\/)?counter\.ts/g, path)
    return issueFromMarkdown(text, 'example/site')
  }

  async function laneResult(issue: Issue): Promise<{ ok: boolean; detail: string }> {
    const results = await lintIssue(issue, async () => true, globs)
    const found = results.find((item) => item.rule === 'lane')
    if (!found) throw new Error('no lane result')
    return found
  }

  it('lane passes a full issue verified on the stack', async () => {
    const stack = await laneIssue([STACK], 'src/widgets/counter.ts')
    expect((await laneResult(stack)).ok).toBe(true)
    const named = await laneIssue(
      ['- [ ] Verified by the maintainer on the run `AGENTS.md` names.'],
      'api/v1.yaml'
    )
    expect((await laneResult(named)).ok).toBe(true)
    // With no `## Lanes` block every issue is full, and the fixture passes as written.
    const plain = issueFromMarkdown(await fixture('pass.md'), 'example/site')
    expect(await failing(plain)).toEqual([])
  })

  it('lane fails an express issue that asks for the stack, and names the sentence it expected', async () => {
    const issue = await laneIssue([STACK])
    const result = await laneResult(issue)
    expect(result.ok).toBe(false)
    expect(result.detail).toBe(
      'the lane is express and the maintainer criterion does not read "Verified by the maintainer by reading the diff"'
    )
    expect((await laneResult(await laneIssue([READING]))).ok).toBe(true)
    const full = await laneIssue([READING], 'api/v1.yaml')
    expect((await laneResult(full)).detail).toBe(
      'the lane is full and the maintainer criterion does not read "Verified by the maintainer on the stack" (or "on the run `AGENTS.md` names")'
    )
  })

  it('lane fails an issue with no maintainer criterion, or with two', async () => {
    const none = await laneResult(await laneIssue([]))
    expect(none.ok).toBe(false)
    expect(none.detail).toBe(
      'the lane is express and the acceptance criteria have 0 items that start "Verified by the maintainer"; exactly one is needed, and it reads "Verified by the maintainer by reading the diff"'
    )
    const two = await laneResult(await laneIssue([READING, READING]))
    expect(two.ok).toBe(false)
    expect(two.detail).toContain('have 2 items')
  })

  /** An issue of `test/fixtures/lane/`, read against the globs of its `agents.md`. */
  async function raised(name: string): Promise<{ ok: boolean; detail: string }> {
    const issue = issueFromMarkdown(await fixture(`lane/${name}`), 'example/site')
    const results = await lintIssue(
      issue,
      async () => true,
      parseLanes(await fixture('lane/agents.md'))
    )
    const found = results.find((item) => item.rule === 'lane')
    if (!found) throw new Error('no lane result')
    return { ok: found.ok, detail: found.detail }
  }

  const FULL_EXPECTED =
    'the lane is full and the maintainer criterion does not read "Verified by the maintainer on the stack" (or "on the run `AGENTS.md` names")'

  it('the lane rule asks for the full criterion of a lane raised to full', async () => {
    expect(await raised('issue-raised-full.md')).toEqual({ ok: true, detail: '' })
    const text = (await fixture('lane/issue-raised-full.md')).replace(
      'on the stack',
      'by reading the diff'
    )
    const results = await lintIssue(
      issueFromMarkdown(text, 'example/site'),
      async () => true,
      parseLanes(await fixture('lane/agents.md'))
    )
    expect(results.find((item) => item.rule === 'lane')?.detail).toBe(FULL_EXPECTED)
  })

  it('the lane rule fails a Lane raised: line that does not raise, has no comment URL, or is not the only one', async () => {
    // Each fixture has the criterion of the lane it gets, so only the line can fail it.
    expect(await raised('issue-raised-equal.md')).toEqual({
      ok: false,
      detail: 'the raise to normal is not above normal: not applied',
    })
    expect(await raised('issue-raised-below.md')).toEqual({
      ok: false,
      detail: 'the raise to normal is not above full: not applied',
    })
    const unusable =
      'the `Lane raised:` line does not give a lane (`normal` or `full`) and then the URL of an issue comment'
    for (const name of [
      'issue-raised-no-url.md',
      'issue-raised-no-lane.md',
      'issue-raised-long-url.md',
    ]) {
      expect(await raised(name), name).toEqual({ ok: false, detail: unusable })
    }
    expect(await raised('issue-raised-twice.md')).toEqual({
      ok: false,
      detail: 'the body has 2 `Lane raised:` lines; at most one is allowed',
    })
  })

  it('an issue with no Lane raised: line gets the lane and the lane rule result it got before', async () => {
    const issue = await laneIssue([STACK])
    expect(issueLane(issue.title, issue.body, globs)).toEqual({
      lane: 'express',
      reasons: ['`docs/widgets.md` matches express: `docs/**/*.md`'],
      raiseProblem: '',
    })
    expect(await laneResult(issue)).toMatchObject({
      ok: false,
      detail:
        'the lane is express and the maintainer criterion does not read "Verified by the maintainer by reading the diff"',
    })
    expect(await raised('issue-raised-quoted.md')).toEqual({ ok: true, detail: '' })
  })

  it('the report starts with the lane', async () => {
    const result = await run(['lint-issue', '--file', 'test/fixtures/fail-lane.md'], deps())
    expect(result.code).toBe(1)
    expect(result.stdout.split('\n')[0]).toBe('lane: full')
    expect(failedRules(result.stdout)).toEqual(['lane'])
    const express = await run(['lint-issue', 'example/site#9'], {
      ...deps({ 'example/site#9': await laneIssue([READING]) }),
      readLanes: async () => globs,
    })
    expect(express.code).toBe(0)
    expect(express.stdout.split('\n')[0]).toBe('lane: express')
  })
})
