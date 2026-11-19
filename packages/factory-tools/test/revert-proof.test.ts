import { execFileSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { isTestPath, runRevertProof } from '../src/revert-proof.js'

let dir: string
let repo: string
let scratchRoot: string
let log: string
let base: string

const git = (...args: string[]): string =>
  execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim()
const put = (path: string, content: string): void => {
  mkdirSync(join(repo, path, '..'), { recursive: true })
  writeFileSync(join(repo, path), content)
}
const prove = (command: string[], ...extra: string[]) =>
  runRevertProof(
    ['revert-proof', '--base', base, '--cwd', repo, '--log', log, ...extra, '--', ...command],
    { FACTORY_TMP: scratchRoot }
  )

/** The shape of micelio#910: two production files changed and one added, a test changed and a test added. */
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'revert-proof-'))
  repo = join(dir, 'repo')
  scratchRoot = join(dir, 'scratch')
  log = join(dir, 'proof.log')
  mkdirSync(repo)
  git('init', '-q')
  git('config', 'user.email', 'a@example.com')
  git('config', 'user.name', 'A')
  put('src/pins.txt', 'v0.8.0\n')
  put('src/other.txt', 'old\n')
  put('test/pins.test.txt', 'old test\n')
  put('.gitignore', 'node_modules\n')
  git('add', '.')
  git('commit', '-q', '-m', 'base')
  base = git('rev-parse', 'HEAD')
  put('src/pins.txt', 'v0.8.1\n')
  put('src/other.txt', 'new\n')
  put('src/added.txt', 'added\n')
  put('test/pins.test.txt', 'changed test\n')
  put('test/new.test.txt', 'new test\n')
  mkdirSync(join(repo, 'node_modules'))
  writeFileSync(join(repo, 'node_modules', 'dep.txt'), 'dep\n')
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('revert-proof', () => {
  it('restores every changed production file to the base and deletes the added ones', async () => {
    const result = await prove(['sh', '-c', 'cat src/pins.txt src/other.txt; ls src; exit 1'])
    expect(result.code).toBe(0)
    expect(result.stdout).toContain('restored: src/other.txt, src/pins.txt')
    expect(result.stdout).toContain('deleted: src/added.txt')
    const output = readFileSync(log, 'utf8')
    expect(output).toBe('v0.8.0\nold\nother.txt\npins.txt\n')
  })

  it('keeps the changed and the new test files as the worktree has them', async () => {
    await prove(
      ['sh', '-c', 'cat test/pins.test.txt test/new.test.txt custom/x.txt'],
      '--test',
      'custom/**'
    )
    expect(readFileSync(log, 'utf8')).toContain('changed test\nnew test\n')
    expect(isTestPath('packages/x/test/a.ts')).toBe(false)
    expect(isTestPath('packages/x/a.test.ts')).toBe(true)
    expect(isTestPath('a/__tests__/b.ts')).toBe(true)
    expect(isTestPath('fixtures/b.ts')).toBe(true)
    expect(isTestPath('custom/x.txt', ['custom/**'])).toBe(true)
    put('custom/x.txt', 'kept\n')
    await prove(['sh', '-c', 'cat custom/x.txt'], '--test', 'custom/**')
    expect(readFileSync(log, 'utf8')).toBe('kept\n')
  })

  it("is proven when the command fails on the base's code and not proven when it passes", async () => {
    const fails = await prove(['sh', '-c', 'grep -q v0.8.1 src/pins.txt'])
    expect(fails.code).toBe(0)
    expect(fails.stdout).toContain('exit code: 1')
    expect(fails.stdout).toContain('proven')
    const passes = await prove(['sh', '-c', 'grep -q v0.8.0 src/pins.txt'])
    expect(passes.code).toBe(1)
    expect(passes.stdout).toContain("not proven: the command passes on the merge base's code")
    expect((await runRevertProof(['revert-proof', '--base', base], {})).code).toBe(2)
    expect((await prove(['no-such-command-here'])).code).toBe(2)
  })

  it('a change with no production file is not proven', async () => {
    git('checkout', '-q', '--', '.')
    rmSync(join(repo, 'src/added.txt'))
    git('checkout', '-q', base, '--', '.')
    put('test/new.test.txt', 'only a test\n')
    const result = await prove(['sh', '-c', 'exit 1'])
    expect(result.code).toBe(1)
    expect(result.stdout).toContain('not proven: no production file changed')
  })

  it("never writes to the worktree and writes the command's output to the log", async () => {
    const before = git('status', '--short')
    const listing = readdirSync(repo).sort()
    const result = await prove([
      'sh',
      '-c',
      'echo out; echo err >&2; echo x > src/pins.txt; ls node_modules; exit 3',
    ])
    expect(result.code).toBe(0)
    expect(readFileSync(log, 'utf8')).toBe('out\nerr\ndep.txt\n')
    expect(git('status', '--short')).toBe(before)
    expect(readdirSync(repo).sort()).toEqual(listing)
    expect(readFileSync(join(repo, 'src/pins.txt'), 'utf8')).toBe('v0.8.1\n')
    expect(existsSync(scratchRoot) ? readdirSync(scratchRoot) : []).toEqual([])
  })

  it('points the workspace links of node_modules at the base, not at the worktree', async () => {
    mkdirSync(join(repo, 'node_modules', '@scope'), { recursive: true })
    symlinkSync('../../src', join(repo, 'node_modules', '@scope', 'lib'))
    symlinkSync('../src', join(repo, 'node_modules', 'plain'))
    const result = await prove([
      'sh',
      '-c',
      'cat node_modules/@scope/lib/pins.txt node_modules/plain/pins.txt node_modules/dep.txt; exit 1',
    ])
    expect(result.code).toBe(0)
    expect(readFileSync(log, 'utf8')).toBe('v0.8.0\nv0.8.0\ndep\n')
  })

  it('skips a directory that git lists, a missing link folder and an absolute link outside the repository', async () => {
    mkdirSync(join(repo, 'nested'))
    execFileSync('git', ['init', '-q'], { cwd: join(repo, 'nested') })
    expect((await prove(['sh', '-c', 'exit 1'], '--link', 'nope')).code).toBe(0)
    const outside = await prove(['sh', '-c', 'exit 1'], '--link', dir)
    expect(outside.code).toBe(2)
    expect(outside.stderr).toContain('outside the repository')
    expect((await prove(['sh', '-c', 'exit 1'], '--link', '../x')).code).toBe(2)
  })

  it('restores an executable and a symlink of the base and reports a command ended by a signal', async () => {
    put('bin/run.sh', '#!/bin/sh\necho base\n')
    chmodSync(join(repo, 'bin/run.sh'), 0o755)
    symlinkSync('pins.txt', join(repo, 'src/ln'))
    git('add', 'bin', 'src/ln')
    git('commit', '-q', '-m', 'more')
    base = git('rev-parse', 'HEAD')
    put('bin/run.sh', '#!/bin/sh\necho changed\n')
    rmSync(join(repo, 'src/ln'))
    put('src/ln', 'regular\n')
    const result = await prove(['sh', '-c', 'bin/run.sh; readlink src/ln; exit 1'])
    expect(result.code).toBe(0)
    expect(readFileSync(log, 'utf8')).toBe('base\npins.txt\n')
    const killed = await prove(['sh', '-c', 'kill -9 $$'])
    expect(killed.code).toBe(2)
    expect(killed.stderr).toContain('ended by SIGKILL')
  })
})
