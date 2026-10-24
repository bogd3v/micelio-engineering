import { spawnSync } from 'node:child_process'
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { loadFileHashes, standardVersion } from '../src/standard.js'

const ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const WORKFLOW = readFileSync(`${ROOT}.github/workflows/standard-sync.yml`, 'utf8')
const SCRIPT = readFileSync(`${ROOT}scripts/standard-sync.sh`, 'utf8')
const TARGETS = JSON.parse(readFileSync(`${ROOT}.github/standard-sync.json`, 'utf8')) as {
  repositories: string[]
}
/** The version of the canonical copy, which the sync carries. */
const CURRENT = standardVersion(readFileSync(`${ROOT}docs/engineering-standard.md`, 'utf8')) ?? ''

/** Runs `git` in `cwd` and answers its trimmed output. */
function git(cwd: string, ...args: string[]): string {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`)
  return result.stdout.trim()
}

/** A stand-in for `gh` that clones from local bare repositories and logs what it was asked. */
const GH = `#!/usr/bin/env bash
echo "gh $*" >> "$STUB_LOG"
case "$1" in
  repo)
    if [ "$2" = clone ]; then git clone --quiet "$STUB_REMOTES/\${3#*/}.git" "$4"; else echo main; fi ;;
  pr)
    case "$2" in
      list) echo "\${STUB_EXISTING_PR:-}" ;;
      create) echo https://example.test/pr/1 ;;
      edit) ;;
    esac ;;
  api) echo 4242 ;;
  auth) ;;
  *) echo "unexpected gh $*" >&2; exit 9 ;;
esac
`

interface World {
  env: NodeJS.ProcessEnv
  remotes: string
  log: string
}

/** Bare remotes for the targets, each with an AGENTS.md pinning `pin`, and the stubbed tools. */
function world(pin: string, existingPr = ''): World {
  const base = mkdtempSync(join(tmpdir(), 'micelio-sync-'))
  const remotes = join(base, 'remotes')
  const bin = join(base, 'bin')
  mkdirSync(remotes)
  mkdirSync(bin)
  writeFileSync(join(bin, 'gh'), GH)
  chmodSync(join(bin, 'gh'), 0o755)
  for (const repository of TARGETS.repositories) {
    const name = repository.split('/')[1] ?? ''
    const seed = join(base, `seed-${name}`)
    mkdirSync(seed)
    git(seed, 'init', '-q', '-b', 'main')
    git(seed, 'config', 'user.name', 'Seed')
    git(seed, 'config', 'user.email', 'seed@example.test')
    mkdirSync(join(seed, 'docs'))
    writeFileSync(join(seed, 'docs/engineering-standard.md'), 'older\n')
    writeFileSync(
      join(seed, 'AGENTS.md'),
      `follows standard version ${pin} (\`standard: ${pin}\`)\n`
    )
    git(seed, 'add', '-A')
    git(seed, 'commit', '-q', '-m', 'seed')
    git(base, 'clone', '-q', '--bare', seed, join(remotes, `${name}.git`))
  }
  const log = join(base, 'log')
  writeFileSync(log, '')
  const env = {
    PATH: `${bin}:${process.env.PATH ?? ''}`,
    HOME: base,
    GIT_CONFIG_GLOBAL: join(base, 'gitconfig'),
    STUB_REMOTES: remotes,
    STUB_LOG: log,
    STUB_EXISTING_PR: existingPr,
    GH_TOKEN: 'not-a-real-token',
    VERSION: CURRENT,
    APP_SLUG: 'micelio-bot',
    SOURCE: 'https://example.test/micelio-engineering',
  }
  return { env, remotes, log }
}

/** Runs the sync script and answers its status and output. */
function sync(w: World, dryRun: boolean): { status: number | null; output: string } {
  const result = spawnSync('bash', [`${ROOT}scripts/standard-sync.sh`], {
    env: { ...w.env, DRY_RUN: String(dryRun) },
    encoding: 'utf8',
  })
  return { status: result.status, output: result.stdout + result.stderr }
}

