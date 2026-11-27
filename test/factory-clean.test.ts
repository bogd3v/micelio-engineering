import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const SCRIPT = join(ROOT, 'herdr/factory-clean.sh')
const SLOT = join(ROOT, 'herdr/factory-slot.sh')

/** The issue and its name in the runbook, as the master passes them. */
const ISSUE = 'example/repo#77'
const NAME = '77'
const BRANCH = 'feat/factory-77'

/** Tools the script, `factory-slot.sh status` and git need, linked into a PATH with none of the stubbed ones. */
const TOOLS = [
  'bash',
  'sh',
  'env',
  'git',
  'sed',
  'grep',
  'head',
  'ps',
  'date',
  'readlink',
  'tr',
  'basename',
  'dirname',
  'rm',
  'mkdir',
  'cat',
  'id',
]

/** The real `rm`, which the stubs call by its path. */
const REAL_RM = spawnSync('sh', ['-c', 'command -v rm'], { encoding: 'utf8' }).stdout.trim()

let root: string
let checkout: string
let worktree: string
let packets: string
let scratch: string
let runTmp: string
let slots: string
let calls: string
let tools: string

/** Runs `git` in `cwd` with a fixed identity, failing the test on a non-zero exit. */
function git(cwd: string, ...args: string[]): string {
  const r = spawnSync(
    'git',
    ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args],
    {
      cwd,
      encoding: 'utf8',
    }
  )
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`)
  return r.stdout
}

/** Writes an executable `sh` script. */
function script(path: string, body: string): void {
  writeFileSync(path, `#!/bin/sh\n${body}`)
  chmodSync(path, 0o755)
}

/**
 * `gh` as gh 2.97.0 answers: `issue view … --json state -q .state` prints the
 * state and exits 0, `pr list … --json number -q '.[].number'` prints one number per merged pull
 * request (nothing when none); one it cannot read is a message on stderr and exit 1
 * (`GH_STATE=fail`, `GH_PR=fail`).
 */
function stubGh(bin: string): void {
  script(
    join(bin, 'gh'),
    `echo "$*" >> "${calls}/gh"
case "$1 $2" in
  "issue view")
    [ "$*" = "issue view 77 --repo example/repo --json state -q .state" ] || exit 64
    [ "$GH_STATE" = fail ] && { echo "GraphQL: Could not resolve to an issue" >&2; exit 1; }
    echo "$GH_STATE" ;;
  "pr list")
    [ "$GH_PR" = fail ] && { echo "GraphQL: Could not resolve to a Repository" >&2; exit 1; }
    for n in $GH_MERGED; do echo "$n"; done ;;
  *) exit 64 ;;
esac
`
  )
}

/**
 * `docker` 29.10.0: records each call in `docker` and the `DOCKER_HOST` it got in `docker-host`;
 * `version --format {{.Server.Version}}` prints the engine's version (Podman 5.8.9), `compose … down`
 * prints nothing and exits 0, and `image ls` prints the lines of `images`. With no engine
 * (`DOCKER_ENGINE=none`) `version` prints an empty line on stdout, its error on stderr and exits 1; an
 * `image ls` that fails (`DOCKER_IMAGE_LS=fail`) prints only on stderr and exits 1.
 */
function stubDocker(bin: string, images: string[]): void {
  writeFileSync(join(root, 'images'), images.map((i) => `${i}\n`).join(''))
  script(
    join(bin, 'docker'),
    `echo "$*" >> "${calls}/docker"
echo "$DOCKER_HOST" >> "${calls}/docker-host"
unreachable() {
  echo "failed to connect to the docker API at $DOCKER_HOST; check if the path is correct and if the daemon is running" >&2
  exit 1
}
case "$1 $2" in
  "version --format")
    [ "$DOCKER_ENGINE" = none ] && { echo; unreachable; }
    echo 5.8.9 ;;
  "image ls")
    [ "$DOCKER_IMAGE_LS" = fail ] && unreachable
    cat "${join(root, 'images')}" ;;
esac
exit 0
`
  )
}

