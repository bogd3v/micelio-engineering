import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const CHECK = readFileSync(join(ROOT, '.github/workflows/check.yml'), 'utf8')

/** The text of the job `id` of `check.yml`, up to the next job. */
function job(id: string): string {
  const start = CHECK.indexOf(`\n  ${id}:\n`)
  expect(start, `job ${id}`).toBeGreaterThan(-1)
  return CHECK.slice(start + 1).split(/\n {2}[a-z]+:\n/)[0] ?? ''
}

/** The shell of one step of a job, by its name, without the YAML indentation. */
function stepScript(jobId: string, name: string): string {
  const step =
    job(jobId)
      .split(`- name: ${name}\n`)[1]
      ?.split(/\n {6}- name: /)[0] ?? ''
  expect(step, `step ${name}`).not.toBe('')
  return (step.split('run: |\n')[1] ?? '').replace(/^ {10}/gm, '')
}

/** Runs a step script as Actions does (`bash -e`) with `env` and returns its status and output. */
function run(
  script: string,
  env: Record<string, string>,
  cwd = ROOT
): { status: number | null; output: string } {
  const result = spawnSync('bash', ['-e', '-c', script], {
    cwd,
    env: { PATH: process.env.PATH ?? '', ...env },
    encoding: 'utf8',
  })
  return { status: result.status, output: result.stdout + result.stderr }
}

/** The jobs of `check.yml` on `main` before the profile input, with the names of their steps. */
const MAIN_JOBS: Record<string, { name: string; steps: string[] }> = {
  checks: {
    name: 'Checks',
    steps: [
      'Check the inputs',
      'Checkout',
      'Enable pnpm',
      'Setup Node.js',
      'Install dependencies',
      'Audit dependencies',
      'Type check',
      'Lint',
      'Format',
      'Test',
      'Licences',
      'Copy of the standard',
    ],
  },
  reuse: { name: 'REUSE', steps: ['Checkout', 'Licensing metadata (REUSE)'] },
  build: {
    name: 'Build',
    steps: ['Checkout', 'Enable pnpm', 'Setup Node.js', 'Install dependencies', 'Build'],
  },
  check: { name: 'Check', steps: ['All jobs passed'] },
}

/** The ids of the jobs of `check.yml`, in order. */
function jobIds(): string[] {
  const jobs = CHECK.slice(CHECK.indexOf('\njobs:\n'))
  return [...jobs.matchAll(/^ {2}(\w+):$/gm)].map((m) => m[1] ?? '')
}

/** The names of the steps of a job, in order. */
function stepNames(id: string): string[] {
  return [...job(id).matchAll(/^ {6}- name: (.*)$/gm)].map((m) => m[1] ?? '')
}

