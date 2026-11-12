import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const SCRIPT = join(ROOT, 'herdr/factory-agent.sh')

let root: string
let stubs: string
let agents: string
let log: string

/** A stub that appends its name, its arguments and the variables of interest to the log. */
function stub(name: string, body: string): string {
  const path = join(stubs, name)
  writeFileSync(path, `#!/usr/bin/env bash\n${body}\n`)
  chmodSync(path, 0o755)
  return path
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'factory-agent-'))
  stubs = join(root, 'stubs')
  agents = join(root, 'agents')
  log = join(root, 'calls.log')
  mkdirSync(stubs)
  writeFileSync(log, '')
  const record = `printf '%s' "$(basename "$0")" >>"${log}"; for a in "$@"; do printf ' [%s]' "$a" >>"${log}"; done; printf '\\n' >>"${log}"`
  stub('systemctl', record)
  // systemd-run runs the command it is given, as a scope does, after noting its own arguments
  stub(
    'systemd-run',
    `${record}\nprintf 'env DOCKER_HOST=%s FACTORY_AGENT=%s FACTORY_SLICE=%s PATH=%s\\n' "$DOCKER_HOST" "$FACTORY_AGENT" "$FACTORY_SLICE" "$PATH" >>"${log}"\nwhile [[ "$1" == --* ]]; do shift; done\nexec "$@"`
  )
  // the real docker: lists services for config --services, notes every other call
  stub(
    'real-docker',
    `if [[ " $* " == *" config --services "* ]]; then printf '%s\\n' \${STUB_SERVICES:-web db}; exit 0; fi\n${record}\nexit "\${STUB_EXIT:-0}"`
  )
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function run(
  args: string[],
  extra: Record<string, string> = {},
  unset: string[] = []
): { status: number | null; stdout: string; stderr: string } {
  const env: NodeJS.ProcessEnv = {
    PATH: `${stubs}:${process.env.PATH ?? ''}`,
    HOME: root,
    XDG_RUNTIME_DIR: join(root, 'run'),
    FACTORY_AGENT_DIR: agents,
    FACTORY_DOCKER: join(stubs, 'real-docker'),
    SHELL: join(stubs, 'real-docker'),
    ...extra,
  }
  for (const key of unset) delete env[key]
  const result = spawnSync('bash', [SCRIPT, ...args], { env, encoding: 'utf8', cwd: root })
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

const calls = (): string[] => readFileSync(log, 'utf8').split('\n').filter(Boolean)

/** Calls of the real docker, as seen by the stub, minus the `env` lines of systemd-run. */
const dockerCalls = (): string[] => calls().filter((line) => line.startsWith('real-docker'))

const slice = 'factory_x.slice'
const shim = { FACTORY_SLICE: slice, FACTORY_AGENT: 'x' }

describe('enter', () => {
  it('names the slice after the agent, with dashes turned into underscores, under factory.slice', () => {
    const result = run(['enter', 'worker-12', '--', 'true'])
    expect(result.status).toBe(0)
    const all = calls()
    expect(all.find((line) => line.startsWith('systemctl'))).toContain(
      '[--user] [set-property] [factory-worker_12.slice]'
    )
    expect(all.find((line) => line.startsWith('systemd-run'))).toContain(
      '[--slice=factory-worker_12.slice]'
    )
    expect(all.some((line) => line.includes('FACTORY_SLICE=factory-worker_12.slice'))).toBe(true)
  })

  it('sets MemoryMax, MemorySwapMax and CPUQuota on the slice, from the variables or the defaults', () => {
    run(['enter', 'planner', '--', 'true'])
    expect(calls().find((line) => line.startsWith('systemctl'))).toBe(
      'systemctl [--user] [set-property] [factory-planner.slice] [MemoryMax=10G] [MemorySwapMax=0] [CPUQuota=800%]'
    )
    writeFileSync(log, '')
    run(['enter', 'planner', '--', 'true'], {
      FACTORY_AGENT_MEMORY: '4G',
      FACTORY_AGENT_CPU: '200%',
    })
    expect(calls().find((line) => line.startsWith('systemctl'))).toBe(
      'systemctl [--user] [set-property] [factory-planner.slice] [MemoryMax=4G] [MemorySwapMax=0] [CPUQuota=200%]'
    )
  })

  it('runs the command in a scope of the slice with DOCKER_HOST, FACTORY_SLICE and the shim first on PATH', () => {
    const result = run(['enter', 'worker-3', '--', 'echo', 'hi'])
    expect(result.status).toBe(0)
    const all = calls()
    expect(all.find((line) => line.startsWith('systemd-run'))).toBe(
      'systemd-run [--user] [--scope] [--quiet] [--slice=factory-worker_3.slice] [echo] [hi]'
    )
    const env = all.find((line) => line.startsWith('env '))
    const bin = join(agents, 'worker-3', 'bin')
    expect(env).toContain(`DOCKER_HOST=unix://${join(root, 'run')}/podman/podman.sock`)
    expect(env).toContain('FACTORY_AGENT=worker-3')
    expect(env).toContain('FACTORY_SLICE=factory-worker_3.slice')
    expect(env).toContain(`PATH=${bin}:`)
    const shimBody = readFileSync(join(bin, 'docker'), 'utf8')
    expect(shimBody).toContain(`${SCRIPT} docker -- "$@"`)
  })

  it('refuses an agent name herdr would refuse, with exit 2', () => {
    for (const name of ['Worker', '1abc', 'a b', 'a.b', '', 'a'.repeat(33), '../x']) {
      const result = run(['enter', name, '--', 'true'])
      expect(result.status, name).toBe(2)
    }
    expect(run(['enter', 'a'.repeat(32), '--', 'true']).status).toBe(0)
    expect(readdirSync(agents)).toEqual(['a'.repeat(32)])
  })

  it('stop removes the agent directory and refuses a bad name', () => {
    run(['enter', 'gone', '--', 'true'])
    expect(existsSync(join(agents, 'gone'))).toBe(true)
    expect(run(['stop', 'gone']).status).toBe(0)
    expect(existsSync(join(agents, 'gone'))).toBe(false)
    expect(run(['stop', '../x']).status).toBe(2)
  })
})

describe('the shim', () => {
  it('adds an override with cgroup_parent on exactly the services of the files given with -f', () => {
    const result = run(
      ['docker', '--', 'compose', '-f', 'a.yml', '-f', 'b.yml', '-p', 'probe', 'up', '-d'],
      { ...shim, STUB_SERVICES: 'web db' }
    )
    expect(result.status).toBe(0)
    const files = readdirSync(join(agents, 'x'))
    expect(files).toHaveLength(1)
    const override = join(agents, 'x', files[0] as string)
    expect(files[0]).toMatch(/^override-\d+\.yml$/)
    expect(readFileSync(override, 'utf8')).toBe(
      `services:\n  web:\n    cgroup_parent: ${slice}\n  db:\n    cgroup_parent: ${slice}\n`
    )
    expect(dockerCalls()).toEqual([
      `real-docker [compose] [-f] [a.yml] [-f] [b.yml] [-p] [probe] [-f] [${override}] [up] [-d]`,
    ])
  })

  it('appends the override to COMPOSE_FILE when no -f is given', () => {
    // the stub notes COMPOSE_FILE through a wrapper of the real docker
    stub(
      'real-docker',
      `if [[ " $* " == *" config --services "* ]]; then echo web; exit 0; fi\necho "COMPOSE_FILE=$COMPOSE_FILE args=$*" >>"${log}"`
    )
    const result = run(['docker', '--', 'compose', '-p', 'probe', 'up', '-d'], {
      ...shim,
      COMPOSE_FILE: 'base.yml:over.yml',
    })
    expect(result.status).toBe(0)
    const files = readdirSync(join(agents, 'x'))
    const override = join(agents, 'x', files[0] as string)
    expect(calls()).toEqual([
      `COMPOSE_FILE=base.yml:over.yml:${override} args=compose -p probe up -d`,
    ])
    expect(readFileSync(override, 'utf8')).toBe(`services:\n  web:\n    cgroup_parent: ${slice}\n`)
  })

  it('finds the compose file compose itself would use when neither -f nor COMPOSE_FILE is given', () => {
    writeFileSync(join(root, 'compose.yaml'), 'services: {}\n')
    writeFileSync(join(root, 'compose.override.yaml'), 'services: {}\n')
    const result = run(['docker', '--', 'compose', 'up'], shim)
    expect(result.status).toBe(0)
    const override = join(agents, 'x', readdirSync(join(agents, 'x'))[0] as string)
    const real = realpathSync(root)
    expect(dockerCalls()).toEqual([
      `real-docker [compose] [--project-directory] [${real}] [-f] [${real}/compose.yaml] [-f] [${real}/compose.override.yaml] [-f] [${override}] [up]`,
    ])
  })

  it("uses compose's order of names and any of its override names", () => {
    writeFileSync(join(root, 'docker-compose.yaml'), 'services: {}\n')
    writeFileSync(join(root, 'docker-compose.yml'), 'services: {}\n')
    writeFileSync(join(root, 'docker-compose.override.yml'), 'services: {}\n')
    const result = run(['docker', '--', 'compose', 'up'], shim)
    expect(result.status).toBe(0)
    const override = join(agents, 'x', readdirSync(join(agents, 'x'))[0] as string)
    const real = realpathSync(root)
    expect(dockerCalls()).toEqual([
      `real-docker [compose] [--project-directory] [${real}] [-f] [${real}/docker-compose.yml] [-f] [${real}/docker-compose.override.yml] [-f] [${override}] [up]`,
    ])
  })

  it('adds --cgroup-parent to docker run and docker create, and keeps one already given', () => {
    run(['docker', '--', 'run', '--rm', 'node:22', 'true'], shim)
    run(['docker', '--', 'create', 'node:22'], shim)
    run(['docker', '--', 'container', 'run', 'node:22'], shim)
    run(['docker', '--', 'container', 'create', 'node:22'], shim)
    run(['docker', '--', 'run', '--cgroup-parent=mine.slice', 'node:22'], shim)
    run(['docker', '--', 'run', '--cgroup-parent', 'mine.slice', 'node:22'], shim)
    expect(dockerCalls()).toEqual([
      `real-docker [run] [--cgroup-parent=${slice}] [--rm] [node:22] [true]`,
      `real-docker [create] [--cgroup-parent=${slice}] [node:22]`,
      `real-docker [container] [run] [--cgroup-parent=${slice}] [node:22]`,
      `real-docker [container] [create] [--cgroup-parent=${slice}] [node:22]`,
      'real-docker [run] [--cgroup-parent=mine.slice] [node:22]',
      'real-docker [run] [--cgroup-parent] [mine.slice] [node:22]',
    ])
  })

  it('passes every other command through, and every command when FACTORY_SLICE is unset', () => {
    run(['docker', '--', 'ps', '-a'], shim)
    run(['docker', '--', 'compose', 'version'], { ...shim, STUB_SERVICES: '' })
    run(['docker', '--', 'run', 'node:22'], {}, ['FACTORY_SLICE'])
    run(['docker', '--', 'compose', '-f', 'a.yml', 'up'], {}, ['FACTORY_SLICE'])
    expect(dockerCalls()).toEqual([
      'real-docker [ps] [-a]',
      'real-docker [compose] [version]',
      'real-docker [run] [node:22]',
      'real-docker [compose] [-f] [a.yml] [up]',
    ])
    expect(existsSync(agents)).toBe(false)
  })

  it('returns the exit code of the real docker', () => {
    expect(run(['docker', '--', 'ps'], { ...shim, STUB_EXIT: '7' }).status).toBe(7)
    expect(run(['docker', '--', 'run', 'x'], { ...shim, STUB_EXIT: '3' }).status).toBe(3)
    expect(
      run(['docker', '--', 'compose', '-f', 'a.yml', 'up'], { ...shim, STUB_EXIT: '5' }).status
    ).toBe(5)
    expect(run(['docker', '--', 'ps'], { ...shim, STUB_EXIT: '0' }).status).toBe(0)
  })
})