describe('standard-sync.sh', () => {
  it('lists what would change in a dry run and touches nothing', () => {
    const w = world('1.3')
    const result = sync(w, true)
    expect(result.status).toBe(0)
    expect(result.output).toContain(`Dry run: would open 'docs(standard): sync to ${CURRENT}'`)
    expect(readFileSync(w.log, 'utf8')).not.toContain('gh pr ')
    for (const repository of TARGETS.repositories) {
      const remote = join(w.remotes, `${repository.split('/')[1]}.git`)
      expect(git(remote, 'branch', '--list')).not.toContain(`docs/standard-sync-${CURRENT}`)
    }
  })

  it('lists the synced files of every repository in a dry run', () => {
    const w = world('1.3')
    const result = sync(w, true)
    for (const repository of TARGETS.repositories) {
      expect(result.output).toContain(`::group::${repository}`)
    }
    for (const path of Object.keys(loadFileHashes())) {
      expect(result.output.split(path).length - 1, path).toBeGreaterThanOrEqual(
        TARGETS.repositories.length
      )
    }
  })

  it('pushes a branch as the bot and opens one pull request per repository', () => {
    const w = world('1.3')
    const result = sync(w, false)
    expect(result.status, result.output).toBe(0)
    const log = readFileSync(w.log, 'utf8')
    for (const repository of TARGETS.repositories) {
      const remote = join(w.remotes, `${repository.split('/')[1]}.git`)
      expect(git(remote, 'log', '-1', '--format=%an <%ae>', `docs/standard-sync-${CURRENT}`)).toBe(
        'micelio-bot[bot] <4242+micelio-bot[bot]@users.noreply.github.com>'
      )
      expect(git(remote, 'log', '-1', '--format=%s', `docs/standard-sync-${CURRENT}`)).toBe(
        `docs(standard): sync to ${CURRENT}`
      )
      expect(log).toContain(
        `pr create --repo ${repository} --base main --head docs/standard-sync-${CURRENT}`
      )
    }
    expect(log).not.toMatch(/gh pr (merge|review)/)
  })

  it('updates the open pull request instead of opening another', () => {
    const w = world('1.3', '7')
    expect(sync(w, false).status).toBe(0)
    const log = readFileSync(w.log, 'utf8')
    expect(log).toContain('pr edit 7')
    expect(log).not.toContain('pr create')
  })

  it('skips a repository that is already on the version', () => {
    const w = world(CURRENT)
    const source = readFileSync(`${ROOT}docs/engineering-standard.md`, 'utf8')
    for (const repository of TARGETS.repositories) {
      const dir = join(w.remotes, `${repository.split('/')[1]}.git`)
      const work = mkdtempSync(join(tmpdir(), 'micelio-sync-work-'))
      git(work, 'clone', '-q', dir, '.')
      git(work, 'config', 'user.name', 'Seed')
      git(work, 'config', 'user.email', 'seed@example.test')
      writeFileSync(join(work, 'docs/engineering-standard.md'), source)
      for (const path of Object.keys(loadFileHashes())) {
        mkdirSync(dirname(join(work, path)), { recursive: true })
        cpSync(join(ROOT, 'template', path), join(work, path))
      }
      git(work, 'add', '-A')
      git(work, 'commit', '-qm', 'current')
      git(work, 'push', '-q', 'origin', 'main')
    }
    const result = sync(w, false)
    expect(result.status).toBe(0)
    expect(result.output).toContain(`is already on standard ${CURRENT}`)
    expect(readFileSync(w.log, 'utf8')).not.toContain('gh pr ')
  })

  it('fails, without stopping the others, when a repository has no pin to move', () => {
    const w = world('1.3')
    const first = TARGETS.repositories[0]?.split('/')[1] ?? ''
    const work = mkdtempSync(join(tmpdir(), 'micelio-sync-work-'))
    git(work, 'clone', '-q', join(w.remotes, `${first}.git`), '.')
    git(work, 'config', 'user.name', 'Seed')
    git(work, 'config', 'user.email', 'seed@example.test')
    writeFileSync(join(work, 'AGENTS.md'), 'no pin\n')
    git(work, 'commit', '-qam', 'unpin')
    git(work, 'push', '-q', 'origin', 'main')
    const result = sync(w, false)
    expect(result.status).toBe(1)
    expect(result.output).toContain('has no pin to move')
    expect(readFileSync(w.log, 'utf8')).toContain('pr create')
  })
})

describe('standard-sync.yml', () => {
  it('never merges and never approves', () => {
    for (const text of [WORKFLOW, SCRIPT]) {
      expect(text).not.toMatch(/gh pr (merge|review)/)
      expect(text).not.toMatch(/--auto|--admin|enable-auto-merge|automerge/i)
    }
  })

  it('reads the private key in the token step only', () => {
    const uses = WORKFLOW.match(/MICELIO_BOT_PRIVATE_KEY/g) ?? []
    expect(uses.length).toBe(2) // the comment at the top and the one `private-key:` input
    expect(WORKFLOW).toMatch(/private-key: \$\{\{ secrets\.MICELIO_BOT_PRIVATE_KEY \}\}/)
    expect(SCRIPT).not.toContain('PRIVATE_KEY')
    expect(WORKFLOW).not.toMatch(/echo .*(token|private)/i)
  })

  it('asks the bot for the repositories of standard-sync.json and nothing more', () => {
    const listed = WORKFLOW.match(/repositories: \|\n((?:\s+[\w-]+\n)+)/)?.[1]
      ?.split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
    expect(listed).toEqual(TARGETS.repositories.map((repository) => repository.split('/')[1]))
  })

  it('only reads the repository it runs in', () => {
    expect(WORKFLOW).toContain('permissions: {}')
    expect(WORKFLOW).toMatch(/permissions:\n\s+contents: read/)
  })
})
