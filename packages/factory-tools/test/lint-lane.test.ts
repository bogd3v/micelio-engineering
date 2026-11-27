import { execFileSync, spawnSync } from 'node:child_process'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { tempDir } from '../../../test/support/temp.js'
import {
  createDeps,
  issuePaths,
  matchGlob,
  parseLanes,
  runLintLane,
  versionFiles,
} from '../src/lane.js'
import type { LaneGlobs, LintLaneDeps } from '../src/lane.js'

const PACKAGE = fileURLToPath(new URL('../', import.meta.url))
const LANE = `${PACKAGE}test/fixtures/lane/`

/** Offline dependencies: `AGENTS.md` is the fixture `agents`, files come from the fixtures folder. */
function deps(
  agents: string | null = 'agents.md',
  changed: string[] = [],
  issues: Record<string, string> = {},
  readLanes?: (repo: string) => Promise<LaneGlobs | null>
): LintLaneDeps {
  return {
    readLanes:
      readLanes ??
      (async () =>
        agents === null ? null : parseLanes(await readFile(`${LANE}${agents}`, 'utf8'))),
    readIssue: async (ref) => {
      const file = issues[`${ref.repo}#${ref.number}`]
      if (file === undefined) throw new Error(`no issue ${ref.repo}#${ref.number}`)
      const text = await readFile(`${LANE}${file}`, 'utf8')
      const [first = '', ...rest] = text.split('\n')
      return { title: first.replace(/^#\s+/, ''), body: rest.join('\n'), repo: ref.repo }
    },
    readText: async (path) => {
      if (path === 'AGENTS.md') {
        if (agents === null) throw Object.assign(new Error('no AGENTS.md'), { code: 'ENOENT' })
        return readFile(`${LANE}${agents}`, 'utf8')
      }
      return readFile(`${LANE}${path}`, 'utf8')
    },
    diffNames: async () => changed,
    readBaseText: async () => null,
  }
}

const lane = async (file: string, agents: string | null = 'agents.md') =>
  runLintLane(['lint-lane', '--file', file], deps(agents))

describe('lint-lane', () => {
  it('an issue with ! in its title is full', async () => {
    const result = await lane('issue-bang.md')
    expect(result.code).toBe(0)
    expect(result.stdout).toContain('lane: full\n')
    expect(result.stdout).toContain('the title has `!`')
  })

  it('a path under stack: or contract: makes the issue full', async () => {
    const stack = await lane('issue-stack.md')
    expect(stack.stdout).toContain('lane: full\n')
    expect(stack.stdout).toContain('`images/web/Dockerfile` matches stack: `images/**`')
    const contract = await lane('issue-contract.md')
    expect(contract.stdout).toContain('lane: full\n')
    expect(contract.stdout).toContain('`api/routes.ts` matches contract: `api/**`')
  })

  it('an issue whose paths all match express: is express', async () => {
    const result = await lane('issue-express.md')
    expect(result.stdout).toContain('lane: express\n')
    expect(result.stdout).toContain('`docs/guide.md` matches express: `docs/**/*.md`')
    expect(result.stdout).toContain('`docs/a/b/notes.md` matches express: `docs/**/*.md`')
    expect(result.stdout).toContain('`README.md` matches express: `README.md`')
  })

  it('a normative path is never express, whatever express: says', async () => {
    const result = await lane('issue-normative.md')
    expect(result.stdout).toContain('lane: normal\n')
    expect(result.stdout).toContain('`AGENTS.md` is normative')
    expect(result.stdout).toContain('`docs/factory.md` is normative')
    for (const path of [
      'docs/engineering-standard.md',
      'docs/standard/rust.md',
      'AGENTS.md',
      'CLAUDE.md',
      '.claude/agents/worker.md',
      'template/AGENTS.md',
      'herdr/master.md',
    ]) {
      const diff = await runLintLane(
        ['lint-lane', '--diff', 'main', '--lane', 'express'],
        deps('agents.md', [path])
      )
      expect(diff.code, path).toBe(1)
      expect(diff.stdout, path).toContain('lane: normal\n')
    }
  })

  it('a path that matches no glob is normal', async () => {
    const result = await lane('issue-unmatched.md')
    expect(result.stdout).toContain('lane: normal\n')
    expect(result.stdout).toContain('`scripts/run.sh` matches no glob')
    expect((await lane('issue-nopaths.md')).stdout).toContain('lane: normal\n')
  })

  it('a repository without a Lanes block is full', async () => {
    for (const agents of ['no-lanes.md', null]) {
      const result = await lane('issue-express.md', agents)
      expect(result.code).toBe(0)
      expect(result.stdout).toContain('lane: full\n')
      expect(result.stdout).toContain('no `## Lanes` block')
    }
    const diff = await runLintLane(
      ['lint-lane', '--diff', 'main', '--lane', 'normal'],
      deps('no-lanes.md', ['docs/guide.md'])
    )
    expect(diff.code).toBe(1)
    expect(diff.stdout).toContain('lane: full\n')
  })

  it('--diff exits 1 and names the lane the diff fits when a path is outside the lane', async () => {
    const run = (lane: string, changed: string[]) =>
      runLintLane(['lint-lane', '--diff', 'main', '--lane', lane], deps('agents.md', changed))
    const ok = await run('express', ['docs/guide.md', 'README.md'])
    expect(ok.code).toBe(0)
    const normal = await run('express', ['docs/guide.md', 'scripts/run.sh'])
    expect(normal.code).toBe(1)
    expect(normal.stdout).toContain('lane: normal\n')
    expect(normal.stdout).toContain('- scripts/run.sh (normal)')
    expect(normal.stdout).not.toContain('docs/guide.md')
    const full = await run('normal', ['scripts/run.sh', 'images/web/Dockerfile'])
    expect(full.code).toBe(1)
    expect(full.stdout).toContain('lane: full\n')
    expect(full.stdout).toContain('- images/web/Dockerfile (full)')
    expect(full.stdout).not.toContain('scripts/run.sh')
    expect((await run('normal', ['scripts/run.sh'])).code).toBe(0)
    expect((await run('full', ['api/x.ts'])).code).toBe(0)
    expect((await run('express', [])).code).toBe(0)
  })

  it('--diff counts untracked files', async () => {
    const dir = tempDir('lint-lane-')
    const git = (...args: string[]): string => execFileSync('git', args, { cwd: dir }).toString()
    git('init', '-q', '-b', 'main')
    git('config', 'user.email', 'a@example.com')
    git('config', 'user.name', 'a')
    git('config', 'commit.gpgsign', 'false')
    await mkdir(join(dir, 'docs'))
    await writeFile(join(dir, 'docs', 'guide.md'), 'one\n')
    git('add', '.')
    git('commit', '-q', '-m', 'init')
    await writeFile(join(dir, 'docs', 'guide.md'), 'two\n')
    const real: LintLaneDeps = { ...deps(), diffNames: createDeps(dir).diffNames }
    const argv = ['lint-lane', '--diff', 'HEAD', '--lane', 'express']
    expect((await runLintLane(argv, real)).code).toBe(0)
    await writeFile(join(dir, 'new.sh'), 'echo\n')
    await writeFile(join(dir, '.gitignore'), 'ignored.txt\n')
    await writeFile(join(dir, 'ignored.txt'), 'x\n')
    const result = await runLintLane(argv, real)
    expect(result.code).toBe(1)
    expect(result.stdout).toContain('lane: normal\n')
    expect(result.stdout).toContain('- new.sh (normal)')
    expect(result.stdout).not.toContain('ignored.txt')
  })

  it('--diff lists the old name of a rename and unquoted non-ASCII paths', async () => {
    const dir = tempDir('lint-lane-')
    const git = (...args: string[]): string => execFileSync('git', args, { cwd: dir }).toString()
    git('init', '-q', '-b', 'main')
    git('config', 'user.email', 'a@example.com')
    git('config', 'user.name', 'a')
    git('config', 'commit.gpgsign', 'false')
    await mkdir(join(dir, 'api'))
    await mkdir(join(dir, 'docs'))
    await writeFile(join(dir, 'api', 'routes.ts'), 'export const routes = 1\n'.repeat(20))
    git('add', '.')
    git('commit', '-q', '-m', 'init')
    git('mv', 'api/routes.ts', 'docs/routes.md')
    const real: LintLaneDeps = { ...deps(), diffNames: createDeps(dir).diffNames }
    const argv = ['lint-lane', '--diff', 'HEAD', '--lane', 'express']
    const renamed = await runLintLane(argv, real)
    expect(renamed.code).toBe(1)
    expect(renamed.stdout).toContain('lane: full\n')
    expect(renamed.stdout).toContain('- api/routes.ts (full)')
    git('reset', '-q', '--hard', 'HEAD')
    await mkdir(join(dir, 'images', 'café'), { recursive: true })
    await writeFile(join(dir, 'images', 'café', 'Dockerfile'), 'FROM x\n')
    const accent = await runLintLane(['lint-lane', '--diff', 'HEAD', '--lane', 'normal'], real)
    expect(accent.code).toBe(1)
    expect(accent.stdout).toContain('lane: full\n')
    expect(accent.stdout).toContain('- images/café/Dockerfile (full)')
  })

  it('reads the issue with gh for <owner/repo#n>', async () => {
    const result = await runLintLane(
      ['lint-lane', 'bogd3v/x#7'],
      deps('agents.md', [], { 'bogd3v/x#7': 'issue-express.md' })
    )
    expect(result.code).toBe(0)
    expect(result.stdout).toContain('lane: express\n')
  })

  it('<owner/repo#n> reads the lanes of that repository, not of the working directory', async () => {
    const seen: string[] = []
    const result = await runLintLane(
      ['lint-lane', 'bogd3v/x#7'],
      // The working directory's AGENTS.md would give express; the issue's repository has no block.
      deps('agents.md', [], { 'bogd3v/x#7': 'issue-express.md' }, async (repo) => {
        seen.push(repo)
        return null
      })
    )
    expect(seen).toEqual(['bogd3v/x'])
    expect(result.code).toBe(0)
    expect(result.stdout.startsWith('lane: full\n')).toBe(true)
    expect(result.stdout).toContain('no `## Lanes` block')
    const failing = await runLintLane(
      ['lint-lane', 'bogd3v/x#7'],
      deps('agents.md', [], { 'bogd3v/x#7': 'issue-express.md' }, async () => {
        throw new Error('gh: HTTP 500')
      })
    )
    expect(failing.code).toBe(2)
    expect(failing.stderr).toContain('HTTP 500')
  })

  it('--file and --diff still read the AGENTS.md of the working directory', async () => {
    let calls = 0
    const readLanes = async (): Promise<LaneGlobs | null> => (calls++, null)
    const file = await runLintLane(
      ['lint-lane', '--file', 'issue-express.md'],
      deps('agents.md', [], {}, readLanes)
    )
    expect(file.stdout.startsWith('lane: express\n')).toBe(true)
    const diff = await runLintLane(
      ['lint-lane', '--diff', 'main', '--lane', 'express'],
      deps('agents.md', ['docs/notes.md'], {}, readLanes)
    )
    expect(diff.code).toBe(0)
    expect(calls).toBe(0)
  })

  it('exits 2 on a usage error and has no option to force a lane', async () => {
    for (const argv of [
      [],
      ['--lane', 'express'],
      ['--diff', 'main'],
      ['--diff', 'main', '--lane', 'huge'],
      ['--diff', 'main', '--lane', 'full', '--file', 'issue-bang.md'],
      ['--file', 'issue-bang.md', '--lane', 'express'],
      ['--force', 'express', '--file', 'issue-bang.md'],
      ['--file'],
      ['not-a-target'],
      ['a/b#1', '--file', 'issue-bang.md'],
    ]) {
      const result = await runLintLane(['lint-lane', ...argv], deps())
      expect(result.code, argv.join(' ')).toBe(2)
      expect(result.stderr).toContain('Usage:')
    }
    const missing = await runLintLane(['lint-lane', '--file', 'nope.md'], deps())
    expect(missing.code).toBe(2)
    expect(missing.stderr).toContain('error:')
  })

  const RAISED = 'https://github.com/example/site/issues/7#issuecomment-1234567'

  it('a Lane raised: line sets the lane above the one the paths set and prints the comment as its reason', async () => {
    const expected = `lane: full\n- \`docs/guide.md\` matches express: \`docs/**/*.md\`\n- raised by the maintainer: full (${RAISED})\n`
    expect((await lane('issue-raised-full.md')).stdout).toBe(expected)
    const target = await runLintLane(
      ['lint-lane', 'example/site#7'],
      deps('agents.md', [], { 'example/site#7': 'issue-raised-full.md' })
    )
    expect(target).toEqual({ code: 0, stdout: expected, stderr: '' })
    for (const file of ['issue-raised-bare-url.md', 'issue-raised-after-backtick.md']) {
      const result = await lane(file)
      expect(result.stdout, file).toContain('lane: full\n')
      expect(result.stdout, file).toContain(`- raised by the maintainer: full (${RAISED})\n`)
    }
  })

  it('a Lane raised: line that is not above the lane of the paths changes nothing and says so', async () => {
    const equal = await lane('issue-raised-equal.md')
    expect(equal.stdout).toBe(
      'lane: normal\n- `scripts/run.sh` matches no glob\n- the raise to normal is not above normal: not applied\n'
    )
    const below = await lane('issue-raised-below.md')
    expect(below.stdout).toBe(
      'lane: full\n- `api/routes.ts` matches contract: `api/**`\n- the raise to normal is not above full: not applied\n'
    )
  })

  it('reads no Lane raised: line from code, a comment or the middle of a line, nor one it cannot use', async () => {
    for (const file of [
      'issue-raised-quoted.md',
      'issue-raised-no-url.md',
      'issue-raised-no-lane.md',
      'issue-raised-twice.md',
    ]) {
      const result = await lane(file)
      expect(result.stdout, file).toBe(
        'lane: express\n- `docs/guide.md` matches express: `docs/**/*.md`\n'
      )
    }
  })

  it('reads the block in both forms and ignores other sections', () => {
    expect(parseLanes(readFileSync('agents.md'))).toEqual({
      stack: ['compose.yaml', 'images/**', '**/Dockerfile'],
      contract: ['api/**', 'docs/contracts/*.md'],
      express: ['docs/**/*.md', 'README.md', '.github/project-fields.json', 'AGENTS.md'],
    })
    expect(parseLanes(readFileSync('agents-bullets.md'))).toEqual({
      stack: ['compose.yaml', 'images/**'],
      contract: ['api/**'],
      express: ['docs/**/*.md'],
    })
    expect(parseLanes('## Lanes\n\nstack:\n')).toEqual({ stack: [], contract: [], express: [] })
    expect(parseLanes(readFileSync('no-lanes.md'))).toBeNull()
  })

  it('matches globs and reads only prose paths', () => {
    expect(matchGlob('docs/**/*.md', 'docs/a.md')).toBe(true)
    expect(matchGlob('docs/**/*.md', 'docs/a/b/c.md')).toBe(true)
    expect(matchGlob('docs/*.md', 'docs/a/b.md')).toBe(false)
    expect(matchGlob('docs/', 'docs/a/b.md')).toBe(true)
    expect(matchGlob('**/Dockerfile', 'Dockerfile')).toBe(true)
    expect(matchGlob('**/Dockerfile', 'a/b/Dockerfile')).toBe(true)
    expect(matchGlob('a?c.md', 'abc.md')).toBe(true)
    expect(matchGlob('a.md', 'aXmd')).toBe(false)
    expect(issuePaths(readFileSync('issue-fenced.md', true))).toEqual(['docs/guide.md'])
  })

  it('runs as the bin', () => {
    const cwd = fileURLToPath(new URL('./fixtures/lane/', import.meta.url))
    const result = spawnSync(
      'node',
      [`${PACKAGE}dist/cli.js`, 'lint-lane', '--file', 'issue-bang.md'],
      {
        cwd,
        encoding: 'utf8',
      }
    )
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('lane: full')
  })

  it('the live form reads the issue with gh api repos/<repo>/issues/<n> and runs no gh issue or graphql call', async () => {
    const dir = tempDir('lint-lane-issue-')
    const calls = join(dir, 'calls')
    await writeFile(
      join(dir, 'issue.json'),
      JSON.stringify({ number: 7, title: 'docs: x', body: 'See docs/a.md.', state: 'open' })
    )
    const gh = [
      '#!/bin/sh',
      `echo "$*" >> "${calls}"`,
      'case "$*" in',
      `  "api repos/example/site/issues/7") cat "${dir}/issue.json" ;;`,
      '  *) echo "gh: Not Found (HTTP 404)" >&2; exit 1 ;;',
      'esac',
      '',
    ].join('\n')
    await writeFile(join(dir, 'gh'), gh, { mode: 0o755 })
    const saved = process.env.PATH
    process.env.PATH = `${dir}:${saved ?? ''}`
    try {
      const { readIssue } = createDeps()
      expect(await readIssue({ repo: 'example/site', number: 7 })).toEqual({
        title: 'docs: x',
        body: 'See docs/a.md.',
        repo: 'example/site',
      })
      expect((await readFile(calls, 'utf8')).trim().split('\n')).toEqual([
        'api repos/example/site/issues/7',
      ])
      await expect(readIssue({ repo: 'example/site', number: 8 })).rejects.toMatchObject({
        stderr: 'gh: Not Found (HTTP 404)\n',
      })
    } finally {
      process.env.PATH = saved
    }
  })

  it('the real reader asks gh api for the AGENTS.md of the repository: a block, a 404 and another failure', async () => {
    const dir = tempDir('lint-lane-gh-')
    const gh = [
      '#!/bin/sh',
      'case "$*" in',
      '  "api -H Accept: application/vnd.github.raw repos/example/with/contents/AGENTS.md")',
      `    cat "${LANE}agents.md" ;;`,
      '  *repos/example/none/*) echo "gh: Not Found (HTTP 404)" >&2; exit 1 ;;',
      '  *) echo "gh: Server Error (HTTP 500)" >&2; exit 1 ;;',
      'esac',
      '',
    ].join('\n')
    await writeFile(join(dir, 'gh'), gh, { mode: 0o755 })
    const saved = process.env.PATH
    process.env.PATH = `${dir}:${saved ?? ''}`
    try {
      const { readLanes } = createDeps()
      expect(await readLanes('example/with')).toEqual(
        parseLanes(await readFile(`${LANE}agents.md`, 'utf8'))
      )
      expect(await readLanes('example/none')).toBeNull()
      await expect(readLanes('example/broken')).rejects.toThrow()
    } finally {
      process.env.PATH = saved
    }
  })
})

const AGENTS_RELEASE = `# AGENTS.md

## Lanes

\`\`\`
stack: images/**
contract: packages/*/package.json
express: docs/**/*.md
\`\`\`
`

const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`

/** The files of a small workspace at `0.2.10`: a released package, a root that pins it, a fixture and a lock. */
function workspace(version: string, extra: Record<string, unknown> = {}): Record<string, string> {
  const pin = (range: string) => ({ '@acme/lint': range, lodash: '^4.0.0' })
  const lock = {
    name: 'root',
    lockfileVersion: 3,
    packages: {
      '': { name: 'root', devDependencies: pin(version) },
      'packages/lint': { name: '@acme/lint', version },
      'node_modules/@acme/lint': { resolved: 'packages/lint', link: true },
      'fixtures/basic': { name: 'basic', devDependencies: pin(`^${version}`) },
    },
  }
  return {
    'AGENTS.md': AGENTS_RELEASE,
    'package.json': json({ name: 'root', version: '0.0.0', devDependencies: pin(version) }),
    'packages/lint/package.json': json({ name: '@acme/lint', version, ...extra }),
    'fixtures/basic/package.json': json({ name: 'basic', devDependencies: pin(`^${version}`) }),
    'package-lock.json': json(lock),
  }
}

/** A git repository at `main` with `before` committed, then `after` written over it (null deletes a file). */
async function repoWith(
  before: Record<string, string>,
  after: Record<string, string | null>
): Promise<LintLaneDeps> {
  const dir = tempDir('lint-lane-version-')
  const git = (...args: string[]): string => execFileSync('git', args, { cwd: dir }).toString()
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 'a@example.com')
  git('config', 'user.name', 'a')
  git('config', 'commit.gpgsign', 'false')
  const put = async (files: Record<string, string | null>) => {
    for (const [path, text] of Object.entries(files)) {
      if (text === null) await rm(join(dir, path))
      else {
        await mkdir(dirname(join(dir, path)), { recursive: true })
        await writeFile(join(dir, path), text)
      }
    }
  }
  await put(before)
  git('add', '.')
  git('commit', '-q', '-m', 'init')
  await put(after)
  return createDeps(dir)
}

const fits = (deps: LintLaneDeps, lane = 'express') =>
  runLintLane(['lint-lane', '--diff', 'main', '--lane', lane], deps)

describe('lint-lane, version files', () => {
  it("--diff fits express when the diff only moves a workspace package's version and the pins of that package", async () => {
    const result = await fits(await repoWith(workspace('0.2.10'), workspace('0.2.11')))
    expect(result.code).toBe(0)
    expect(result.stdout).toBe('lane: express\nthe diff fits the lane\n')
    // The reason line is the one `diffLane` carries for each version file.
    const paths = ['package.json', 'package-lock.json', 'packages/lint/package.json']
    const moved = await versionFiles(
      paths.concat('fixtures/basic/package.json'),
      parseLanes(AGENTS_RELEASE),
      async (path) => workspace('0.2.10')[path] ?? null,
      async (path) => workspace('0.2.11')[path] ?? ''
    )
    for (const path of [...paths, 'fixtures/basic/package.json']) {
      expect(moved.get(path)).toBe(`${path} only moves the version of @acme/lint 0.2.10 → 0.2.11`)
    }
  })

  it('--diff keeps the lane of a version file that changes anything else, or pins another version', async () => {
    const lane = async (after: Record<string, string>) => {
      const result = await fits(await repoWith(workspace('0.2.10'), after), 'express')
      expect(result.code).toBe(1)
      return result.stdout
    }
    // A released package.json that also adds a dependency: full, by contract:.
    const added = await lane({
      ...workspace('0.2.11', { dependencies: { zod: '^3.0.0' } }),
    })
    expect(added).toContain('lane: full\n')
    expect(added).toContain('- packages/lint/package.json (full)')
    // Its pins are no longer moves of a release.
    expect(added).toContain('- package-lock.json (normal)')
    expect(added).toContain('- package.json (normal)')
    // A root that also upgrades a third-party pin: normal.
    const third = workspace('0.2.11')
    third['package.json'] = (third['package.json'] ?? '').replace('^4.0.0', '^4.1.0')
    const thirdOut = await lane(third)
    expect(thirdOut).toContain('lane: normal\n')
    expect(thirdOut).toContain('- package.json (normal)')
    expect(thirdOut).not.toContain('packages/lint/package.json')
    // A pin moved to a version other than the released one: normal.
    const other = workspace('0.2.11')
    other['fixtures/basic/package.json'] = (other['fixtures/basic/package.json'] ?? '').replace(
      '^0.2.11',
      '^0.3.0'
    )
    const otherOut = await lane(other)
    expect(otherOut).toContain('lane: normal\n')
    expect(otherOut).toContain('- fixtures/basic/package.json (normal)')
    // A pin that holds the old version only as the start of a longer one: normal.
    const longer = (version: string, pin: string) => {
      const files = workspace(version)
      files['fixtures/basic/package.json'] = json({
        name: 'basic',
        devDependencies: { '@acme/lint': pin },
      })
      return files
    }
    const prefix = await fits(
      await repoWith(longer('0.2.1', '^0.2.10'), longer('0.2.2', '^0.2.20'))
    )
    expect(prefix.code).toBe(1)
    expect(prefix.stdout).toContain('- fixtures/basic/package.json (normal)')
    // A released package.json that reorders its exports conditions: full.
    const exportsOf = (order: string[]) =>
      Object.fromEntries(order.map((key) => [key, `./${key}.js`]))
    const reordered = (version: string, order: string[]) => ({
      ...workspace(version),
      'packages/lint/package.json': json({
        name: '@acme/lint',
        version,
        exports: { '.': exportsOf(order) },
      }),
    })
    const order = await fits(
      await repoWith(
        reordered('0.2.10', ['import', 'require', 'default']),
        reordered('0.2.11', ['require', 'import', 'default'])
      )
    )
    expect(order.code).toBe(1)
    expect(order.stdout).toContain('lane: full\n')
    expect(order.stdout).toContain('- packages/lint/package.json (full)')
    // A lock entry whose version moves without its package.json: normal.
    const lockOnly = workspace('0.2.10')
    lockOnly['package-lock.json'] = workspace('0.2.11')['package-lock.json'] ?? ''
    const lockOut = await lane(lockOnly)
    expect(lockOut).toContain('lane: normal\n')
    expect(lockOut).toContain('- package-lock.json (normal)')
  })

  it('--diff never reads a new, deleted, normative or stack: file as a version file', async () => {
    const lane = async (before: Record<string, string>, after: Record<string, string | null>) =>
      fits(await repoWith(before, after))
    // New: a package.json that is not at <base>.
    const created = await lane(workspace('0.2.10'), {
      ...workspace('0.2.11'),
      'tools/package.json': json({ name: 'tools', version: '1.0.0' }),
    })
    expect(created.code).toBe(1)
    expect(created.stdout).toContain('- tools/package.json (normal)')
    // Deleted: the root is gone from the worktree.
    const deleted = await lane(workspace('0.2.10'), {
      ...workspace('0.2.11'),
      'package.json': null,
    })
    expect(deleted.code).toBe(1)
    expect(deleted.stdout).toContain('lane: normal\n')
    expect(deleted.stdout).toContain('- package.json (normal)')
    // Normative: template/ is never express.
    const tpl = (version: string) => ({
      ...workspace(version),
      'template/package.json': json({ name: '@acme/tpl', version }),
    })
    const normative = await lane(tpl('0.2.10'), tpl('0.2.11'))
    expect(normative.code).toBe(1)
    expect(normative.stdout).toContain('- template/package.json (normal)')
    // stack: a bumped package.json under a stack: glob stays full.
    const web = (version: string) => ({
      ...workspace(version),
      'images/web/package.json': json({ name: '@acme/web', version }),
    })
    const stack = await lane(web('0.2.10'), web('0.2.11'))
    expect(stack.code).toBe(1)
    expect(stack.stdout).toContain('lane: full\n')
    expect(stack.stdout).toContain('- images/web/package.json (full)')
  })

  it("--diff keeps the lane of a pin upgrade whose package's version does not move in the diff", async () => {
    const before = workspace('0.2.10')
    const after = workspace('0.2.10')
    for (const path of ['package.json', 'fixtures/basic/package.json']) {
      after[path] = (before[path] ?? '').replace('0.2.10', '0.2.11')
    }
    const result = await fits(await repoWith(before, after))
    expect(result.code).toBe(1)
    expect(result.stdout).toContain('lane: normal\n')
    expect(result.stdout).toContain('- package.json (normal)')
    expect(result.stdout).toContain('- fixtures/basic/package.json (normal)')
  })
})

function readFileSync(name: string, body = false): string {
  const text = execFileSync('cat', [`${LANE}${name}`]).toString()
  return body ? text.split('\n').slice(1).join('\n') : text
}