/** `podman unshare <command>` runs the command and exits with its code, as podman 5.8.9 does. */
function stubPodman(bin: string): void {
  script(
    join(bin, 'podman'),
    `echo "$*" >> "${calls}/podman"
[ "$1" = unshare ] || exit 64
shift
[ "$1" = rm ] && { shift; exec "${REAL_RM}" "$@"; }
exec "$@"
`
  )
}

/** `rm` that fails as a rootless build's files make it fail for any argument under `denied`. */
function stubRm(bin: string, denied: string): void {
  script(
    join(bin, 'rm'),
    `for a in "$@"; do
  case "$a" in
    "${denied}"*) echo "rm: cannot remove '$a/d/f': Permission denied" >&2; exit 1 ;;
  esac
done
exec "${REAL_RM}" "$@"
`
  )
}

/** `hc`: the script never needs it; a call is recorded and fails. */
function stubHc(bin: string): void {
  script(join(bin, 'hc'), `echo "$*" >> "${calls}/hc"\nexit 64\n`)
}

interface Stubs {
  docker?: string[]
  podman?: boolean
  rmDenied?: string
}

/** A PATH with `gh`, `hc` and the asked stubs first, then the linked tools; a tool left out is missing. */
function pathWith(stubs: Stubs): string {
  const bin = mkdtempSync(join(root, 'bin-'))
  stubGh(bin)
  stubHc(bin)
  if (stubs.docker !== undefined) stubDocker(bin, stubs.docker)
  if (stubs.podman === true) stubPodman(bin)
  if (stubs.rmDenied !== undefined) stubRm(bin, stubs.rmDenied)
  return `${bin}:${tools}`
}

interface Run {
  code: number | null
  out: string
  err: string
}

/** Runs the script for `ISSUE` and `NAME` with the given gh answers and stubs. */
function clean(
  opts: {
    state?: string
    merged?: string
    pr?: string
    name?: string
    dry?: boolean
    env?: Record<string, string>
  } & Stubs = {}
): Run {
  const args = [ISSUE, opts.name ?? NAME, '--checkout', checkout, '--packets', packets]
  if (opts.dry === true) args.push('--dry-run')
  const r = spawnSync('bash', [SCRIPT, ...args], {
    env: {
      HOME: root,
      TMPDIR: process.env['TMPDIR'],
      PATH: pathWith(opts),
      FACTORY_TMP: scratch,
      FACTORY_RUN_TMP: runTmp,
      FACTORY_SLOT_DIR: slots,
      GH_STATE: opts.state ?? 'CLOSED',
      GH_MERGED: opts.merged ?? '12',
      GH_PR: opts.pr ?? '',
      ...opts.env,
    },
    encoding: 'utf8',
  })
  return { code: r.status, out: r.stdout, err: r.stderr }
}

/** The arguments of each call to a stub, one line each; none when it was never called. */
function callsOf(stub: string): string[] {
  const file = join(calls, stub)
  return existsSync(file) ? readFileSync(file, 'utf8').trim().split('\n') : []
}

const hasBranch = (): boolean => git(checkout, 'branch', '--list', BRANCH).trim() !== ''

/** The agents' scratch the script removes, and folders of other names it leaves. */
const SCRATCH = ['worker-77', 'reviewer-77', 'reviewer-77-r2', 'verifier-77', 'verifier-77-r3']
const OTHER_SCRATCH = ['worker-770', 'reviewer-770', 'verifier-77-x', 'worker-7', 'scribe']

/** A PID that has exited: the wrapper of a run folder that `reap` left. */
function deadPid(): number {
  return Number(spawnSync('sh', ['-c', 'echo $$'], { encoding: 'utf8' }).stdout.trim())
}

