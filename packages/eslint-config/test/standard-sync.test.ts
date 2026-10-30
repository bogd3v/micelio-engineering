import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { arch, tmpdir } from 'node:os'
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

/** The version `@micelio/eslint-config` is published at from this repository. */
const PUBLISHED = (
  JSON.parse(readFileSync(`${ROOT}packages/eslint-config/package.json`, 'utf8')) as {
    version: string
  }
).version
const PACKAGE = '@micelio/eslint-config'

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

/** A stand-in for the `npm` of the runner, which must never make a lockfile. */
const HOST_NPM = `#!/usr/bin/env bash
echo "host npm $*" >> "$STUB_LOG"
exit 99
`

/**
 * The `npm` of a Node toolchain: it logs where it runs from and the folder, and rewrites the range
 * and the locked version the way `npm install <package>@<range> --package-lock-only` does.
 */
const TOOLCHAIN_NPM = `#!/usr/bin/env bash
echo "toolchain npm $* | from $(dirname "$0") | in $PWD" >> "$STUB_LOG"
if [ -n "\${STUB_NPM_FAIL:-}" ]; then echo "npm error code E404" >&2; exit 1; fi
"$REAL_NODE" -e '
  const fs = require("fs")
  const spec = process.argv[1]
  const range = spec.slice(spec.lastIndexOf("@") + 1)
  const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"))
  for (const key of ["dependencies", "devDependencies"]) {
    if (pkg[key] && pkg[key]["${PACKAGE}"]) pkg[key]["${PACKAGE}"] = range
  }
  fs.writeFileSync("package.json", JSON.stringify(pkg, null, 2) + "\\n")
  const lock = JSON.parse(fs.readFileSync("package-lock.json", "utf8"))
  const root = lock.packages[""]
  for (const key of ["dependencies", "devDependencies"]) {
    if (root[key] && root[key]["${PACKAGE}"]) root[key]["${PACKAGE}"] = range
  }
  lock.packages["node_modules/${PACKAGE}"].version = range.slice(1)
  fs.writeFileSync("package-lock.json", JSON.stringify(lock, null, 2) + "\\n")
' "$2"
`

interface Repository {
  /** The range of the package in `package.json`; no `package.json` when unset. */
  range?: string
  /** Where the package is declared. */
  section?: 'dependencies' | 'devDependencies'
  /** The text of `.nvmrc`; no file when unset. */
  nvmrc?: string
  /** Whether there is a `package-lock.json`. */
  lock?: boolean
  /** The version the lockfile installs; the range without its operator when unset. */
  locked?: string
  /** Whether the root `package.json` has npm workspaces. */
  workspaces?: boolean
  /** Whether the root `package.json` declares the package (it does not when a workspace does). */
  declared?: boolean
}

/** A repository whose lockfile already installs the published version: nothing to raise. */
const CURRENT_REPOSITORY: Repository = { range: `^${PUBLISHED}`, nvmrc: '22\n' }

interface World {
  env: NodeJS.ProcessEnv
  remotes: string
  log: string
}

/** Bare remotes for the targets, each with an AGENTS.md pinning `pin`, and the stubbed tools. */
function world(pin: string, existingPr = '', spec: Repository = CURRENT_REPOSITORY): World {
  const base = mkdtempSync(join(tmpdir(), 'micelio-sync-'))
  const remotes = join(base, 'remotes')
  const bin = join(base, 'bin')
  mkdirSync(remotes)
  mkdirSync(bin)
  writeFileSync(join(bin, 'gh'), GH)
  chmodSync(join(bin, 'gh'), 0o755)
  writeFileSync(join(bin, 'npm'), HOST_NPM)
  chmodSync(join(bin, 'npm'), 0o755)
  const dist = join(base, 'dist')
  makeDist(dist)
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
    if (spec.range !== undefined) {
      const section = spec.section ?? 'devDependencies'
      const declared = spec.declared === false ? {} : { [section]: { [PACKAGE]: spec.range } }
      const workspaces = spec.workspaces ? { workspaces: ['packages/*'] } : {}
      writeFileSync(
        join(seed, 'package.json'),
        JSON.stringify({ name: name, ...workspaces, ...declared }) + '\n'
      )
      if (spec.lock !== false) {
        const lock = {
          lockfileVersion: 3,
          packages: {
            '': { name, ...declared },
            [`node_modules/${PACKAGE}`]: {
              version: spec.locked ?? spec.range.replace(/^[^\d]*/, ''),
            },
          },
        }
        writeFileSync(join(seed, 'package-lock.json'), JSON.stringify(lock) + '\n')
      }
    }
    if (spec.nvmrc !== undefined) writeFileSync(join(seed, '.nvmrc'), spec.nvmrc)
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
    NODE_DIST: `file://${dist}`,
    REAL_NODE: process.execPath,
  }
  return { env, remotes, log }
}

