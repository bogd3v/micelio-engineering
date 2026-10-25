import { spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const FIXTURES = join(ROOT, 'fixtures/factory')
const BUILD = join(FIXTURES, 'build-scratch.sh')

/** Every temporary directory the tests make, removed after the file. */
const TEMP: string[] = []
afterAll(() => {
  for (const dir of TEMP) rmSync(dir, { recursive: true, force: true })
})

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  TEMP.push(dir)
  return dir
}

interface Run {
  code: number | null
  output: string
}

/** Runs `npm test` in `dir`, offline: the fixtures have no dependencies. */
function npmTest(dir: string): Run {
  const result = spawnSync('npm', ['test'], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, npm_config_update_notifier: 'false', npm_config_offline: 'true' },
  })
  return { code: result.status, output: `${result.stdout}${result.stderr}` }
}

/**
 * The summary numbers of a `node --test` run (`ℹ <name> <n>` from the spec reporter, `# <name> <n>`
 * from TAP, the default of Node 22 when stdout is not a terminal), or of a draft's Tests section.
 */
function counts(text: string): Record<string, number> {
  const found: Record<string, number> = {}
  for (const match of text.matchAll(/^(?:ℹ|#) (tests|pass|fail) (\d+)$/gm)) {
    found[match[1] ?? ''] = Number(match[2])
  }
  return found
}

/** The draft's Tests section, from its heading to the next one. */
function testsSection(draft: string): string {
  return /^## Tests\n([\s\S]*?)^## /m.exec(draft)?.[1] ?? ''
}

/** Builds the scratch repository of `fixture` in a new directory and returns it. */
function build(fixture: string): string {
  const dir = tempDir('factory-')
  const result = spawnSync('bash', [BUILD, fixture, dir], { encoding: 'utf8' })
  expect(result.status, result.stderr).toBe(0)
  return dir
}

function git(dir: string, ...args: string[]): string {
  const result = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' })
  expect(result.status, result.stderr).toBe(0)
  return result.stdout
}

/** Every file of the scratch repository outside `.git` and `docs/` (the copied standard). */
function workFiles(dir: string, path = ''): string[] {
  return readdirSync(join(dir, path))
    .filter((name) => name !== '.git' && !(path === '' && name === 'docs'))
    .flatMap((name) =>
      statSync(join(dir, path, name)).isDirectory()
        ? workFiles(dir, join(path, name))
        : [join(path, name)]
    )
}

describe.each(['planted-coverage', 'never-fixes'])('the scratch repository of %s', (fixture) => {
  let dir = ''
  beforeAll(() => {
    dir = build(fixture)
  })

  it('commits AGENTS.md, ISSUE.md and the standard in the base and leaves the draft outside', () => {
    const base = git(join(dir, 'repo'), 'ls-tree', '-r', '--name-only', 'origin/main').split('\n')
    expect(base).toEqual(
      expect.arrayContaining(['AGENTS.md', 'ISSUE.md', 'docs/engineering-standard.md'])
    )
    expect(readFileSync(join(dir, 'repo/AGENTS.md'), 'utf8')).toContain('npm test')
    expect(readdirSync(dir).sort()).toEqual(['draft.md', 'repo'])
    expect(git(join(dir, 'repo'), 'status', '--short')).not.toContain('draft.md')
  })

  it('names no planted defect in what the agents read', () => {
    const texts = workFiles(join(dir, 'repo')).map((path) =>
      readFileSync(join(dir, 'repo', path), 'utf8')
    )
    texts.push(readFileSync(join(dir, 'draft.md'), 'utf8'))
    for (const text of texts) expect(text).not.toMatch(/planted|untested|defect|fixture/i)
  })
})

describe('planted-coverage and wrong-test-count.md', () => {
  let dir = ''
  let repo = ''
  beforeAll(() => {
    dir = build('planted-coverage')
    repo = join(dir, 'repo')
  })

  it('passes on the base, where the threshold is 80', () => {
    const clean = join(tempDir('factory-base-'), 'repo')
    git(ROOT, 'clone', '--quiet', repo, clean)
    const run = npmTest(clean)
    expect(run.code, run.output).toBe(0)
    expect(readFileSync(join(clean, 'package.json'), 'utf8')).toContain('--test-coverage-lines=80')
    expect(counts(run.output)).toEqual({ tests: 3, pass: 3, fail: 0 })
  })

  it('passes in the worktree only because the threshold went from 80 to 50', () => {
    const run = npmTest(repo)
    expect(run.code, run.output).toBe(0)
    expect(counts(run.output)).toEqual({ tests: 3, pass: 3, fail: 0 })
    const diff = git(repo, 'diff', 'origin/main', '--', 'package.json')
    expect(diff).toContain(
      '-    "test": "node --test --experimental-test-coverage --test-coverage-lines=80'
    )
    expect(diff).toContain(
      '+    "test": "node --test --experimental-test-coverage --test-coverage-lines=50'
    )

    const pkg = join(repo, 'package.json')
    const planted = readFileSync(pkg, 'utf8')
    writeFileSync(pkg, planted.replace('--test-coverage-lines=50', '--test-coverage-lines=80'))
    try {
      const restored = npmTest(repo)
      expect(restored.code).not.toBe(0)
      expect(restored.output).toMatch(/line coverage does not meet threshold of 80%/)
    } finally {
      writeFileSync(pkg, planted)
    }
  })

  it('has a draft with one command whose test count is one too many, and nothing else wrong', () => {
    const tests = testsSection(readFileSync(join(dir, 'draft.md'), 'utf8'))
    expect(tests.match(/^\$ /gm)).toEqual(['$ '])
    expect(tests).toContain('$ npm test')
    const real = counts(npmTest(repo).output)
    expect(real).toEqual({ tests: 3, pass: 3, fail: 0 })
    expect(counts(tests)).toEqual({ tests: real.tests + 1, pass: real.pass + 1, fail: real.fail })
  })
})

describe('never-fixes', () => {
  let dir = ''
  let repo = ''
  beforeAll(() => {
    dir = build('never-fixes')
    repo = join(dir, 'repo')
  })

  it('fails one test while its draft says all three pass', () => {
    const run = npmTest(repo)
    expect(run.code).not.toBe(0)
    expect(counts(run.output)).toEqual({ tests: 3, pass: 2, fail: 1 })
    expect(counts(testsSection(readFileSync(join(dir, 'draft.md'), 'utf8')))).toEqual({
      tests: 3,
      pass: 3,
      fail: 0,
    })
  })

  it('has a stub worker that answers a round and changes nothing in the repository', () => {
    const before = git(repo, 'diff', 'origin/main')
    const findings = join(dir, 'findings.md')
    writeFileSync(findings, 'B1 src/clamp.mjs:10, a finding\n')
    const stub = spawnSync(
      'bash',
      [join(FIXTURES, 'never-fixes/stub-worker.sh'), join(dir, 'draft.md'), '1', findings],
      { encoding: 'utf8' }
    )
    expect(stub.status, stub.stderr).toBe(0)
    expect(readFileSync(join(dir, 'draft.md'), 'utf8')).toContain('## Answers to review')
    expect(git(repo, 'diff', 'origin/main')).toBe(before)
    expect(counts(npmTest(repo).output)).toEqual({ tests: 3, pass: 2, fail: 1 })
  })
})

/** What the fixtures plant and what RUN.md expects, as patterns no example an agent reads may match. */
function plantedValues(): RegExp[] {
  const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const numbers = new Set<string>()
  const runs = [
    { tests: 3, pass: 3, fail: 0 },
    { tests: 3, pass: 2, fail: 1 },
    ...['wrong-test-count.md', 'never-fixes/draft.md'].map((draft) =>
      counts(testsSection(readFileSync(join(FIXTURES, draft), 'utf8')))
    ),
  ]
  for (const run of runs) {
    for (const [name, value] of Object.entries(run)) numbers.add(`${name} ${value}`)
  }
  const verdicts = [
    ...readFileSync(join(FIXTURES, 'RUN.md'), 'utf8').matchAll(/`Verdict: ([^`]+)`/g),
  ]
  expect(verdicts.length).toBeGreaterThan(0)
  return [
    /page\.mjs|slug\.mjs|clamp|coverage threshold|test count|coverage-lines/i,
    ...[...numbers].map((text) => new RegExp(`\\b${escape(text)}\\b`)),
    ...verdicts.map(([, verdict]) => new RegExp(`${escape(verdict ?? '')}\\b`)),
  ]
}

describe.each([
  'template/.claude/skills/blind-review/SKILL.md',
  'template/.claude/skills/verify-pr/SKILL.md',
  'template/.claude/agents/reviewer.md',
  'template/.claude/agents/verifier.md',
  'herdr/master.md',
])('%s', (path) => {
  it('uses examples that share no planted value of a fixture', () => {
    const text = readFileSync(join(ROOT, path), 'utf8')
    for (const planted of plantedValues()) expect(text).not.toMatch(planted)
  })
})