/** Every path the script may remove, to check that each still exists. */
function everything(): string[] {
  return [
    worktree,
    join(packets, NAME, 'logs/check.log'),
    ...SCRATCH.map((s) => join(scratch, s)),
    ...OTHER_SCRATCH.map((s) => join(scratch, s)),
  ]
}

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'factory-clean-')))
  calls = join(root, 'calls')
  mkdirSync(calls)
  tools = join(root, 'tools')
  mkdirSync(tools)
  for (const tool of TOOLS) {
    const found = spawnSync('sh', ['-c', `command -v ${tool}`], { encoding: 'utf8' }).stdout.trim()
    if (found !== '') symlinkSync(found, join(tools, tool))
  }
  checkout = join(root, 'repo')
  mkdirSync(checkout)
  git(checkout, 'init', '-q', '-b', 'main')
  writeFileSync(join(checkout, '.gitignore'), 'node_modules\n')
  writeFileSync(join(checkout, 'README.md'), 'repo\n')
  git(checkout, 'add', '.')
  git(checkout, 'commit', '-q', '-m', 'init')
  worktree = join(root, `wt-${NAME}`)
  git(checkout, 'worktree', 'add', '-q', worktree, '-b', BRANCH)
  // Ignored files do not make a worktree dirty: `git status --short` prints nothing for them.
  mkdirSync(join(worktree, 'node_modules'))
  writeFileSync(join(worktree, 'node_modules/x.js'), '')
  packets = join(root, 'packets')
  mkdirSync(join(packets, NAME, 'logs'), { recursive: true })
  writeFileSync(join(packets, NAME, 'logs/check.log'), 'ok\n')
  mkdirSync(join(packets, '770'))
  scratch = join(root, 'tmp')
  for (const s of [...SCRATCH, ...OTHER_SCRATCH]) {
    mkdirSync(join(scratch, s), { recursive: true })
    writeFileSync(join(scratch, s, 'file'), '')
  }
  runTmp = join(root, 'run-tmp')
  mkdirSync(runTmp)
  slots = join(root, 'slots')
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('factory-clean.sh', () => {
  it('removes nothing and exits 1 while the issue is open', () => {
    for (const state of ['OPEN', 'fail']) {
      const r = clean({ state, docker: ['example-app:77'], podman: true })
      expect(r.code, state).toBe(1)
      expect(r.out, state).toBe('')
      expect(r.err, state).toContain('example/repo#77 is not closed')
    }
    for (const path of everything()) expect(existsSync(path), path).toBe(true)
    expect(hasBranch()).toBe(true)
    expect(callsOf('gh')).toEqual([
      'issue view 77 --repo example/repo --json state -q .state',
      'issue view 77 --repo example/repo --json state -q .state',
    ])
    expect(callsOf('docker')).toEqual([])
    expect(callsOf('podman')).toEqual([])
  })

  it('removes nothing and exits 1 while an agent of the issue holds a lease or a slot', () => {
    const env = { ...process.env, FACTORY_SLOT_DIR: slots }
    const acquire = (agent: string) =>
      spawnSync('bash', [SLOT, 'acquire', '--pool', 'workers', '--agent', agent], { env })
    const release = (agent: string) =>
      spawnSync('bash', [SLOT, 'release', '--agent', agent], { env })

    expect(acquire('worker-77').status).toBe(0)
    let r = clean({ docker: [] })
    expect(r.code).toBe(1)
    expect(r.out).toBe('')
    expect(r.err).toContain('worker-77 holds a workers entry')
    release('worker-77')

    // A heavy slot whose owner file names a reviewer of round 2.
    mkdirSync(join(slots, 'heavy'), { recursive: true })
    writeFileSync(
      join(slots, 'heavy/slot-1.owner'),
      `pid=${String(process.pid)}\npgid=${String(process.pid)}\nwrapper=${String(process.pid)}\n` +
        `agent=reviewer-77-r2\nstart=1\ncommand=npm run check\n`
    )
    r = clean({ docker: [] })
    expect(r.code).toBe(1)
    expect(r.out).toBe('')
    expect(r.err).toContain('reviewer-77-r2 holds a heavy entry')
    for (const path of everything()) expect(existsSync(path), path).toBe(true)
    expect(hasBranch()).toBe(true)
    expect(callsOf('docker')).toEqual([])

    // An agent of another issue whose name starts the same holds nothing of this one.
    rmSync(join(slots, 'heavy/slot-1.owner'))
    expect(acquire('worker-770').status).toBe(0)
    r = clean()
    expect(r.code).toBe(0)
    expect(r.out).toContain(`removed ${worktree}`)
  })

  it('refuses a name outside [a-z0-9]{1,16} and removes nothing', () => {
    for (const name of ['', 'Wt77', '../77', '77/..', '7 7', 'w-77', 'a'.repeat(17), '*']) {
      const r = clean({ name, docker: ['example-app:77'], podman: true })
      expect(r.code, name).toBe(1)
      expect(r.out, name).toBe('')
      expect(r.err, name).toContain('the name must match [a-z0-9]{1,16}')
    }
    // The longest name that passes reaches the next guard.
    expect(clean({ name: 'a'.repeat(16), state: 'OPEN' }).err).toContain('is not closed')
    for (const path of everything()) expect(existsSync(path), path).toBe(true)
    expect(callsOf('gh')).toEqual(['issue view 77 --repo example/repo --json state -q .state'])
    expect(callsOf('docker')).toEqual([])
  })

  it("removes the clean worktree of a merged pull request, its branch, its packet and its agents' scratch", () => {
    const r = clean()
    expect(r.err).toBe('')
    expect(r.code).toBe(0)
    const lines = r.out.trim().split('\n')
    expect(lines).toEqual([
      `removed ${worktree}`,
      `removed branch ${BRANCH}`,
      `removed ${join(packets, NAME)}`,
      ...SCRATCH.map((s) => `removed ${join(scratch, s)}`),
      'skipped stacks: no docker',
    ])
    expect(existsSync(worktree)).toBe(false)
    expect(hasBranch()).toBe(false)
    expect(git(checkout, 'worktree', 'list', '--porcelain')).not.toContain(worktree)
    expect(existsSync(join(packets, NAME))).toBe(false)
    expect(existsSync(join(packets, '770'))).toBe(true)
    for (const s of SCRATCH) expect(existsSync(join(scratch, s)), s).toBe(false)
    for (const s of OTHER_SCRATCH) expect(existsSync(join(scratch, s)), s).toBe(true)
    expect(callsOf('gh')).toEqual([
      'issue view 77 --repo example/repo --json state -q .state',
      `pr list --repo example/repo --head ${BRANCH} --state merged --json number -q .[].number`,
    ])
    expect(callsOf('hc')).toEqual([])

    // Once the worktree is gone, a second run removes nothing more and still succeeds.
    const again = clean()
    expect(again.code).toBe(0)
    expect(again.out).toBe('skipped stacks: no docker\n')
  })

  it('keeps a worktree with uncommitted work, its branch and its packet, and says why', () => {
    writeFileSync(join(worktree, 'draft.txt'), 'work\n')
    const r = clean()
    expect(r.code).toBe(0)
    expect(r.out).toContain(`kept ${worktree}: uncommitted work\n`)
    expect(r.out).toContain(`kept ${join(packets, NAME)}: its worktree stays\n`)
    expect(r.out).not.toContain(`removed ${worktree}`)
    expect(r.out).not.toContain(`removed ${join(packets, NAME)}`)
    expect(existsSync(join(worktree, 'draft.txt'))).toBe(true)
    expect(existsSync(join(packets, NAME, 'logs/check.log'))).toBe(true)
    expect(hasBranch()).toBe(true)
    // A tracked file changed counts the same.
    rmSync(join(worktree, 'draft.txt'))
    writeFileSync(join(worktree, 'README.md'), 'changed\n')
    expect(clean().out).toContain(`kept ${worktree}: uncommitted work\n`)
    expect(existsSync(worktree)).toBe(true)
    expect(hasBranch()).toBe(true)
    // No pull request is asked about while the worktree has uncommitted work.
    expect(callsOf('gh').filter((c) => c.startsWith('pr list'))).toEqual([])
  })

  it('keeps the worktree of a branch whose pull request is not merged', () => {
    const r = clean({ merged: '' })
    expect(r.code).toBe(0)
    expect(r.out).toContain(`kept ${worktree}: the pull request of ${BRANCH} is not merged\n`)
    expect(r.out).toContain(`kept ${join(packets, NAME)}: its worktree stays\n`)
    // gh failing is no answer: the worktree stays too.
    const failed = clean({ pr: 'fail' })
    expect(failed.out).toContain(`kept ${worktree}: cannot read the pull requests of ${BRANCH}\n`)
    expect(existsSync(worktree)).toBe(true)
    expect(existsSync(join(packets, NAME, 'logs/check.log'))).toBe(true)
    expect(hasBranch()).toBe(true)
    expect(callsOf('gh').filter((c) => c.startsWith('pr list'))).toEqual([
      `pr list --repo example/repo --head ${BRANCH} --state merged --json number -q .[].number`,
      `pr list --repo example/repo --head ${BRANCH} --state merged --json number -q .[].number`,
    ])
  })

  it('keeps a wt-name that is no worktree of the checkout, or one with no branch, and its packet', () => {
    git(worktree, 'checkout', '-q', '--detach')
    expect(clean().out).toContain(`kept ${worktree}: no branch checked out\n`)
    git(checkout, 'worktree', 'remove', worktree)
    mkdirSync(worktree)
    writeFileSync(join(worktree, 'notes.txt'), 'mine\n')
    const r = clean()
    expect(r.out).toContain(`kept ${worktree}: not a worktree of ${checkout}\n`)
    expect(r.out).toContain(`kept ${join(packets, NAME)}: its worktree stays\n`)
    expect(existsSync(join(worktree, 'notes.txt'))).toBe(true)
    expect(existsSync(join(packets, NAME, 'logs/check.log'))).toBe(true)
  })

  it('brings the stacks name and namev down with their volumes and local images, and removes only the images tagged name or namev', () => {
    const images = [
      'node:22',
      'moby/buildkit:buildx-stable-1',
      'example-frontend:77',
      'example-frontend:77v',
      'example-cms:77v',
      'example-frontend:770',
      'example-frontend:v77',
      '77-cms:latest',
      'example-77:latest',
      '<none>:<none>',
    ]
    const r = clean({ docker: images })
    expect(r.code).toBe(0)
    expect(r.out).toContain(
      [
        'removed stack 77',
        'removed stack 77v',
        'removed image example-frontend:77',
        'removed image example-frontend:77v',
        'removed image example-cms:77v',
      ].join('\n')
    )
    expect(callsOf('docker')).toEqual([
      'version --format {{.Server.Version}}',
      'compose -p 77 down -v --rmi local',
      'compose -p 77v down -v --rmi local',
      'image ls --format {{.Repository}}:{{.Tag}}',
      'image rm example-frontend:77',
      'image rm example-frontend:77v',
      'image rm example-cms:77v',
    ])
    expect(callsOf('docker').join('\n')).not.toContain('buildx_buildkit_default')
  })

  it('runs docker against the Podman socket of XDG_RUNTIME_DIR when DOCKER_HOST is unset, and keeps a DOCKER_HOST that is set', () => {
    const runtime = join(root, 'runtime')
    const socket = `unix://${runtime}/podman/podman.sock`
    const user = `unix:///run/user/${String(process.getuid?.())}/podman/podman.sock`
    const set = 'unix:///run/example/engine.sock'
    const cases: [Record<string, string>, string][] = [
      [{ XDG_RUNTIME_DIR: runtime }, socket],
      [{ XDG_RUNTIME_DIR: runtime, DOCKER_HOST: '' }, socket],
      [{ XDG_RUNTIME_DIR: runtime, DOCKER_HOST: set }, set],
      [{}, user],
    ]
    for (const [env, host] of cases) {
      rmSync(join(calls, 'docker-host'), { force: true })
      const r = clean({ env, docker: ['example-app:77'] })
      expect(r.err, host).toBe('')
      expect(r.code, host).toBe(0)
      // The probe, both stacks, the image list and the removal of the image.
      expect(callsOf('docker-host'), JSON.stringify(env)).toEqual(Array<string>(5).fill(host))
    }
  })

  it('prints stuck stacks once and runs no compose or image call when the engine does not answer', () => {
    const env = { DOCKER_ENGINE: 'none', DOCKER_HOST: 'unix:///run/example/engine.sock' }
    const stuck = 'stuck stacks: no engine at unix:///run/example/engine.sock'
    for (const dry of [true, false]) {
      rmSync(join(calls, 'docker'), { force: true })
      const dead = join(runTmp, `run-${String(deadPid())}`)
      mkdirSync(dead, { recursive: true })
      const r = clean({ dry, env, docker: ['example-app:77'] })
      expect(r.code, String(dry)).toBe(1)
      expect(r.err, String(dry)).toBe('')
      expect(
        r.out.split('\n').filter((l) => /stack|image/.test(l)),
        String(dry)
      ).toEqual([stuck])
      expect(callsOf('docker'), String(dry)).toEqual(['version --format {{.Server.Version}}'])
      // The next step still runs.
      expect(r.out, String(dry)).toContain(`${dry ? 'would remove' : 'removed'} ${dead}\n`)
    }
  })

  it('prints stuck images when the image list fails', () => {
    for (const dry of [true, false]) {
      rmSync(join(calls, 'docker'), { force: true })
      const r = clean({ dry, env: { DOCKER_IMAGE_LS: 'fail' }, docker: ['example-app:77'] })
      expect(r.code, String(dry)).toBe(1)
      expect(r.err, String(dry)).toBe('')
      expect(r.out, String(dry)).toContain('stuck images: cannot list them\n')
      expect(r.out, String(dry)).not.toMatch(/(removed|would remove) image/)
      expect(callsOf('docker').at(-1), String(dry)).toBe(
        'image ls --format {{.Repository}}:{{.Tag}}'
      )
    }
  })

  it("removes a dead wrapper's run folder that rm cannot remove through podman unshare, and prints stuck without podman", () => {
    const dead = join(runTmp, `run-${String(deadPid())}`)
    const live = join(runTmp, `run-${String(process.pid)}`)
    const odd = join(runTmp, 'run-abc')
    for (const dir of [dead, live, odd]) {
      mkdirSync(join(dir, 'd'), { recursive: true })
      writeFileSync(join(dir, 'd/f'), '')
    }

    const stuck = clean({ rmDenied: dead })
    expect(stuck.code).toBe(1)
    expect(stuck.out).toContain(`stuck ${dead}\n`)
    expect(existsSync(join(dead, 'd/f'))).toBe(true)

    const removed = clean({ rmDenied: dead, podman: true })
    expect(removed.code).toBe(0)
    expect(removed.out).toContain(`removed ${dead}\n`)
    expect(existsSync(dead)).toBe(false)
    expect(callsOf('podman')).toEqual([`unshare rm -rf -- ${dead}`])
    // A live wrapper's folder and one that is no run-<PID> stay.
    expect(existsSync(join(live, 'd/f'))).toBe(true)
    expect(existsSync(join(odd, 'd/f'))).toBe(true)
  })

  it("keeps a dead wrapper's run folder while its command runs", () => {
    const wrapper = deadPid()
    const dir = join(runTmp, `run-${String(wrapper)}`)
    mkdirSync(dir)
    mkdirSync(join(slots, 'heavy'), { recursive: true })
    writeFileSync(
      join(slots, 'heavy/slot-1.owner'),
      `pid=${String(process.pid)}\npgid=${String(process.pid)}\nwrapper=${String(wrapper)}\n` +
        `agent=worker-9\nstart=1\ncommand=npm test\n`
    )
    const r = clean()
    expect(r.code).toBe(0)
    expect(r.out).not.toContain(dir)
    expect(existsSync(dir)).toBe(true)
  })

  it('--dry-run prints what it would remove and removes nothing', () => {
    const dead = join(runTmp, `run-${String(deadPid())}`)
    mkdirSync(dead)
    const r = clean({ dry: true, docker: ['node:22', 'example-frontend:77'], podman: true })
    expect(r.code).toBe(0)
    expect(r.out.trim().split('\n')).toEqual([
      `would remove ${worktree}`,
      `would remove branch ${BRANCH}`,
      `would remove ${join(packets, NAME)}`,
      ...SCRATCH.map((s) => `would remove ${join(scratch, s)}`),
      'would remove stack 77',
      'would remove stack 77v',
      'would remove image example-frontend:77',
      `would remove ${dead}`,
    ])
    for (const path of [...everything(), dead]) expect(existsSync(path), path).toBe(true)
    expect(hasBranch()).toBe(true)
    expect(callsOf('docker')).toEqual([
      'version --format {{.Server.Version}}',
      'image ls --format {{.Repository}}:{{.Tag}}',
    ])
    expect(callsOf('podman')).toEqual([])
  })
})