/**
 * A local copy of nodejs.org/dist with Node 22.99.0, 22.98.0 and 20.1.0, each a stub toolchain
 * (`bin/node`, `bin/npm` and the npm's own semver) with a SHASUMS256.txt.
 */
function makeDist(dist: string, withSemver = true): void {
  const platform = arch() === 'arm64' ? 'linux-arm64' : 'linux-x64'
  mkdirSync(dist)
  writeFileSync(
    join(dist, 'index.json'),
    JSON.stringify(['v22.99.0', 'v22.98.0', 'v20.1.0'].map((version) => ({ version })))
  )
  for (const version of ['22.99.0', '22.98.0', '20.1.0']) {
    const archive = `node-v${version}-${platform}`
    const stage = mkdtempSync(join(tmpdir(), 'micelio-node-'))
    mkdirSync(join(stage, archive, 'bin'), { recursive: true })
    mkdirSync(join(stage, archive, 'lib/node_modules/npm/node_modules'), { recursive: true })
    writeFileSync(join(stage, archive, 'bin/node'), '#!/usr/bin/env bash\nexec "$REAL_NODE" "$@"\n')
    writeFileSync(join(stage, archive, 'bin/npm'), TOOLCHAIN_NPM)
    chmodSync(join(stage, archive, 'bin/node'), 0o755)
    chmodSync(join(stage, archive, 'bin/npm'), 0o755)
    if (withSemver) {
      cpSync(
        `${ROOT}node_modules/semver`,
        join(stage, archive, 'lib/node_modules/npm/node_modules/semver'),
        { recursive: true }
      )
    }
    mkdirSync(join(dist, `v${version}`))
    const tarball = join(dist, `v${version}`, `${archive}.tar.xz`)
    const made = spawnSync('tar', ['-cJf', tarball, '-C', stage, archive])
    if (made.status !== 0) throw new Error(`tar: ${made.stderr.toString()}`)
    const sum = createHash('sha256').update(readFileSync(tarball)).digest('hex')
    writeFileSync(join(dist, `v${version}`, 'SHASUMS256.txt'), `${sum}  ${archive}.tar.xz\n`)
  }
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

describe('standard-sync.sh raising the package', () => {
  const OLD = '^0.1.2'
  const raiser = (extra: Repository = {}): Repository => ({
    range: OLD,
    nvmrc: '22\n',
    ...extra,
  })

  /** What the branch of `repository` changed in its one commit, or undefined without a branch. */
  function pushed(w: World, repository: string): { commits: number; files: string[] } | undefined {
    const remote = join(w.remotes, `${repository.split('/')[1]}.git`)
    const branch = `docs/standard-sync-${CURRENT}`
    if (!git(remote, 'branch', '--list', branch)) return undefined
    return {
      commits: Number(git(remote, 'rev-list', '--count', `main..${branch}`)),
      files: git(remote, 'diff', '--name-only', `main..${branch}`).split('\n'),
    }
  }

  it('lists the raise in a dry run and writes nothing', () => {
    const w = world('1.3', '', raiser())
    const result = sync(w, true)
    expect(result.status, result.output).toBe(0)
    for (const repository of TARGETS.repositories) {
      expect(result.output).toContain(`::group::${repository}`)
    }
    expect(
      result.output.split(`would raise ${PACKAGE} from 0.1.2 to ${PUBLISHED}`).length - 1
    ).toBe(TARGETS.repositories.length)
    const log = readFileSync(w.log, 'utf8')
    expect(log).not.toContain('npm install')
    expect(log).not.toContain('gh pr ')
    expect(pushed(w, TARGETS.repositories[0] ?? '')).toBeUndefined()
  })

  it('raises the package in the same single commit as the synced files', () => {
    const w = world('1.3', '', raiser())
    const result = sync(w, false)
    expect(result.status, result.output).toBe(0)
    const log = readFileSync(w.log, 'utf8')
    for (const repository of TARGETS.repositories) {
      const change = pushed(w, repository)
      expect(change?.commits, repository).toBe(1)
      expect(change?.files, repository).toEqual(
        expect.arrayContaining([
          'package.json',
          'package-lock.json',
          'AGENTS.md',
          'docs/engineering-standard.md',
          ...Object.keys(loadFileHashes()),
        ])
      )
      const remote = join(w.remotes, `${repository.split('/')[1]}.git`)
      const branch = `docs/standard-sync-${CURRENT}`
      const manifest = JSON.parse(git(remote, 'show', `${branch}:package.json`)) as {
        devDependencies: Record<string, string>
      }
      const lock = JSON.parse(git(remote, 'show', `${branch}:package-lock.json`)) as {
        packages: Record<string, { version?: string }>
      }
      expect(manifest.devDependencies[PACKAGE]).toBe(`^${PUBLISHED}`)
      expect(lock.packages[`node_modules/${PACKAGE}`]?.version).toBe(PUBLISHED)
      expect(git(remote, 'log', '-1', '--format=%B', branch)).toContain(
        `raises ${PACKAGE} to ^${PUBLISHED}`
      )
      expect(git(remote, 'log', '-1', '--format=%B', branch)).not.toContain('Signed-off-by')
    }
    expect(log).toMatch(
      /toolchain npm install @micelio\/eslint-config@\^[\d.]+ --package-lock-only/
    )
    expect(log).toContain('do not push to this branch')
  })

  it('makes the lockfile with the npm of the .nvmrc, never the host npm', () => {
    const w = world('1.3', '', raiser())
    expect(sync(w, false).status).toBe(0)
    const log = readFileSync(w.log, 'utf8')
    expect(log).not.toContain('host npm')
    const installs = log.split('\n').filter((line) => line.startsWith('toolchain npm install'))
    expect(installs).toHaveLength(TARGETS.repositories.length)
    for (const line of installs) {
      expect(line).toMatch(/from \S+\/node-v22\.99\.0-linux-(x64|arm64)\/bin /)
      expect(line).toMatch(/in \S+\/micelio[\w-]*$/)
    }
  })

  it('takes the exact version of an .nvmrc that names one', () => {
    const w = world('1.3', '', raiser({ nvmrc: 'v22.98.0\n' }))
    expect(sync(w, false).status).toBe(0)
    expect(readFileSync(w.log, 'utf8')).toMatch(/from \S+\/node-v22\.98\.0-linux-/)
  })

  it('raises a runtime dependency too', () => {
    const w = world('1.3', '', raiser({ section: 'dependencies' }))
    expect(sync(w, false).status).toBe(0)
    const remote = join(w.remotes, `${(TARGETS.repositories[0] ?? '').split('/')[1]}.git`)
    const manifest = JSON.parse(
      git(remote, 'show', `docs/standard-sync-${CURRENT}:package.json`)
    ) as { dependencies: Record<string, string> }
    expect(manifest.dependencies[PACKAGE]).toBe(`^${PUBLISHED}`)
  })

  it('raises a patch the range already accepts, so the lockfile carries the new hashes', () => {
    const w = world('1.3', '', raiser({ range: '>=0.1.0 <1.0.0', locked: '0.1.9' }))
    const dry = sync(w, true)
    expect(dry.output).toContain(`would raise ${PACKAGE} from 0.1.9 to ${PUBLISHED} `)
    const result = sync(w, false)
    expect(result.status, result.output).toBe(0)
    expect(result.output).toContain(`Raised ${PACKAGE} from 0.1.9 to ${PUBLISHED}.`)
    const remote = join(w.remotes, `${(TARGETS.repositories[0] ?? '').split('/')[1]}.git`)
    const lock = JSON.parse(
      git(remote, 'show', `docs/standard-sync-${CURRENT}:package-lock.json`)
    ) as {
      packages: Record<string, { version?: string }>
    }
    expect(lock.packages[`node_modules/${PACKAGE}`]?.version).toBe(PUBLISHED)
    expect(pushed(w, TARGETS.repositories[0] ?? '')?.files).toContain('package-lock.json')
  })

  it('leaves the package alone when the lockfile already has the published version', () => {
    const w = world('1.3', '', raiser({ range: `^${PUBLISHED}`, locked: PUBLISHED }))
    const result = sync(w, false)
    expect(result.status, result.output).toBe(0)
    expect(readFileSync(w.log, 'utf8')).not.toContain('npm install')
    expect(pushed(w, TARGETS.repositories[0] ?? '')?.files).not.toContain('package-lock.json')
    expect(result.output).not.toContain('Raised')
  })

  it('never lowers a range that is newer than the published version', () => {
    const w = world('1.3', '', raiser({ range: '^99.0.0' }))
    expect(sync(w, false).status).toBe(0)
    expect(readFileSync(w.log, 'utf8')).not.toContain('npm install')
    expect(pushed(w, TARGETS.repositories[0] ?? '')?.files).not.toContain('package.json')
  })

  it('fails a repository whose root package.json does not declare the package', () => {
    const w = world('1.3', '', raiser({ declared: false }))
    const result = sync(w, false)
    expect(result.status).toBe(1)
    expect(result.output).toContain(`does not declare ${PACKAGE}`)
    expect(pushed(w, TARGETS.repositories[0] ?? '')).toBeUndefined()
  })

  it('fails a repository with npm workspaces instead of raising only the root', () => {
    for (const declared of [true, false]) {
      const w = world('1.3', '', raiser({ workspaces: true, declared }))
      const result = sync(w, true)
      expect(result.status, `declared ${declared}`).toBe(1)
      expect(result.output).toContain('npm workspaces')
      expect(result.output).not.toContain('would raise')
      expect(readFileSync(w.log, 'utf8')).not.toContain('gh pr ')
    }
  })

  it('fails a repository without a lockfile in a dry run too', () => {
    const result = sync(world('1.3', '', raiser({ lock: false })), true)
    expect(result.status).toBe(1)
    expect(result.output).not.toContain('would raise')
  })

  it('opens nothing for a repository whose lockfile cannot be made, and goes on with the rest', () => {
    const w = world('1.3', '', raiser())
    const result = sync({ ...w, env: { ...w.env, STUB_NPM_FAIL: '1' } }, false)
    expect(result.status).toBe(1)
    for (const repository of TARGETS.repositories) {
      expect(result.output).toContain(`${repository}: could not raise ${PACKAGE} to ^${PUBLISHED}`)
      expect(pushed(w, repository)).toBeUndefined()
    }
    expect(readFileSync(w.log, 'utf8')).not.toContain('pr create')
  })

  it('fails a repository without .nvmrc instead of guessing a Node', () => {
    const w = world('1.3', '', raiser({ nvmrc: undefined }))
    const result = sync(w, false)
    expect(result.status).toBe(1)
    expect(result.output).toContain('no .nvmrc')
    expect(pushed(w, TARGETS.repositories[0] ?? '')).toBeUndefined()
  })

  it('fails a repository without a lockfile instead of raising only package.json', () => {
    const w = world('1.3', '', raiser({ lock: false }))
    const result = sync(w, false)
    expect(result.status).toBe(1)
    expect(result.output).toContain('no package-lock.json')
    expect(readFileSync(w.log, 'utf8')).not.toContain('npm install')
    expect(pushed(w, TARGETS.repositories[0] ?? '')).toBeUndefined()
  })

  it('fails when the Node archive does not match its SHASUMS256.txt', () => {
    const w = world('1.3', '', raiser())
    const sums = join(w.env.NODE_DIST?.replace('file://', '') ?? '', 'v22.99.0/SHASUMS256.txt')
    expect(existsSync(sums)).toBe(true)
    writeFileSync(sums, `${'0'.repeat(64)}  ${readFileSync(sums, 'utf8').split('  ')[1] ?? ''}`)
    const result = sync(w, false)
    expect(result.status).toBe(1)
    expect(result.output).toContain('does not match SHASUMS256.txt')
    expect(readFileSync(w.log, 'utf8')).not.toContain('npm install')
    expect(pushed(w, TARGETS.repositories[0] ?? '')).toBeUndefined()
  })

  it('fails when the .nvmrc names a Node the distribution does not have', () => {
    const w = world('1.3', '', raiser({ nvmrc: '18\n' }))
    const result = sync(w, false)
    expect(result.status).toBe(1)
    expect(result.output).toContain('no Node 18')
  })

  it('fails, never "nothing to raise", when the toolchain cannot compare versions', () => {
    const w = world('1.3', '', raiser())
    const bare = join(dirname(w.log), 'dist-bare')
    makeDist(bare, false)
    const result = sync({ ...w, env: { ...w.env, NODE_DIST: `file://${bare}` } }, false)
    expect(result.status).toBe(1)
    expect(result.output).toContain('could not compare')
    expect(result.output).toContain(`could not raise ${PACKAGE}`)
    expect(pushed(w, TARGETS.repositories[0] ?? '')).toBeUndefined()
    expect(readFileSync(w.log, 'utf8')).not.toContain('pr create')
  })

  it('fails when the Node archive cannot be unpacked', () => {
    const w = world('1.3', '', raiser())
    const dist = w.env.NODE_DIST?.replace('file://', '') ?? ''
    const archive =
      readdirSync(join(dist, 'v22.99.0')).find((name) => name.endsWith('.tar.xz')) ?? ''
    const tarball = join(dist, 'v22.99.0', archive)
    writeFileSync(tarball, 'not an archive\n')
    const sum = createHash('sha256').update(readFileSync(tarball)).digest('hex')
    writeFileSync(join(dist, 'v22.99.0/SHASUMS256.txt'), `${sum}  ${archive}\n`)
    const result = sync(w, false)
    expect(result.status).toBe(1)
    expect(result.output).toContain('could not unpack Node 22.99.0')
    expect(pushed(w, TARGETS.repositories[0] ?? '')).toBeUndefined()
  })

  it('fails when the .nvmrc is not a version', () => {
    const w = world('1.3', '', raiser({ nvmrc: 'lts/*\n' }))
    const result = sync(w, false)
    expect(result.status).toBe(1)
    expect(result.output).toContain('is not a Node version')
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
