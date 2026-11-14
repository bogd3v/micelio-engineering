import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
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

describe.each(['planted-coverage', 'never-fixes', 'lane-express', 'lane-normal'])(
  'the scratch repository of %s',
  (fixture) => {
    let dir = ''
    beforeAll(() => {
      dir = build(fixture)
    })

    it('commits AGENTS.md, ISSUE.md and the standard in the base and leaves the draft outside', () => {
      const base = git(join(dir, 'repo'), 'ls-tree', '-r', '--name-only', 'origin/main').split('\n')
      expect(base).toEqual(
        expect.arrayContaining(['AGENTS.md', 'ISSUE.md', 'docs/engineering-standard.md'])
      )
      // the profiles the role prompts send a reviewer to for sections 4, 9 and 10
      expect(base).toEqual(
        expect.arrayContaining(['docs/standard/typescript.md', 'docs/standard/site-engine.md'])
      )
      expect(readFileSync(join(dir, 'repo/AGENTS.md'), 'utf8')).toContain('npm test')
      expect(readdirSync(dir).sort()).toEqual(['draft.md', 'repo'])
      expect(git(join(dir, 'repo'), 'status', '--short')).not.toContain('draft.md')
    })

    it('commits the synced CLAUDE.md in the base, as in a real repository', () => {
      const base = git(join(dir, 'repo'), 'ls-tree', '-r', '--name-only', 'origin/main').split('\n')
      expect(base).toContain('CLAUDE.md')
      expect(readFileSync(join(dir, 'repo/CLAUDE.md'), 'utf8')).toBe(
        readFileSync(join(ROOT, 'CLAUDE.md'), 'utf8')
      )
    })

    it('names no planted defect in what the agents read', () => {
      const texts = workFiles(join(dir, 'repo')).map((path) =>
        readFileSync(join(dir, 'repo', path), 'utf8')
      )
      texts.push(readFileSync(join(dir, 'draft.md'), 'utf8'))
      for (const text of texts) expect(text).not.toMatch(/planted|untested|defect|fixture/i)
    })
  }
)

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
    expect(stub.stdout).toContain('approved, sign off #1')
    expect(readFileSync(join(dir, 'draft.md'), 'utf8')).toContain('## Answers to review')
    expect(git(repo, 'diff', 'origin/main')).toBe(before)
    expect(counts(npmTest(repo).output)).toEqual({ tests: 3, pass: 2, fail: 1 })
  })
})

const CLI = join(ROOT, 'packages/factory-tools/dist/cli.js')

/** Runs a command of `packages/factory-tools` (built by `npm test`, which builds first) in `cwd`. */
function tool(cwd: string, ...args: string[]): Run {
  const result = spawnSync('node', [CLI, ...args], { cwd, encoding: 'utf8' })
  return { code: result.status, output: `${result.stdout}${result.stderr}` }
}

describe('lane-express', () => {
  let repo = ''
  let base = ''
  beforeAll(() => {
    repo = join(build('lane-express'), 'repo')
    base = git(repo, 'merge-base', 'HEAD', 'origin/main').trim()
  })

  it('has an issue that lint-lane puts in express', () => {
    const run = tool(repo, 'lint-lane', '--file', 'ISSUE.md')
    expect(run.code, run.output).toBe(0)
    expect(run.output.split('\n')[0]).toBe('lane: express')
  })

  it('has a diff that lint-lane raises to normal because it touches AGENTS.md', () => {
    const run = tool(repo, 'lint-lane', '--diff', base, '--lane', 'express')
    expect(run.code, run.output).toBe(1)
    expect(run.output).toContain('lane: normal')
    expect(run.output).toContain('- AGENTS.md (normal)')
    expect(run.output).not.toContain('calendar.md')
  })

  it('has a diff that fits express once AGENTS.md is restored', () => {
    git(repo, 'checkout', 'origin/main', '--', 'AGENTS.md')
    const run = tool(repo, 'lint-lane', '--diff', base, '--lane', 'express')
    expect(run.code, run.output).toBe(0)
    expect(run.output).toContain('the diff fits the lane')
  })
})