describe('check.yml', () => {
  it('defaults to the typescript profile and keeps the Check status name', () => {
    expect(CHECK).toMatch(/\n {6}profile:\n(?: {8}.*\n)*? {8}default: typescript\n/)
    // A caller without profile gets the jobs and steps of main, by name: none added, none skipped.
    expect(jobIds()).toEqual(Object.keys(MAIN_JOBS))
    for (const [id, expected] of Object.entries(MAIN_JOBS)) {
      expect(stepNames(id), id).toEqual(expected.steps)
      expect(job(id), id).toMatch(new RegExp(`\\n {4}name: ${expected.name}\\n`))
    }
    expect(job('check')).toContain('needs: [checks, reuse, build]')
    // The jobs of the language run for typescript, and reuse is shared: no profile condition.
    expect(job('build')).toContain("inputs.profile == 'typescript' && inputs.build")
    expect(job('reuse')).toContain('if: ${{ inputs.reuse }}')
  })

  it('rejects a profile it does not know', () => {
    const script = stepScript('checks', 'Check the inputs')
    const env = { PM: 'npm', STANDARD: 'false' }
    for (const profile of ['typescript', 'rust']) {
      expect(run(script, { ...env, PROFILE: profile }).status).toBe(0)
    }
    for (const profile of ['go', '', 'Rust', "rust'; echo hacked"]) {
      const { status, output } = run(script, { ...env, PROFILE: profile })
      expect(status, profile).toBe(1)
      expect(output).toContain('profile must be typescript or rust')
      expect(output).not.toMatch(/^hacked$/m)
    }
    // typescript keeps its package-manager check.
    expect(run(script, { ...env, PROFILE: 'typescript', PM: 'yarn' }).status).toBe(1)
  })

  it('every action in check.yml is pinned by a commit SHA', () => {
    const uses = CHECK.split('\n').filter((line) => /^\s*(- )?uses:/.test(line))
    expect(uses.length).toBeGreaterThan(0)
    for (const line of uses) {
      expect(line).toMatch(/uses: [\w.-]+\/[\w.-]+@[0-9a-f]{40} # v\d+\.\d+\.\d+$/)
    }
  })

  it('a step before the checkout does not run in working-directory', () => {
    // The directory does not exist before the checkout, so such a step runs at the root.
    for (const id of jobIds()) {
      if (!job(id).includes('working-directory: ${{ inputs.working-directory }}')) continue
      const steps = job(id)
        .split(/\n {6}- name: /)
        .slice(1)
      for (const step of steps) {
        if (step.startsWith('Checkout\n')) break
        if (!/\n {8}run: /.test(step)) continue
        expect(step, `${id}: ${step.split('\n')[0]}`).toMatch(/\n {8}working-directory: \.\n/)
      }
    }
  })

  it('the rust profile stops on standard: true and names the gap', () => {
    const script = stepScript('checks', 'Check the inputs')
    const env = { PM: 'npm', PROFILE: 'rust' }
    expect(run(script, { ...env, STANDARD: 'false' }).status).toBe(0)
    const { status, output } = run(script, { ...env, STANDARD: 'true' })
    expect(status).toBe(1)
    expect(output).toContain('#163')
  })

  it('the rust profile runs the check line of AGENTS.md, or the input when it is set', () => {
    const script = stepScript('checks', 'Test')
    const rust = { PROFILE: 'rust' }
    const dir = mkdtempSync(join(tmpdir(), 'micelio-check-'))
    const agents = [
      '# AGENTS.md',
      '',
      '```bash',
      'check: echo from-agents   # a comment',
      '```',
      '',
      '## Commands',
      '',
      '```bash',
      'install: echo no',
      'check: echo from-commands && echo second',
      '```',
      '',
      '```bash',
      'check: echo from-later-block',
      '```',
      '',
    ].join('\n')
    writeFileSync(join(dir, 'AGENTS.md'), agents)
    const fromFile = run(script, { ...rust, CHECK_COMMAND: '' }, dir)
    expect(fromFile.status).toBe(0)
    expect(fromFile.output).toContain('second')
    expect(fromFile.output).not.toContain('from-agents')
    expect(fromFile.output).not.toContain('from-later-block')

    const override = run(script, { ...rust, CHECK_COMMAND: 'echo overridden' }, dir)
    expect(override.status).toBe(0)
    expect(override.output).toContain('overridden')

    const failing = run(script, { ...rust, CHECK_COMMAND: 'echo one && false && echo two' }, dir)
    expect(failing.status).not.toBe(0)
    expect(failing.output).not.toMatch(/^two$/m)

    writeFileSync(join(dir, 'AGENTS.md'), '# AGENTS.md\n')
    const missing = run(script, { ...rust, CHECK_COMMAND: '' }, dir)
    expect(missing.status).toBe(1)
    expect(missing.output).toContain('no check command')
  })

  it('the typescript profile still runs the test script', () => {
    const script = stepScript('checks', 'Test')
    const { status, output } = run(script, {
      PROFILE: 'typescript',
      PM: 'echo',
      TEST_SCRIPT: 'test:coverage',
      CHECK_COMMAND: 'echo wrong',
    })
    expect(status).toBe(0)
    expect(output.trim()).toBe('run test:coverage')
  })

  it('the rust fixture names the check command ci.yml runs', () => {
    const agents = readFileSync(join(ROOT, 'fixtures/rust-basic/AGENTS.md'), 'utf8')
    expect(agents).toMatch(/^check: cargo fmt --check && .*cargo test$/m)
    const ci = readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8')
    expect(ci).toMatch(/profile: rust\n\s+working-directory: fixtures\/rust-basic/)
  })
})
