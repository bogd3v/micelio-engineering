import { execFileSync, spawnSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { tempDir } from '../../../test/support/temp.js'
import { createDeps, issuePaths, matchGlob, parseLanes, runLintLane } from '../src/lane.js'
import type { LintLaneDeps } from '../src/lane.js'

const PACKAGE = fileURLToPath(new URL('../', import.meta.url))
const LANE = `${PACKAGE}test/fixtures/lane/`

/** Offline dependencies: `AGENTS.md` is the fixture `agents`, files come from the fixtures folder. */
function deps(
  agents: string | null = 'agents.md',
  changed: string[] = [],
  issues: Record<string, string> = {}
): LintLaneDeps {
  return {
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
})

function readFileSync(name: string, body = false): string {
  const text = execFileSync('cat', [`${LANE}${name}`]).toString()
  return body ? text.split('\n').slice(1).join('\n') : text
}