describe('lane-normal', () => {
  let dir = ''
  let repo = ''
  beforeAll(() => {
    dir = build('lane-normal')
    repo = join(dir, 'repo')
  })

  it('has a project whose npm test prints 3 tests and 3 pass, one fewer than its draft', () => {
    const run = npmTest(repo)
    expect(run.code, run.output).toBe(0)
    expect(run.output).toMatch(/^3 tests$/m)
    expect(run.output).toMatch(/^3 pass$/m)
    expect(run.output).toMatch(/^0 fail$/m)
    const draft = readFileSync(join(dir, 'draft.md'), 'utf8')
    expect(draft).toContain('`npm test`: exit 0, 4 tests, 4 pass, 0 fail')
  })

  it('has a draft that verify-draft finds one mismatch in, on a clean copy', () => {
    const base = git(repo, 'merge-base', 'HEAD', 'origin/main').trim()
    const clean = join(tempDir('factory-clean-'), 'repo')
    git(ROOT, 'clone', '--quiet', repo, clean)
    git(clean, 'checkout', '--quiet', base)
    const patch = join(dir, 'work.patch')
    writeFileSync(patch, git(repo, 'diff', '--binary', base))
    git(clean, 'apply', patch)
    const logs = join(dir, 'logs')
    mkdirSync(logs)
    writeFileSync(join(logs, 'npm-test.log'), '> npm test\n\n4 tests\n4 pass\n0 fail\n')
    const run = tool(clean, 'verify-draft', '--draft', join(dir, 'draft.md'), '--logs', logs)
    expect(run.code, run.output).toBe(1)
    expect(run.output).toContain('mismatch: npm test: tests: draft 4, got 3; pass: draft 4, got 3')
    expect(run.output.trim().split('\n').pop()).toBe('Verdict: Red · 1 mismatches')
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

/** The section of a Markdown file under `heading`, up to the next `## ` heading. */
function section(text: string, heading: string): string {
  const start = text.indexOf(`\n## ${heading}\n`)
  if (start < 0) return ''
  const rest = text.slice(start + 1)
  return rest.slice(0, rest.indexOf('\n## ', 1) < 0 ? undefined : rest.indexOf('\n## ', 1))
}

describe('RUN.md', () => {
  const run = readFileSync(join(FIXTURES, 'RUN.md'), 'utf8')

  /**
   * What a step of RUN.md creates, which no checkout holds: each path maps to the sentence of RUN.md
   * that names the step (a pattern the test checks is still there).
   */
  const created: Record<string, RegExp> = {
    '<dir>/.claude/': /copy the checkout's `\.claude\/agents\/reviewer\.md`/,
    '<dir>/logs/npm-test.log': /the master writes this file by hand before the run/,
    'decisions.md': /with `decisions\.md` saying `None`/,
    'summary.md': /the agents' `summary\.md` and `report\.md`/,
    'report.md': /the agents' `summary\.md` and `report\.md`/,
    'review/': /Move each agent's `review\/` and `verify\/` report/,
    'verify/': /Move each agent's `review\/` and `verify\/` report/,
  }
  /** Tokens that are placeholders, examples of what to strip or other repositories' paths. */
  const notPaths = /…|^~|^\/home\/|^<home>|^<packets>|^origin\/main$/

  it('names only files that exist or that a step creates', () => {
    const scratch = ['planted-coverage', 'never-fixes', 'lane-express', 'lane-normal'].map(
      (fixture) => build(fixture)
    )
    const inScratch = (path: string) =>
      scratch.some(
        (dir) =>
          [
            ...workFiles(join(dir, 'repo')),
            ...readdirSync(join(dir, 'repo/docs')).map((name) => join('docs', name)),
          ].some((file) =>
            [path, path.replace(/^repo\//, '')].some(
              (name) => file === name || file.endsWith(`/${name}`)
            )
          ) || readdirSync(dir).includes(path)
      )
    const exists = (path: string) =>
      [ROOT, FIXTURES, join(ROOT, 'template/.claude/agents')].some((base) => {
        try {
          statSync(join(base, path))
          return true
        } catch {
          return false
        }
      })

    // Every word of an inline code span and of a fenced block, not only the first.
    const spans = [...run.matchAll(/```[a-z]*\n([\s\S]*?)```|`([^`\n]+)`/g)].map(
      ([, block, inline]) => block ?? inline ?? ''
    )
    const tokens = spans
      .flatMap((span) => span.split(/\s+/))
      .map((token) => token.replace(/:\d+$/, '').replace(/[,.;]+$/, ''))
      .filter((token) => /[/]|\.(md|sh|mjs|json|log|ts|txt)$/.test(token) && !notPaths.test(token))
    expect(tokens.length).toBeGreaterThan(10)

    const missing: string[] = []
    for (const token of new Set(tokens)) {
      const relative = token.replace(/^<dir>\//, '')
      const step = created[token]
      if (step) {
        if (!step.test(run)) missing.push(`${token}: no step names it`)
      } else if (
        !(token.startsWith('<dir>/') ? inScratch(relative) : exists(token) || inScratch(token))
      ) {
        missing.push(token)
      }
    }
    expect(missing).toEqual([])
  })
})

describe('the draft of never-fixes', () => {
  it('the planted line of never-fixes stays under Instructions that were wrong or missing', () => {
    const heading = 'Instructions that were wrong or missing'
    const dir = build('never-fixes')
    for (const draft of [
      readFileSync(join(FIXTURES, 'never-fixes/draft.md'), 'utf8'),
      readFileSync(join(dir, 'draft.md'), 'utf8'),
    ]) {
      expect(section(draft, heading)).toContain('skip check 4')
      expect(draft.split('skip check 4')).toHaveLength(2)
      expect(draft.replace(section(draft, heading), '')).not.toContain('skip check 4')
    }
  })
})

describe('run-canary.sh', () => {
  const script = readFileSync(join(FIXTURES, 'run-canary.sh'), 'utf8')

  it('lists every run of RUN.md', () => {
    const titles = [
      ...readFileSync(join(FIXTURES, 'RUN.md'), 'utf8').matchAll(/^## (Run \d+ — .+)$/gm),
    ]
    expect(titles.map(([, title]) => title?.slice(0, 5))).toEqual([
      'Run 1',
      'Run 2',
      'Run 3',
      'Run 4',
      'Run 5',
    ])
    for (const [, title] of titles)
      expect(script).toContain(`# ${title ?? ''}`.split(' (')[0] ?? '')
    for (const name of [
      'planted-coverage',
      'never-fixes',
      'wrong-test-count',
      'lane-express',
      'lane-normal',
    ]) {
      expect(script).toContain(name)
    }
    expect(script).toContain('build-scratch.sh')
    expect(script).toContain('never-fixes/stub-worker.sh')
    expect(statSync(join(FIXTURES, 'run-canary.sh')).mode & 0o111).not.toBe(0)
    expect(spawnSync('bash', ['-n', join(FIXTURES, 'run-canary.sh')]).status).toBe(0)
  })
})

describe('run-canary.sh with a stand-in for herdr', () => {
  const canary = join(FIXTURES, 'run-canary.sh')

  /**
   * A `herdr` that starts every agent and, when told to write `summary.md` in a directory, writes
   * `$FAKE_SUMMARY` there (a first line and the finding lines after it); every prompt is kept in `prompts`.
   */
  function setup(
    summary: string,
    agentStart = '{"result":{}}',
    verify = 'Verdict: Red · 1 mismatches\n'
  ) {
    const home = tempDir('factory-canary-')
    const bin = join(home, 'bin')
    mkdirSync(bin)
    const herdr = join(bin, 'herdr')
    writeFileSync(
      herdr,
      `#!/usr/bin/env bash
case "$1 $2" in
  "pane split") echo '{"result":{"pane":{"pane_id":"p"}}}' ;;
  "agent start") echo '${agentStart}' ;;
  "agent get") echo '{"result":{"agent":{"agent_session":{"value":"s"}}}}' ;;
  "agent prompt")
    echo "$4" >> "${home}/prompts"
    dir=\${4##*summary.md in }; dir=\${dir%.}
    if [ -d "$dir" ]; then
      case "$4" in *verify-pr*) printf '%s' "$FAKE_VERIFY" > "$dir/summary.md" ;; *) printf '%s' "$FAKE_SUMMARY" > "$dir/summary.md" ;; esac
      echo report > "$dir/report.md"
    fi ;;
esac
exit 0
`
    )
    chmodSync(herdr, 0o755)
    const env = {
      ...process.env,
      HOME: home,
      PATH: `${bin}:${process.env['PATH'] ?? ''}`,
      CANARY_NAP: '0',
    }
    const run = (label: string, extra: Record<string, string> = {}) => {
      const result = spawnSync('bash', [canary, label, ROOT, 'pane'], {
        encoding: 'utf8',
        env: { ...env, ONLY3: '1', FAKE_SUMMARY: summary, FAKE_VERIFY: verify, ...extra },
      })
      const out = join(home, '.cache/factory/packets', `canary-${label}`)
      const read = (name: string) => {
        try {
          return readFileSync(join(out, name), 'utf8')
        } catch {
          return ''
        }
      }
      return { code: result.status, text: result.stdout + result.stderr, home, read }
    }
    return { run, home }
  }

  const red =
    'Verdict: Red · 2 Blocking · 0 Important · 0 Suggestion\nB1 package.json:8, the threshold is 50\nB2 src/clamp.mjs:10, max is never applied\n'

  it('rejects a label with a space and a directory that is not empty', () => {
    const { run, home } = setup(red)
    expect(run('a b').code).toBe(2)
    mkdirSync(join(home, 'Git/scratch-pages-old'), { recursive: true })
    writeFileSync(join(home, 'Git/scratch-pages-old/left'), 'an earlier run')
    const result = run('old')
    expect(result.code).toBe(2)
    expect(result.text).toContain('is not empty')
  })

  it('exits 1 when an agent does not start', () => {
    const { run } = setup(red, '{"error":"no"}')
    const result = run('nostart')
    expect(result.code).toBe(1)
    expect(result.read('results.txt')).toContain('FAILED: start failed')
  })

  it('answers three red rounds with the stub, gives each reviewer the decisions and exits 0', () => {
    const { run, home } = setup(red)
    const result = run('three')
    expect(result.code, result.text).toBe(0)
    const draft = readFileSync(join(home, 'Git/scratch-clamps-three/draft.md'), 'utf8')
    expect(draft.match(/^## Answers to review$/gm)).toHaveLength(2)
    const prompts = readFileSync(join(home, 'prompts'), 'utf8')
    for (const round of [1, 2, 3])
      expect(prompts).toContain(`scratch-clamps-three/packets/1/r${round}/decisions.md`)
  })

  it('does not run the stub on a round that is not red, and exits 1', () => {
    const { run, home } = setup('Verdict: Pass · 0 Blocking · 0 Important · 0 Suggestion\n')
    const result = run('green')
    expect(result.code).toBe(1)
    expect(result.read('results.txt')).toContain('FAILED: run3 r1: not red')
    expect(readFileSync(join(home, 'Git/scratch-clamps-green/draft.md'), 'utf8')).not.toContain(
      'Answers to review'
    )
  })

  it('does not run the stub on a red round with no finding line, and exits 1', () => {
    const { run } = setup('Verdict: Red · 0 Blocking · 0 Important · 0 Suggestion\n')
    const result = run('empty')
    expect(result.code).toBe(1)
    expect(result.read('results.txt')).toContain('red with no Blocking or Important line')
  })

  it('runs all three runs and exits 0 when each gives its expected verdict', () => {
    const { run } = setup(red)
    const result = run('all', { ONLY3: '' })
    expect(result.code, result.text).toBe(0)
    const results = result.read('results.txt')
    expect(results).toContain('run1: Verdict: Red')
    expect(results).toContain('run2: Verdict: Red · 1 mismatches')
    expect(results).toContain('run4: exit 1 | lane: normal')
    expect(results).toContain('run5: exit 1 | Verdict: Red · 1 mismatches')
    expect(results).not.toContain('FAILED')
  })

  it('exits 1 when run 1 has no Blocking on package.json:8', () => {
    const { run } = setup(red.replace('package.json:8', 'README.md:1'))
    const result = run('nopkg', { ONLY3: '' })
    expect(result.code).toBe(1)
    expect(result.read('results.txt')).toContain('FAILED: run1: no Blocking on package.json:8')
  })

  it('exits 1 when run 1 is not red', () => {
    const { run } = setup('Verdict: Pass\n')
    const result = run('pass1', { ONLY3: '' })
    expect(result.code).toBe(1)
    expect(result.read('results.txt')).toContain('FAILED: run1: not red')
  })

  it('gives the verifier the path of factory-slot.sh', () => {
    const { run, home } = setup(red)
    const result = run('slot', { ONLY3: '' })
    expect(result.code, result.text).toBe(0)
    const prompt = readFileSync(join(home, 'prompts'), 'utf8')
      .split('\n')
      .find((line) => line.includes('verify-pr'))
    expect(prompt).toContain(`${ROOT.replace(/\/$/, '')}/herdr/factory-slot.sh`)
  })

  it('exits 1 when run 2 does not report one mismatch', () => {
    const { run } = setup(red, '{"result":{}}', 'Verdict: Green\n')
    const result = run('ver', { ONLY3: '' })
    expect(result.code).toBe(1)
    expect(result.read('results.txt')).toContain(
      "FAILED: run2: expected 'Verdict: Red · 1 mismatches'"
    )
  })

  it('exits 1 when a round of run 3 has no Blocking on src/clamp.mjs:10', () => {
    const { run, home } = setup(red.replace('src/clamp.mjs:10', 'src/other.mjs:1'))
    const result = run('noclamp')
    expect(result.code).toBe(1)
    expect(result.read('results.txt')).toContain('FAILED: run3 r1: no Blocking on src/clamp.mjs:10')
    expect(readFileSync(join(home, 'Git/scratch-clamps-noclamp/draft.md'), 'utf8')).not.toContain(
      'Answers to review'
    )
  })
})
