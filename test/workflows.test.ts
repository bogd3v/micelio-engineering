import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { tempDir } from './support/temp.js'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const CHECK = readFileSync(join(ROOT, '.github/workflows/check.yml'), 'utf8')
const ACTION = readFileSync(join(ROOT, '.github/actions/lint-standard/action.yml'), 'utf8')

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

/**
 * Runs a step script as Actions does (`bash -e`) with `env` and returns its status and output. stdin
 * is `ignore`: with a socket as stdin, a bash built with `SSH_SOURCE_BASHRC` reads the host's
 * `~/.bashrc`, and the step scripts read nothing from stdin.
 */
function run(
  script: string,
  env: Record<string, string>,
  cwd = ROOT
): { status: number | null; output: string } {
  const result = spawnSync('bash', ['-e', '-c', script], {
    cwd,
    env: { PATH: process.env.PATH ?? '', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
  })
  return { status: result.status, output: result.stdout + result.stderr }
}

/**
 * The `uses:` lines of a workflow that break the pinning rule (section 10): a remote action must be
 * pinned by commit SHA with `# vX.Y.Z`; the one local action allowed is the lint-standard action,
 * and only when the checkout step before it has `ref: ${{ inputs.tools-ref }}`.
 */
function unpinned(workflow: string): string[] {
  const problems: string[] = []
  let checkoutRef: string | undefined
  for (const step of workflow.split(/\n(?= +- name: )/)) {
    for (const line of step.split('\n').filter((l) => /^\s*(- )?uses:/.test(l))) {
      if (line.includes('uses: ./')) {
        const allowed =
          line === '        uses: ./.micelio-engineering/.github/actions/lint-standard' &&
          checkoutRef === '${{ inputs.tools-ref }}'
        if (!allowed) problems.push(line)
      } else if (!/uses: [\w.-]+\/[\w.-]+@[0-9a-f]{40} # v\d+\.\d+\.\d+$/.test(line)) {
        problems.push(line)
      }
      if (line.includes('uses: actions/checkout@')) {
        checkoutRef = /\n +ref: (.*)\n/.exec(`${step}\n`)?.[1]
      }
    }
  }
  return problems
}

/**
 * The jobs of `check.yml` on `main` before the profile input, with the names of their steps, and the
 * two steps that run the lint-standard action where there is no package.json (#163).
 */
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
      'Checkout the lint-standard action',
      'Copy of the standard without npm',
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

describe('run()', () => {
  it('a step script does not read the .bashrc of HOME', () => {
    const home = tempDir('bashrc-')
    writeFileSync(join(home, '.bashrc'), 'echo BASHRC-MARKER >&2\n')
    const result = run('echo ok', { HOME: home })
    expect(result.output).not.toContain('BASHRC-MARKER')
    expect(result.output.trim()).toBe('ok')
  })
})

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
    expect(CHECK.split('\n').filter((line) => /^\s*(- )?uses:/.test(line)).length).toBeGreaterThan(
      0
    )
    expect(unpinned(CHECK)).toEqual([])
    // The local action counts only after a checkout at tools-ref, and it is the only one allowed.
    const toolsCheckout =
      /(repository: bogd3v\/micelio-engineering\n {10})ref: \$\{\{ inputs\.tools-ref \}\}/
    expect(CHECK).toMatch(toolsCheckout)
    for (const ref of ['main', '${{ github.sha }}', '${{ inputs.lint-standard-version }}']) {
      expect(unpinned(CHECK.replace(toolsCheckout, `$1ref: ${ref}`)), ref).toEqual([
        '        uses: ./.micelio-engineering/.github/actions/lint-standard',
      ])
    }
    const local = '        uses: ./.micelio-engineering/.github/actions/lint-standard'
    const other = '        uses: ./.github/actions/other'
    expect(unpinned(CHECK.replace(local, `${other}\n${local}`))).toEqual([other])
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

  it('the rust profile accepts standard: true', () => {
    // A project without package.json runs the lint-standard action instead.
    const script = stepScript('checks', 'Check the inputs')
    const env = { PM: 'npm', PROFILE: 'rust' }
    for (const standard of ['true', 'false']) {
      const { status, output } = run(script, { ...env, STANDARD: standard })
      expect(status, standard).toBe(0)
      expect(output).not.toContain('#163')
    }
  })

  it('check.yml uses the action only when the project has no package.json', () => {
    const script = stepScript('checks', 'Copy of the standard')
    const sha = 'a'.repeat(40)
    const env = { PM: 'echo', LINT_STANDARD_VERSION: '0.2.7', TOOLS_REF: sha }

    // With a package.json: its lint:standard, and no output, so the action's steps are skipped.
    const npm = tempDir('micelio-standard-')
    writeFileSync(join(npm, 'package.json'), '{}\n')
    writeFileSync(join(npm, 'out'), '')
    const withPackage = run(script, { ...env, GITHUB_OUTPUT: join(npm, 'out') }, npm)
    expect(withPackage.status).toBe(0)
    expect(withPackage.output.trim()).toBe('run lint:standard')
    expect(readFileSync(join(npm, 'out'), 'utf8')).toBe('')

    // Without one: the output that runs the action, and no npm.
    const bare = tempDir('micelio-standard-')
    const out = join(tempDir('micelio-standard-out-'), 'out')
    writeFileSync(out, '')
    const withoutPackage = run(script, { ...env, GITHUB_OUTPUT: out }, bare)
    expect(withoutPackage.status).toBe(0)
    expect(withoutPackage.output).not.toContain('run lint:standard')
    expect(readFileSync(out, 'utf8')).toBe('action=true\n')

    // The two steps of the action run on that output alone, and the action gets the version and
    // the directory of the project.
    for (const name of ['Checkout the lint-standard action', 'Copy of the standard without npm']) {
      const step =
        job('checks')
          .split(`- name: ${name}\n`)[1]
          ?.split(/\n {6}- name: /)[0] ?? ''
      expect(step, name).toMatch(
        /^ {8}if: \$\{\{ steps\.standard\.outputs\.action == 'true' \}\}\n/
      )
    }
    expect(job('checks')).toMatch(
      /uses: \.\/\.micelio-engineering\/\.github\/actions\/lint-standard\n {8}with:\n {10}version: \$\{\{ inputs\.lint-standard-version \}\}\n {10}directory: \$\{\{ inputs\.working-directory \}\}\n/
    )
  })

  it('check.yml refuses a tools-ref that is not a commit SHA or an empty lint-standard-version', () => {
    const script = stepScript('checks', 'Copy of the standard')
    const sha = 'a'.repeat(40)
    const env = { PM: 'echo', LINT_STANDARD_VERSION: '0.2.7', TOOLS_REF: sha }
    const bare = tempDir('micelio-standard-')
    const out = join(tempDir('micelio-standard-out-'), 'out')
    for (const [name, value, says] of [
      ['LINT_STANDARD_VERSION', '', 'set lint-standard-version'],
      ['TOOLS_REF', '', 'set tools-ref'],
      ['TOOLS_REF', 'main', 'set tools-ref'],
      ['TOOLS_REF', sha.slice(1), 'set tools-ref'],
      ['TOOLS_REF', 'A'.repeat(40), 'set tools-ref'],
      ['TOOLS_REF', `${sha}; echo hacked`, 'set tools-ref'],
    ] as const) {
      writeFileSync(out, '')
      const result = run(script, { ...env, [name]: value, GITHUB_OUTPUT: out }, bare)
      expect(result.status, `${name}=${value}`).toBe(1)
      expect(result.output).toContain(says)
      expect(result.output).not.toMatch(/^hacked$/m)
      // No output, so the checkout and the action never run.
      expect(readFileSync(out, 'utf8')).toBe('')
    }
    writeFileSync(out, '')
    expect(run(script, { ...env, GITHUB_OUTPUT: out }, bare).status).toBe(0)
    expect(readFileSync(out, 'utf8')).toBe('action=true\n')
  })

  it('the rust profile runs the check line of AGENTS.md, or the input when it is set', () => {
    const script = stepScript('checks', 'Test')
    const rust = { PROFILE: 'rust' }
    const dir = tempDir('micelio-check-')
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

/** The shell of one step of the lint-standard action, by its name, without the YAML indentation. */
function actionScript(name: string): string {
  const step = ACTION.split(`    - name: ${name}\n`)[1]?.split(/\n {4}- name: /)[0] ?? ''
  expect(step, `step ${name}`).not.toBe('')
  return (step.split('run: |\n')[1] ?? '').replace(/^ {8}/gm, '')
}

/**
 * Runs the tool's step of the action in a temporary directory, with an `npx` on the PATH that prints
 * its arguments and the line in `line`, then exits `exit`. Returns the run, what the step wrote to
 * `GITHUB_OUTPUT`, its `RUNNER_TEMP` and the repository directory it checks.
 */
function runAction(
  env: Record<string, string>,
  stub: { line: string; exit: number } = { line: 'Standard 1.8 matches.', exit: 0 }
): { status: number | null; output: string; outputs: string; temp: string; repo: string } {
  const dir = tempDir('micelio-action-')
  const bin = join(dir, 'bin')
  const temp = join(dir, 'temp')
  const repo = join(dir, 'repo')
  for (const path of [bin, temp, repo]) mkdirSync(path)
  writeFileSync(
    join(bin, 'npx'),
    `#!/bin/sh\necho "npx $* in $PWD"\necho ${JSON.stringify(stub.line)} >&2\nexit ${String(stub.exit)}\n`
  )
  chmodSync(join(bin, 'npx'), 0o755)
  writeFileSync(join(dir, 'out'), '')
  const result = run(
    actionScript('Run micelio-lint-standard'),
    {
      PATH: `${bin}:${process.env.PATH ?? ''}`,
      RUNNER_TEMP: temp,
      GITHUB_OUTPUT: join(dir, 'out'),
      DIRECTORY: repo,
      ...env,
    },
    dir
  )
  return { ...result, outputs: readFileSync(join(dir, 'out'), 'utf8'), temp, repo }
}

describe('lint-standard action', () => {
  it('the lint-standard action pins every action it uses by commit SHA', () => {
    const uses = ACTION.split('\n').filter((line) => /^\s*(- )?uses:/.test(line))
    expect(uses.length).toBeGreaterThan(0)
    for (const line of uses) {
      expect(line).toMatch(/uses: [\w.-]+\/[\w.-]+@[0-9a-f]{40} # v\d+\.\d+\.\d+$/)
    }
    // No input reaches a shell: every run reads them from env.
    for (const script of ACTION.split('run: |\n').slice(1)) {
      expect(script.split(/\n {4}- name: /)[0]).not.toContain('${{')
    }
  })

  it('the lint-standard action has no default version of the package', () => {
    const inputs = ACTION.slice(ACTION.indexOf('\ninputs:\n'), ACTION.indexOf('\noutputs:\n'))
    const version = inputs.split('\n  version:\n')[1]?.split(/\n {2}\w/)[0] ?? ''
    expect(version).toContain('required: true')
    expect(version).not.toContain('default:')
    expect(inputs).toMatch(/\n {2}directory:\n(?: {4}.*\n)*? {4}default: \.\n/)

    // A missing version, a range or a tag fails before npx runs.
    for (const value of ['', 'latest', '^0.2.7', '0.2', '0.2.x', "0.2.7'; echo hacked"]) {
      const { status, output, outputs } = runAction({ VERSION: value })
      expect(status, value).toBe(1)
      expect(output).toContain('exact version of @micelio/eslint-config')
      expect(output).not.toContain('npx ')
      expect(output).not.toMatch(/^hacked$/m)
      expect(outputs).toBe('')
    }
  })

  it('the lint-standard action runs the tool from RUNNER_TEMP with the directory as its argument', () => {
    const { status, output, outputs, temp, repo } = runAction({ VERSION: '0.2.7' })
    expect(status).toBe(0)
    expect(output).toContain(
      `npx --yes --package @micelio/eslint-config@0.2.7 micelio-lint-standard ${repo} in ${temp}\n`
    )
    // A relative directory reaches the tool as an absolute path, since npx runs elsewhere.
    const relative = runAction({ VERSION: '0.2.7', DIRECTORY: 'repo' })
    expect(relative.status).toBe(0)
    expect(relative.output).toContain(
      `micelio-lint-standard ${relative.repo} in ${relative.temp}\n`
    )
    expect(output).toMatch(
      new RegExp(
        `^npx --yes --package @micelio/eslint-config@0\\.2\\.7 micelio-lint-standard .*/repo in ${temp}$`,
        'm'
      )
    )
    expect(output).toContain('Standard 1.8 matches.')
    expect(outputs).toMatch(
      /^message<<(EOF_[0-9a-f]{16})\nStandard 1\.8 matches\.\n\1\nstatus=0\n$/
    )
  })

  it('the lint-standard action fails when the tool does and prints its line', () => {
    const line = 'error: docs/engineering-standard.md does not match standard 1.8'
    const tool = runAction({ VERSION: '0.2.7' }, { line, exit: 1 })
    // The tool's step records the line and the status, so the output is set on a failure.
    expect(tool.status).toBe(0)
    expect(tool.output).toContain(line)
    expect(tool.outputs).toContain(`\n${line}\n`)
    expect(tool.outputs).toMatch(/\nstatus=1\n$/)

    // The next step runs on that status and fails with the line.
    expect(ACTION).toContain(
      "- name: Fail on the tool's error\n      if: ${{ steps.lint.outputs.status != '0' }}\n"
    )
    const fail = run(actionScript("Fail on the tool's error"), { MESSAGE: line, STATUS: '1' })
    expect(fail.status).toBe(1)
    expect(fail.output).toContain(line)

    const missing = runAction({ VERSION: '0.2.7', DIRECTORY: '/nonexistent/micelio' })
    expect(missing.status).toBe(1)
    expect(missing.output).toContain("directory '/nonexistent/micelio' not found")
  })

  it('the no-npm fixture pins 1.8, holds the standard and no package.json', () => {
    const fixture = join(ROOT, 'fixtures/no-npm')
    expect(readFileSync(join(fixture, 'AGENTS.md'), 'utf8')).toContain('`standard: 1.8`')
    expect(readFileSync(join(fixture, 'docs/engineering-standard.md'), 'utf8')).toMatch(
      /^Version 1\.8 /m
    )
    expect(existsSync(join(fixture, 'package.json'))).toBe(false)
    const ci = readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8')
    expect(ci).toContain(
      'uses: ./.github/actions/lint-standard\n        with:\n          version: 0.2.7\n          directory: fixtures/no-npm\n'
    )
  })
})

const VERIFY = readFileSync(join(ROOT, '.github/workflows/verify-draft.yml'), 'utf8')

/** The steps of the one job of `verify-draft.yml`, each with its text, by name. */
function verifySteps(): Record<string, string> {
  const steps: Record<string, string> = {}
  for (const step of VERIFY.split(/\n(?= {6}- name: )/).slice(1)) {
    const name = /^ {6}- name: (.*)$/m.exec(step)?.[1]
    if (name !== undefined) steps[name] = step
  }
  return steps
}

/** The shell of a step of `verify-draft.yml`, without the YAML indentation. */
function verifyScript(name: string): string {
  const step = verifySteps()[name] ?? ''
  expect(step, `step ${name}`).not.toBe('')
  return (step.split('run: |\n')[1] ?? '').replace(/^ {10}/gm, '')
}

describe('verify-draft.yml', () => {
  it('verify-draft.yml runs on pull_request only, with read-only permissions and no secrets', () => {
    expect(VERIFY).toMatch(/^on:\n {2}workflow_call:\n/m)
    expect(VERIFY).not.toMatch(/pull_request_target/)
    expect(VERIFY).toMatch(/^ {4}if: github\.event_name == 'pull_request'$/m)
    expect(VERIFY).toMatch(/^permissions: \{\}$/m)
    expect(VERIFY).toMatch(
      /^ {4}permissions:\n {6}contents: read\n {6}pull-requests: read\n {4}steps:/m
    )
    expect(VERIFY.match(/^ {2,6}[a-z-]+: (read|write|none)$/gm)).toEqual([
      '      contents: read',
      '      pull-requests: read',
    ])
    expect(VERIFY).not.toMatch(/\$\{\{\s*secrets\./)
    expect(VERIFY).not.toMatch(/^ {4}secrets:/m)
    expect(VERIFY).not.toMatch(/github\.token|GITHUB_TOKEN|GH_TOKEN/)
    expect(VERIFY).toMatch(/^ {6}tools-ref:\n(?: {8}.*\n)*? {8}required: true$/m)
    expect(VERIFY).toMatch(
      /^ {6}tools-repository:\n(?: {8}.*\n)*? {8}default: bogd3v\/micelio-engineering$/m
    )
    const ci = readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8')
    expect(ci).toContain(
      "  verify-draft:\n    if: ${{ github.event_name == 'pull_request' }}\n    permissions:\n      contents: read\n      pull-requests: read\n    uses: ./.github/workflows/verify-draft.yml\n    with:\n      tools-ref: ${{ github.sha }}\n"
    )
  })

  it("verify-draft.yml never puts the pull request's description in a run script", () => {
    // the description is read in one place: the env of the step that writes it to a file
    const reads = VERIFY.split('\n').filter((line) => /pull_request\.body/.test(line))
    expect(reads).toEqual(['          PR_BODY: ${{ github.event.pull_request.body }}'])
    // no `run:` script holds an expression, and none reads the description but through its variable
    for (const [name, step] of Object.entries(verifySteps())) {
      const script = step.includes('run: ') ? step.slice(step.indexOf('run: ')) : ''
      expect(script, `step ${name}`).not.toMatch(/\$\{\{/)
    }
    expect(verifyScript('Verify the draft')).toContain(
      'printf \'%s\' "$PR_BODY" > "$RUNNER_TEMP/draft.md"'
    )
    expect(verifyScript('Verify the draft')).toContain('--draft "$RUNNER_TEMP/draft.md"')
    // the file is what a shell sees: a body that is shell code is not run
    const dir = tempDir('micelio-verify-')
    const body = '$(touch pwned); `touch pwned2`\n```\nx'
    const bin = join(dir, 'bin')
    mkdirSync(bin)
    writeFileSync(join(bin, 'node'), '#!/bin/sh\nexit 0\n')
    chmodSync(join(bin, 'node'), 0o755)
    const result = run(
      verifyScript('Verify the draft'),
      { PATH: `${bin}:${process.env.PATH ?? ''}`, RUNNER_TEMP: dir, PR_BODY: body },
      dir
    )
    expect(result.status).toBe(0)
    expect(readFileSync(join(dir, 'draft.md'), 'utf8')).toBe(body)
    expect(existsSync(join(dir, 'pwned'))).toBe(false)
    expect(existsSync(join(dir, 'pwned2'))).toBe(false)
  })

  it('verify-draft.yml skips and passes when the diff does not fit the normal lane', () => {
    const dir = tempDir('micelio-verify-')
    const bin = join(dir, 'bin')
    mkdirSync(bin)
    const lane = (exit: number): { status: number | null; output: string; outputs: string } => {
      writeFileSync(join(bin, 'node'), `#!/bin/sh\necho "node $*"\nexit ${String(exit)}\n`)
      chmodSync(join(bin, 'node'), 0o755)
      writeFileSync(join(dir, 'out'), '')
      const result = run(
        verifyScript('Check the lane'),
        {
          PATH: `${bin}:${process.env.PATH ?? ''}`,
          GITHUB_OUTPUT: join(dir, 'out'),
          BASE_SHA: 'abc123',
          RUNNER_TEMP: dir,
        },
        dir
      )
      return { ...result, outputs: readFileSync(join(dir, 'out'), 'utf8') }
    }
    const full = lane(1)
    expect(full.status).toBe(0)
    expect(full.output).toContain('lint-lane --diff abc123 --lane normal')
    expect(full.output).toContain('full lane: gate 4 is the verifier')
    expect(full.outputs).toBe('normal=false\n')
    const normal = lane(0)
    expect(normal.status).toBe(0)
    expect(normal.output).not.toContain('full lane')
    expect(normal.outputs).toBe('normal=true\n')
    const broken = lane(2)
    expect(broken.status).toBe(1)
    expect(broken.output).toContain('lint-lane failed (exit 2)')
    expect(broken.outputs).toBe('')
    // every step after the lane's runs only on `normal`
    const steps = Object.entries(verifySteps())
    const at = steps.findIndex(([name]) => name === 'Check the lane')
    expect(steps.slice(at + 1).map(([name]) => name)).toEqual([
      'Set up Node',
      'Install dependencies',
      'Verify the draft',
    ])
    for (const [name, step] of steps.slice(at + 1)) {
      expect(step, name).toContain("if: ${{ steps.lane.outputs.normal == 'true' }}")
    }
    expect(verifyScript('Verify the draft')).toContain('verify-draft --draft')
    expect(verifyScript('Verify the draft')).not.toContain('--logs')
  })

  it('verify-draft.yml moves the built tools out of the workspace before the lane and the draft are checked', () => {
    const names = Object.keys(verifySteps())
    const move = names.indexOf('Move the tools out of the workspace')
    expect(move).toBeGreaterThan(names.indexOf('Build the tools'))
    expect(move).toBeLessThan(names.indexOf('Check the lane'))
    expect(VERIFY).not.toContain('.git/info/exclude')
    // the tools are run from RUNNER_TEMP, never from the workspace that the draft's commands read
    for (const name of ['Check the lane', 'Verify the draft']) {
      expect(verifyScript(name)).toContain(
        'node "$RUNNER_TEMP/tools/packages/factory-tools/dist/cli.js"'
      )
      expect(verifyScript(name)).not.toContain('.micelio-tools')
    }
    const dir = tempDir('micelio-verify-')
    const workspace = join(dir, 'ws')
    const temp = join(dir, 'temp')
    mkdirSync(join(workspace, '.micelio-tools'), { recursive: true })
    mkdirSync(temp)
    writeFileSync(join(workspace, '.micelio-tools', 'marker'), 'built')
    const result = run(
      verifyScript('Move the tools out of the workspace'),
      { RUNNER_TEMP: temp },
      workspace
    )
    expect(result.status).toBe(0)
    expect(existsSync(join(workspace, '.micelio-tools'))).toBe(false)
    expect(readFileSync(join(temp, 'tools', 'marker'), 'utf8')).toBe('built')
  })

  it('every action in verify-draft.yml is pinned by a commit SHA', () => {
    expect(VERIFY).toMatch(/uses: actions\/checkout@/)
    expect(VERIFY).toMatch(/uses: actions\/setup-node@/)
    expect(unpinned(VERIFY)).toEqual([])
  })
})
