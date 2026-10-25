import { spawnSync } from 'node:child_process'
import { readFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { issueFromMarkdown, sections } from '../src/issue.js'
import type { Issue, IssueRef } from '../src/issue.js'
import { RULE_IDS, lintIssue } from '../src/rules.js'
import type { RuleId } from '../src/rules.js'
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
      stdout: '**lint-issue** · `test/fixtures/pass.md` · 2026-10-24 · all 7 rules pass\n',
      stderr: '',
    })
  })

  it.each(RULE_IDS)(
    'fails test/fixtures/fail-%s.md with exit 1, naming only that rule',
    async (rule) => {
      const path = `test/fixtures/fail-${rule}.md`
      const result = await run(['lint-issue', '--file', path], deps())
      expect(result.code).toBe(1)
      expect(result.stdout.split('\n')[0]).toBe(
        `**lint-issue** · \`${path}\` · 2026-10-24 · 1 of 7 rules fail`
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
    const offline = (await failing(issue, {})).filter((rule) => rule !== 'depends-on')
    expect(offline).toEqual(failedRules(saved).filter((rule) => rule !== 'depends-on'))
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
      '## Acceptance criteria\n\n### Unit\n\n- [ ] `npm test` passes.\n\n## Out of scope'
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
    expect(result.stdout.split('\n')[0]).toBe(
      '**lint-issue** · `example/site#5` · 2026-10-24 · 1 of 7 rules fail'
    )
  })

  it('exits 2 on a bad target, a missing file or an unknown command', async () => {
    expect((await run(['lint-issue', 'example#5'], deps())).code).toBe(2)
    expect((await run(['lint-issue', '--file', 'test/fixtures/none.md'], deps())).code).toBe(2)
    expect((await run(['dashboard'], deps())).stderr).toContain('unknown command "dashboard"')
  })

  it('runs as the built bin with the exit codes of the report', () => {
    const pass = spawnSync('node', [CLI, 'lint-issue', '--file', 'test/fixtures/pass.md'], {
      cwd: PACKAGE,
      encoding: 'utf8',
    })
    expect(pass.status).toBe(0)
    expect(pass.stdout).toMatch(/all 7 rules pass\n$/)
    const fail = spawnSync('node', [CLI, 'lint-issue', '--file', 'test/fixtures/fail-title.md'], {
      cwd: PACKAGE,
      encoding: 'utf8',
    })
    expect(fail.status).toBe(1)
    expect(failedRules(fail.stdout)).toEqual(['title'])
  })
})
