import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { runVerifyDraft, tokenize, verifyDraft } from '../src/verify-draft.js'
import type { VerifyDraftDeps } from '../src/verify-draft.js'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defaultVerifyDeps } from '../src/verify-draft.js'
import type { ExecLimit } from '../src/verify-draft.js'
import { execFileSync, spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const AGENTS = [
  '# AGENTS.md',
  '',
  '## Commands',
  '',
  '```bash',
  'install: npm ci',
  'test: npm test',
  'check: npm run check            # typecheck, lint, test',
  'npm run template -- <dir> # creates a repository',
  '```',
  '',
  '## Rules',
  '',
].join('\n')
const MANIFEST = JSON.stringify({ scripts: { test: 'vitest run', check: 'x', 'lint:docs': 'y' } })

interface Fake {
  deps: VerifyDraftDeps
  ran: string[]
}

/** A disk of `files` and commands that answer from `runs`, each a list of `[exit code, output]` taken in turn. */
function fake(files: Record<string, string>, runs: Record<string, [number, string][]> = {}): Fake {
  const ran: string[] = []
  const left = new Map(Object.entries(runs).map(([key, value]) => [key, [...value]]))
  const deps: VerifyDraftDeps = {
    readText: (path) =>
      path in files ? Promise.resolve(files[path] ?? '') : Promise.reject(new Error(`no ${path}`)),
    exists: (path) => Promise.resolve(path in files),
    baseAgents: () => Promise.resolve(files['HEAD:AGENTS.md'] ?? AGENTS),
    exec: (file, args) => {
      const key = [file, ...args].join(' ')
      ran.push(key)
      const next = left.get(key)?.shift() ?? [1, 'nothing was planned for this command']
      return Promise.resolve({ code: next[0], output: next[1] })
    },
  }
  return { deps, ran }
}

const draft = (...bullets: string[]): string =>
  `# feat: x\n\n## Tests\n\n${bullets.join('\n')}\n\n## Instructions that were wrong or missing\n\nNothing\n`

const BASE = { '/c/AGENTS.md': AGENTS, '/c/package.json': MANIFEST }
const VITEST = 'Test Files  23 passed (23)\n     Tests  482 passed (482)\n'

describe('verify-draft', () => {
  it('a command whose count differs from the draft is a mismatch, and the exit code is 1', async () => {
    const { deps } = fake(
      {
        ...BASE,
        '/d.md': draft('- `npm test`: exit 0, 481 passed (`logs/npm-test.log`)'),
        '/l/npm-test.log': '',
      },
      { 'npm test': [[0, VITEST]] }
    )
    const result = await runVerifyDraft(
      ['verify-draft', '--draft', '/d.md', '--logs', '/l', '--cwd', '/c'],
      deps
    )
    expect(result.code).toBe(1)
    expect(result.stdout).toContain('mismatch: npm test: passed: draft 481, got 23 or 482')
    expect(result.stdout).toContain('Verdict: Red · 1 mismatches')

    const right = fake(
      {
        ...BASE,
        '/d.md': draft('- `npm test`: exit 0, 482 passed (`logs/npm-test.log`)'),
        '/l/npm-test.log': '',
      },
      { 'npm test': [[0, VITEST]] }
    )
    const ok = await runVerifyDraft(
      ['verify-draft', '--draft', '/d.md', '--logs', '/l', '--cwd', '/c'],
      right.deps
    )
    expect(ok.code).toBe(0)
    expect(ok.stdout).toContain('match: npm test')
    expect(ok.stdout).toContain('Verdict: Pass · 0 mismatches')

    const exit = await verifyDraft(
      draft('- `npm test`: exit 0, 482 passed (`logs/npm-test.log`)'),
      '/l',
      '/c',
      fake({ ...BASE, '/l/npm-test.log': '' }, { 'npm test': [[1, VITEST]] }).deps
    )
    expect(exit).toEqual([
      { kind: 'mismatch', command: 'npm test', reasons: ['exit code: draft 0, got 1'] },
    ])
  })

  it('a command with no log file behind it is a mismatch', async () => {
    const { deps, ran } = fake(
      { ...BASE, '/d.md': draft('- `npm test`: exit 0, 482 passed (`logs/npm-test.log`)') },
      { 'npm test': [[0, VITEST]] }
    )
    const result = await runVerifyDraft(
      ['verify-draft', '--draft', '/d.md', '--logs', '/l', '--cwd', '/c'],
      deps
    )
    expect(result.code).toBe(1)
    expect(result.stdout).toContain('mismatch: npm test: no log')
    expect(ran).toEqual(['npm test'])
    const none = await verifyDraft(
      draft('- `npm test`: exit 0, 482 passed'),
      '/l',
      '/c',
      fake(BASE).deps
    )
    expect(none?.[0]).toMatchObject({
      kind: 'mismatch',
      reasons: expect.arrayContaining(['no log']),
    })
  })

  it('without --logs a missing log is not a mismatch, and the output says logs are not checked', async () => {
    const { deps, ran } = fake(
      { ...BASE, '/d.md': draft('- `npm test`: exit 0, 482 passed (`logs/npm-test.log`)') },
      { 'npm test': [[0, VITEST]] }
    )
    const result = await runVerifyDraft(['verify-draft', '--draft', '/d.md', '--cwd', '/c'], deps)
    expect(result.code).toBe(0)
    expect(ran).toEqual(['npm test'])
    expect(result.stdout).toContain('match: npm test')
    expect(result.stdout).toContain('logs: not checked\nVerdict: Pass · 0 mismatches')

    // a number that is wrong is still a mismatch
    const wrong = fake(
      { ...BASE, '/d.md': draft('- `npm test`: exit 0, 481 passed') },
      { 'npm test': [[0, VITEST]] }
    )
    const red = await runVerifyDraft(
      ['verify-draft', '--draft', '/d.md', '--cwd', '/c'],
      wrong.deps
    )
    expect(red.code).toBe(1)
    expect(red.stdout).not.toContain('no log')

    // with --logs the line is not printed
    const withLogs = fake(
      {
        ...BASE,
        '/d.md': draft('- `npm test`: exit 0, 482 passed (`logs/npm-test.log`)'),
        '/l/npm-test.log': '',
      },
      { 'npm test': [[0, VITEST]] }
    )
    const checked = await runVerifyDraft(
      ['verify-draft', '--draft', '/d.md', '--logs', '/l', '--cwd', '/c'],
      withLogs.deps
    )
    expect(checked.stdout).not.toContain('logs: not checked')
  })

  it('a description with CRLF line endings is read as one with LF', async () => {
    const crlf = draft('- `npm test`: exit 0, 482 passed (`logs/npm-test.log`)').replace(
      /\n/g,
      '\r\n'
    )
    const { deps, ran } = fake(
      { ...BASE, '/d.md': crlf, '/l/npm-test.log': '' },
      { 'npm test': [[0, VITEST]] }
    )
    const result = await runVerifyDraft(
      ['verify-draft', '--draft', '/d.md', '--logs', '/l', '--cwd', '/c'],
      deps
    )
    expect(ran).toEqual(['npm test'])
    expect(result.stdout).toContain('match: npm test')
    expect(result.code).toBe(0)
  })

  it('a figure reported as k failed of n is checked as variance', async () => {
    const { deps, ran } = fake(
      { ...BASE, '/l/npm-test.log': '' },
      {
        'npm test': [
          [1, 'x'],
          [0, 'x'],
          [0, 'x'],
        ],
      }
    )
    const outcomes = await verifyDraft(
      draft('- `npm test`: 1 failed of 3, 12 passed (`logs/npm-test.log`)'),
      '/l',
      '/c',
      deps
    )
    expect(ran).toEqual(['npm test', 'npm test', 'npm test'])
    expect(outcomes).toEqual([
      { kind: 'variance', command: 'npm test', reported: '1 failed of 3', got: '1 failed of 3' },
    ])
    const result = await runVerifyDraft(
      ['verify-draft', '--draft', '/d.md', '--logs', '/l', '--cwd', '/c'],
      fake(
        {
          ...BASE,
          '/d.md': draft('- `npm test`: 0 failed of 2 (`logs/npm-test.log`)'),
          '/l/npm-test.log': '',
        },
        {
          'npm test': [
            [1, ''],
            [1, ''],
          ],
        }
      ).deps
    )
    expect(result.stdout).toContain('variance: npm test: draft 0 failed of 2, got 2 failed of 2')
    expect(result.code).toBe(0)
  })

  it('a run shown failing without the change is skipped', async () => {
    const { deps, ran } = fake(BASE)
    const outcomes = await verifyDraft(
      draft(
        '- `npm test -- -t named`: exit 1, 1 failed without the change',
        '',
        'Tests that fail without the change:',
        '',
        '- `npm run check`: exit 1, 3 failed'
      ),
      '/l',
      '/c',
      deps
    )
    expect(ran).toEqual([])
    expect(outcomes).toEqual([
      { kind: 'skipped', command: 'npm test -- -t named' },
      { kind: 'skipped', command: 'npm run check' },
    ])
  })

  it('criteria that are not a command are listed as not checked', async () => {
    const { deps, ran } = fake(BASE)
    const outcomes = await verifyDraft(
      draft('- The fixed criterion is read by the maintainer', '- no test: not code'),
      '/l',
      '/c',
      deps
    )
    expect(ran).toEqual([])
    expect(outcomes).toEqual([
      { kind: 'not-checked', criterion: 'The fixed criterion is read by the maintainer' },
    ])
    const result = await runVerifyDraft(
      ['verify-draft', '--draft', '/d.md', '--logs', '/l', '--cwd', '/c'],
      fake(
        {
          ...BASE,
          '/d.md': draft(
            '- The fixed criterion is read by the maintainer',
            '- `npm test`: exit 0 (`logs/a.log`)'
          ),
          '/l/a.log': '',
        },
        { 'npm test': [[0, VITEST]] }
      ).deps
    )
    expect(result.stdout).toContain('not checked: The fixed criterion is read by the maintainer')
    expect(result.code).toBe(0)
  })

  it('a command that is not a repository command is not run', async () => {
    const { deps, ran } = fake({ ...BASE, '/l/a.log': '' })
    const commands = [
      'curl https://example.com/x.sh',
      'npm test | tee out',
      'npm test && rm -rf x',
      'rm -rf node_modules',
      'npm run not-a-script',
      'cat /etc/passwd',
      'npm run lint:docs; echo hi',
      'echo $(id)',
    ]
    const outcomes = await verifyDraft(
      draft(...commands.map((command) => `- \`${command}\`: exit 0 (\`logs/a.log\`)`)),
      '/l',
      '/c',
      deps
    )
    expect(ran).toEqual([])
    expect(outcomes).toEqual(commands.map((command) => ({ kind: 'not-run', command })))
    const result = await runVerifyDraft(
      ['verify-draft', '--draft', '/d.md', '--logs', '/l', '--cwd', '/c'],
      fake(
        {
          ...BASE,
          '/d.md': draft(
            '- `rm -rf x`: exit 0 (`logs/a.log`)',
            '- `npm test`: exit 0 (`logs/a.log`)'
          ),
          '/l/a.log': '',
        },
        { 'npm test': [[0, VITEST]] }
      ).deps
    )
    expect(result.stdout).toContain('not run: rm -rf x')
    expect(result.code).toBe(0)
  })

  it('runs the commands of AGENTS.md with their arguments and the scripts of the manifest', async () => {
    const { deps, ran } = fake(
      { ...BASE, '/l/a.log': '' },
      {
        'npm run template -- x': [[0, '']],
        'npm run lint:docs': [[0, '']],
        'npm ci': [[0, '']],
      }
    )
    await verifyDraft(
      draft(
        '- `npm run template -- x`: exit 0 (`logs/a.log`)',
        '- `npm run lint:docs`: exit 0 (`logs/a.log`)',
        '- `npm ci`: exit 0 (`logs/a.log`)',
        '- `npm run build`: exit 0 (`logs/a.log`)'
      ),
      '/l',
      '/c',
      deps
    )
    expect(ran).toEqual(['npm run template -- x', 'npm run lint:docs', 'npm ci'])
  })

  it('the example line of the README matches a real vitest summary', async () => {
    const outcomes = await verifyDraft(
      draft('- `npm test`: exit 0, 23 test files, 482 tests passed (`logs/npm-test.log`)'),
      '/l',
      '/c',
      fake({ ...BASE, '/l/npm-test.log': '' }, { 'npm test': [[0, VITEST]] }).deps
    )
    expect(outcomes).toEqual([{ kind: 'match', command: 'npm test' }])
    const wrong = await verifyDraft(
      draft('- `npm test`: exit 0, 24 test files (`logs/npm-test.log`)'),
      '/l',
      '/c',
      fake({ ...BASE, '/l/npm-test.log': '' }, { 'npm test': [[0, VITEST]] }).deps
    )
    expect(wrong?.[0]).toMatchObject({ kind: 'mismatch' })
  })

  it('a figure about test files does not match the line of the tests', async () => {
    const run = (summary: string) =>
      verifyDraft(
        draft(`- \`npm test\`: exit 0, ${summary} (\`logs/npm-test.log\`)`),
        '/l',
        '/c',
        fake({ ...BASE, '/l/npm-test.log': '' }, { 'npm test': [[0, VITEST]] }).deps
      )
    expect((await run('482 test files'))?.[0]).toMatchObject({ kind: 'mismatch' })
    expect((await run('23 tests'))?.[0]).toMatchObject({ kind: 'mismatch' })
    expect((await run('23 test files, 482 tests'))?.[0]).toMatchObject({ kind: 'match' })
  })

  it('a run that reports exit 0 is not skipped for saying without the change', async () => {
    const { deps, ran } = fake({ ...BASE, '/l/a.log': '' }, { 'npm test': [[1, VITEST]] })
    const outcomes = await verifyDraft(
      draft('- `npm test`: exit 0, 482 passed, the same without the change (`logs/a.log`)'),
      '/l',
      '/c',
      deps
    )
    expect(ran).toEqual(['npm test'])
    expect(outcomes?.[0]).toMatchObject({ kind: 'mismatch' })
  })

  it('a variance figure with no log is a mismatch and is not run', async () => {
    const { deps, ran } = fake(BASE)
    const outcomes = await verifyDraft(draft('- `npm test`: 1 failed of 3'), '/l', '/c', deps)
    expect(ran).toEqual([])
    expect(outcomes).toEqual([{ kind: 'mismatch', command: 'npm test', reasons: ['no log'] }])
  })

  it('a command that only the diff adds to AGENTS.md is not a repository command', async () => {
    const changed = `${AGENTS.replace('```\n\n## Rules', 'rm -rf x\n```\n\n## Rules')}`
    expect(changed).toContain('rm -rf x')
    const { deps, ran } = fake({ ...BASE, '/c/AGENTS.md': changed, '/l/a.log': '' })
    const outcomes = await verifyDraft(
      draft('- `rm -rf x`: exit 0 (`logs/a.log`)'),
      '/l',
      '/c',
      deps
    )
    expect(ran).toEqual([])
    expect(outcomes).toEqual([{ kind: 'not-run', command: 'rm -rf x' }])
  })

  it('a numbered item of the Tests section is an entry, as a bullet is', async () => {
    const { deps, ran } = fake(BASE, {
      'npm test': [[0, VITEST]],
      'npm run check': [[0, VITEST]],
    })
    const outcomes = await verifyDraft(
      '# feat: x\n\n## Tests\n\nCommands as run:\n\n1. `npm test`: exit 0\n   and 482 passed\n2) `npm run check`: exit 0\n10. The criterion for the master\n- `rm -rf x`: exit 0\n',
      undefined,
      '/c',
      deps
    )
    expect(ran).toEqual(['npm test', 'npm run check'])
    expect(outcomes).toEqual([
      { kind: 'match', command: 'npm test' },
      { kind: 'match', command: 'npm run check' },
      { kind: 'not-checked', criterion: 'The criterion for the master' },
      { kind: 'not-run', command: 'rm -rf x' },
    ])
    const intro = await verifyDraft(
      '# feat: x\n\n## Tests\n\nRuns without the change:\n\n1. `npm test`: exit 1\n',
      undefined,
      '/c',
      fake(BASE).deps
    )
    expect(intro).toEqual([{ kind: 'skipped', command: 'npm test' }])
  })

  it('a command run through factory-slot.sh run -- is run without the prefix', async () => {
    const slot = '/home/me/micelio-engineering/herdr/factory-slot.sh'
    const { deps, ran } = fake(BASE, { 'npm test': [[0, VITEST]], 'npm run check': [[0, VITEST]] })
    const outcomes = await verifyDraft(
      draft(
        `- \`${slot} run -- npm test\`: exit 0, 482 passed`,
        '- `factory-slot.sh run -- npm run check`: exit 0, 23 test files'
      ),
      undefined,
      '/c',
      deps
    )
    expect(ran).toEqual(['npm test', 'npm run check'])
    expect(outcomes).toEqual([
      { kind: 'match', command: `${slot} run -- npm test` },
      { kind: 'match', command: 'factory-slot.sh run -- npm run check' },
    ])
  })

  it('the factory-slot.sh prefix does not make a command that is not a repository command run', async () => {
    const { deps, ran } = fake(BASE)
    const commands = [
      '/x/herdr/factory-slot.sh run -- rm -rf node_modules',
      '/x/herdr/factory-slot.sh run -- npm test && rm -rf x',
      '/x/herdr/factory-slot.sh run -- npm run not-a-script',
      '/x/herdr/factory-slot.sh run -- /bin/sh -c id',
      '/x/herdr/factory-slot.sh status',
      '/x/herdr/factory-slot.sh acquire --pool workers -- npm test',
      'not-factory-slot.sh.sh run -- npm test',
    ]
    const outcomes = await verifyDraft(
      draft(...commands.map((command) => `- \`${command}\`: exit 0`)),
      undefined,
      '/c',
      deps
    )
    expect(ran).toEqual([])
    expect(outcomes).toEqual(commands.map((command) => ({ kind: 'not-run', command })))
  })

  it('a Tests section in which no command runs is Red with exit 1 and says no command ran', async () => {
    const no =
      'no command ran: gate 4 of the normal lane needs at least one repository command in the Tests section\n'
    for (const bullets of [
      ['- The fixed criterion is read by the maintainer'],
      ['- `rm -rf x`: exit 0'],
      ['- `npm test`: exit 1 (without the change)'],
      ['- no test: not code'],
      [],
    ]) {
      const result = await runVerifyDraft(
        ['verify-draft', '--draft', '/d.md', '--cwd', '/c'],
        fake({ ...BASE, '/d.md': draft(...bullets) }).deps
      )
      expect(result.code).toBe(1)
      expect(result.stdout).toMatch(
        new RegExp(`${no}Verdict: Red · 0 mismatches\\n$`.replace(/[()]/g, '\\$&'))
      )
      expect(result.stdout).toContain(`logs: not checked\n${no}`)
    }
    const withLogs = await runVerifyDraft(
      ['verify-draft', '--draft', '/d.md', '--logs', '/l', '--cwd', '/c'],
      fake({ ...BASE, '/d.md': draft('- `rm -rf x`: exit 0 (`logs/a.log`)'), '/l/a.log': '' }).deps
    )
    expect(withLogs.code).toBe(1)
    expect(withLogs.stdout).toBe(`not run: rm -rf x\n${no}Verdict: Red · 0 mismatches\n`)
  })

  it('the Tests section of pull request #264 runs its repository commands', async () => {
    const manifest = JSON.stringify({
      scripts: { check: 'x', 'verify:template': 'y', 'verify:isolated': 'z' },
    })
    const section = await readFile(new URL('./fixtures/pr-264-tests.md', import.meta.url), 'utf8')
    const { deps, ran } = fake(
      { ...BASE, '/c/package.json': manifest },
      {
        'npm run check': [[0, VITEST]],
        'npm run verify:template': [[0, 'ok\n']],
        'npm run verify:isolated': [[0, 'ok\n']],
      }
    )
    const outcomes = await verifyDraft(section, undefined, '/c', deps)
    expect(ran).toEqual(['npm run check', 'npm run verify:template', 'npm run verify:isolated'])
    expect(outcomes?.filter((o) => o.kind === 'match' || o.kind === 'mismatch')).toHaveLength(3)
    expect(
      outcomes?.flatMap((o) => (o.kind === 'not-run' ? [o.command.split(' ')[0]] : []))
    ).toEqual(['npx', 'npm', 'run.ts', 'failingReport', 'parseEvent', 'docs/'])
  })

  it('a command reported twice is run once, for its last entry, and the earlier entry is printed as earlier', async () => {
    const { deps, ran } = fake(BASE, {
      'npm test': [[0, VITEST]],
      'npm run check': [[0, VITEST]],
    })
    const outcomes = await verifyDraft(
      draft(
        '- `npm test` on main: exit 0, 481 passed',
        '- `npm run check`: exit 0, 23 test files',
        '- `npm test`: exit 0, 482 passed'
      ),
      undefined,
      '/c',
      deps
    )
    expect(ran).toEqual(['npm run check', 'npm test'])
    expect(outcomes).toEqual([
      { kind: 'earlier', command: 'npm test' },
      { kind: 'match', command: 'npm run check' },
      { kind: 'match', command: 'npm test' },
    ])
    const result = await runVerifyDraft(
      ['verify-draft', '--draft', '/d.md', '--cwd', '/c'],
      fake(
        {
          ...BASE,
          '/d.md': draft('- `npm test`: exit 0, 481 passed', '- `npm test`: exit 0, 482 passed'),
        },
        { 'npm test': [[0, VITEST]] }
      ).deps
    )
    expect(result.stdout).toBe(
      'earlier: npm test (a later entry runs it)\nmatch: npm test\nlogs: not checked\nVerdict: Pass · 0 mismatches\n'
    )
    expect(result.code).toBe(0)
  })

  it('a baseline through the slot prefix and a final run without it are the same command', async () => {
    const slot = '/abs/herdr/factory-slot.sh'
    const { deps, ran } = fake(BASE, { 'npm run check': [[0, VITEST]] })
    const outcomes = await verifyDraft(
      draft(
        '- `factory-slot.sh run -- npm run check` on main: exit 0, 481 passed',
        `- \`${slot} run -- npm run check\`: exit 0, 482 passed`
      ),
      undefined,
      '/c',
      deps
    )
    expect(ran).toEqual(['npm run check'])
    expect(outcomes).toEqual([
      { kind: 'earlier', command: 'factory-slot.sh run -- npm run check' },
      { kind: 'match', command: `${slot} run -- npm run check` },
    ])
  })

  it('a figure whose word the output does not count is not compared', async () => {
    const output = 'Test Files  25 passed (25)\n     Tests  530 passed (530)\n'
    const { deps } = fake(BASE, { 'npm run check': [[0, output]] })
    const outcomes = await verifyDraft(
      draft(
        '- `npm run check`: exit 0, 25 test files, 530 tests passed (main: 525; +5 new tests); load 7.66 on 8 cores'
      ),
      undefined,
      '/c',
      deps
    )
    expect(outcomes).toEqual([{ kind: 'match', command: 'npm run check' }])
    const wrong = fake(BASE, { 'npm run check': [[0, output]] })
    const mismatch = await verifyDraft(
      draft('- `npm run check`: exit 0, 529 tests passed (+5 new tests); load 7.66 on 8 cores'),
      undefined,
      '/c',
      wrong.deps
    )
    expect(mismatch).toEqual([
      { kind: 'mismatch', command: 'npm run check', reasons: ['tests: draft 529, got 530'] },
    ])
  })

  it("a run whose output counts none of the draft's figures is a mismatch", async () => {
    const { deps } = fake(BASE, { 'npm run check': [[0, 'done\n']] })
    const outcomes = await verifyDraft(
      draft('- `npm run check`: exit 0, 530 tests passed (+5 new tests)'),
      undefined,
      '/c',
      deps
    )
    expect(outcomes).toEqual([
      {
        kind: 'mismatch',
        command: 'npm run check',
        reasons: [
          'tests: draft 530, the output has no "<n> tests"',
          'new: draft 5, the output has no "<n> new"',
        ],
      },
    ])
  })

  it('the Tests section of pull request #267 is a match for each final command', async () => {
    const manifest = JSON.stringify({
      scripts: { check: 'x', 'verify:template': 'y', 'verify:isolated': 'z' },
    })
    const section = await readFile(new URL('./fixtures/pr-267-tests.md', import.meta.url), 'utf8')
    const { deps, ran } = fake(
      { ...BASE, '/c/package.json': manifest },
      {
        'npm run check': [[0, 'Test Files  25 passed (25)\n     Tests  530 passed (530)\n']],
        'npm run verify:template': [[0, 'Test Files  1 passed (1)\n     Tests  1 passed (1)\n']],
        'npm run verify:isolated': [
          [0, 'Isolated fixture passes lint, typecheck and format:check.\n'],
        ],
      }
    )
    const outcomes = await verifyDraft(section, undefined, '/c', deps)
    expect(ran).toEqual(['npm run check', 'npm run verify:template', 'npm run verify:isolated'])
    expect(outcomes?.slice(0, 3).map((o) => o.kind)).toEqual(['earlier', 'earlier', 'earlier'])
    expect(
      outcomes?.filter((o) => o.kind === 'match').map((o) => (o.kind === 'match' ? o.command : ''))
    ).toEqual([
      '/home/alejo9420/Git/micelio-engineering/herdr/factory-slot.sh run -- npm run check',
      '/home/alejo9420/Git/micelio-engineering/herdr/factory-slot.sh run -- npm run verify:template',
      '/home/alejo9420/Git/micelio-engineering/herdr/factory-slot.sh run -- npm run verify:isolated',
    ])
    expect(outcomes?.some((o) => o.kind === 'mismatch')).toBe(false)
  })

  it('reports the usage and read errors with exit 2', async () => {
    const { deps } = fake({ '/d.md': '# feat: x\n' })
    expect((await runVerifyDraft(['verify-draft', '--draft', '/d.md'], deps)).code).toBe(2)
    expect((await runVerifyDraft(['verify-draft', '--nope', 'x'], deps)).code).toBe(2)
    expect(
      (await runVerifyDraft(['verify-draft', '--draft', '/d.md', '--logs', '/l'], deps)).stderr
    ).toContain('no "Tests" section')
    expect(
      (await runVerifyDraft(['verify-draft', '--draft', '/none.md', '--logs', '/l'], deps)).code
    ).toBe(2)
  })

  it('tokenizes without a shell', () => {
    expect(tokenize("npm test -- -t 'a b'")).toEqual(['npm', 'test', '--', '-t', 'a b'])
    expect(tokenize("npm test -- -t 'a|b'")).toEqual(['npm', 'test', '--', '-t', 'a|b'])
    expect(tokenize('npm test > out')).toBeNull()
    expect(tokenize('npm test ../x')).toBeNull()
    expect(tokenize('')).toBeNull()
  })
  it("prints the last 40 lines of a mismatched command's output under its mismatch line", async () => {
    const output = Array.from({ length: 50 }, (_, i) => `line ${i + 1}`).join('\n') + '\n'
    const { deps } = fake(
      { ...BASE, '/d.md': draft('- `npm test`: exit 0, 482 passed') },
      { 'npm test': [[1, output]] }
    )
    const result = await runVerifyDraft(['verify-draft', '--draft', '/d.md', '--cwd', '/c'], deps)
    const block = Array.from({ length: 40 }, (_, i) => `    line ${i + 11}\n`).join('')
    expect(result.stdout).toBe(
      `mismatch: npm test: exit code: draft 0, got 1; passed: draft 482, the output has no "<n> passed"\n    output (last 40 lines):\n${block}logs: not checked\nVerdict: Red · 1 mismatches\n`
    )
    expect(result.stdout).not.toContain('line 10\n')
    expect(result.code).toBe(1)
  })

  it('prints no output under a match', async () => {
    const { deps } = fake(
      { ...BASE, '/d.md': draft('- `npm test`: exit 0, 482 passed', '- `rm -rf x`: exit 0') },
      { 'npm test': [[0, VITEST]] }
    )
    const result = await runVerifyDraft(['verify-draft', '--draft', '/d.md', '--cwd', '/c'], deps)
    expect(result.stdout).toBe(
      'match: npm test\nnot run: rm -rf x\nlogs: not checked\nVerdict: Pass · 0 mismatches\n'
    )
    expect(result.code).toBe(0)
  })

  it('prints the output of the last failing run under a variance whose count differs, and none when it agrees', async () => {
    const runs: [number, string][] = [
      [1, 'first failure\n'],
      [1, 'second failure\n'],
      [0, 'a pass\n'],
    ]
    const differs = await runVerifyDraft(
      ['verify-draft', '--draft', '/d.md', '--cwd', '/c'],
      fake({ ...BASE, '/d.md': draft('- `npm test`: 0 failed of 3') }, { 'npm test': runs }).deps
    )
    expect(differs.stdout).toBe(
      'variance: npm test: draft 0 failed of 3, got 2 failed of 3\n    output (last 40 lines):\n    second failure\nlogs: not checked\nVerdict: Pass · 0 mismatches\n'
    )
    const agrees = await runVerifyDraft(
      ['verify-draft', '--draft', '/d.md', '--cwd', '/c'],
      fake({ ...BASE, '/d.md': draft('- `npm test`: 2 failed of 3') }, { 'npm test': runs }).deps
    )
    expect(agrees.stdout).not.toContain('output (last 40 lines)')
  })

  it('ends a command that runs past --timeout, with the processes it started, reports it as a mismatch and runs the next entry', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'verify-draft-'))
    // The command starts a process that ignores SIGTERM, so only the SIGKILL of the group ends it.
    await writeFile(
      join(dir, 'hang.cjs'),
      [
        "const { spawn } = require('node:child_process')",
        "const { writeFileSync } = require('node:fs')",
        "const child = spawn(process.execPath, ['-e', \"process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)\"], { stdio: 'ignore' })",
        "writeFileSync('pids', `${process.pid} ${child.pid}`)",
        "console.log('started')",
        'setInterval(() => {}, 1000)',
        '',
      ].join('\n')
    )
    await writeFile(join(dir, 'ok.cjs'), "console.log('ok')\n")
    const agents = '# AGENTS.md\n\n## Commands\n\n```bash\nnode hang.cjs\nnode ok.cjs\n```\n'
    const limits: (ExecLimit | undefined)[] = []
    const deps: VerifyDraftDeps = {
      readText: (path) =>
        path === '/d.md'
          ? Promise.resolve(draft('- `node hang.cjs`: exit 0', '- `node ok.cjs`: exit 0'))
          : Promise.reject(new Error(`no ${path}`)),
      exists: () => Promise.resolve(false),
      baseAgents: () => Promise.resolve(agents),
      // The real exec, with a limit of seconds instead of the minutes --timeout gives.
      exec: (file, args, cwd, limit) => {
        limits.push(limit)
        return defaultVerifyDeps.exec(file, args, cwd, { timeoutMs: 3_000, graceMs: 500 })
      },
    }
    let pids: number[] = []
    try {
      const result = await runVerifyDraft(
        ['verify-draft', '--draft', '/d.md', '--cwd', dir, '--timeout', '3'],
        deps
      )
      pids = (await readFile(join(dir, 'pids'), 'utf8')).split(' ').map(Number)
      expect(limits).toEqual([
        { timeoutMs: 180_000, graceMs: 10_000 },
        { timeoutMs: 180_000, graceMs: 10_000 },
      ])
      expect(result.stdout).toBe(
        'mismatch: node hang.cjs: timed out after 3 min\n    output (last 40 lines):\n    started\nmatch: node ok.cjs\nlogs: not checked\nVerdict: Red · 1 mismatches\n'
      )
      expect(result.code).toBe(1)
      const [leader = 0, started = 0] = pids
      await expect.poll(() => alive(started), { timeout: 10_000 }).toBe(false)
      expect(alive(leader)).toBe(false)
      expect(alive(-leader)).toBe(false)
    } finally {
      for (const pid of pids) {
        try {
          process.kill(pid, 'SIGKILL')
        } catch {
          // already gone
        }
      }
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('a run of a k failed of n entry that times out makes the entry a mismatch, and the entry runs no more', async () => {
    const { deps, ran } = fake(
      {
        ...BASE,
        '/d.md': draft('- `npm test`: 0 failed of 3', '- `npm run check`: exit 0, 482 passed'),
      },
      {
        'npm test': [
          [0, 'first\n'],
          [0, 'second\n'],
        ],
        'npm run check': [[0, VITEST]],
      }
    )
    const exec = deps.exec
    let runs = 0
    deps.exec = async (file, args, cwd, limit) =>
      [file, ...args].join(' ') === 'npm test' && ++runs === 2
        ? { code: 1, output: 'so far\n', timedOut: true }
        : exec(file, args, cwd, limit)
    const result = await runVerifyDraft(
      ['verify-draft', '--draft', '/d.md', '--cwd', '/c', '--timeout', '4'],
      deps
    )
    expect(runs).toBe(2)
    expect(ran).toEqual(['npm test', 'npm run check'])
    expect(result.stdout).toBe(
      'mismatch: npm test: timed out after 4 min\n    output (last 40 lines):\n    so far\nmatch: npm run check\nlogs: not checked\nVerdict: Red · 1 mismatches\n'
    )
    expect(result.code).toBe(1)
  })

  it('passes a SIGTERM it gets on to the process group of the run in progress, then ends on it', async () => {
    const dir = await repository('process.stdin.resume()')
    let pids: number[] = []
    try {
      const cli = spawn(process.execPath, [CLI, 'verify-draft', '--draft', 'draft.md'], {
        cwd: dir,
        stdio: 'ignore',
      })
      const ended = new Promise<NodeJS.Signals | null>((done) => {
        cli.on('exit', (_, signal) => done(signal))
      })
      await expect.poll(() => readPids(dir), { timeout: 20_000 }).toHaveLength(2)
      pids = await readPids(dir)
      cli.kill('SIGTERM')
      expect(await ended).toBe('SIGTERM')
      const [leader = 0, started = 0] = pids
      await expect.poll(() => alive(-leader), { timeout: 10_000 }).toBe(false)
      expect(alive(started)).toBe(false)
    } finally {
      for (const pid of pids) {
        try {
          process.kill(pid, 'SIGKILL')
        } catch {
          // already gone
        }
      }
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('ends on exit what a command left running in its process group', async () => {
    const dir = await repository('process.exit(0)')
    let pids: number[] = []
    try {
      const cli = spawn(process.execPath, [CLI, 'verify-draft', '--draft', 'draft.md'], {
        cwd: dir,
        stdio: 'ignore',
      })
      const code = await new Promise<number | null>((done) => {
        cli.on('exit', (exit) => done(exit))
      })
      expect(code).toBe(0)
      pids = await readPids(dir)
      const [leader = 0, started = 0] = pids
      expect(alive(leader)).toBe(false)
      await expect.poll(() => alive(started), { timeout: 10_000 }).toBe(false)
    } finally {
      for (const pid of pids) {
        try {
          process.kill(pid, 'SIGKILL')
        } catch {
          // already gone
        }
      }
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('rejects a --timeout that is not a positive whole number with exit 2', async () => {
    const { deps, ran } = fake(
      { ...BASE, '/d.md': draft('- `npm test`: exit 0, 482 passed') },
      { 'npm test': [[0, VITEST]] }
    )
    for (const value of ['0', '-1', '1.5', '2m', 'x', '', ' 5', '35792']) {
      const result = await runVerifyDraft(
        ['verify-draft', '--draft', '/d.md', '--cwd', '/c', '--timeout', value],
        deps
      )
      expect(result.code).toBe(2)
      expect(result.stdout).toBe('')
      expect(result.stderr).toContain('--timeout')
    }
    const missing = await runVerifyDraft(
      ['verify-draft', '--draft', '/d.md', '--cwd', '/c', '--timeout'],
      deps
    )
    expect(missing.code).toBe(2)
    expect(ran).toEqual([])
    const ok = await runVerifyDraft(
      ['verify-draft', '--draft', '/d.md', '--cwd', '/c', '--timeout', '1'],
      deps
    )
    expect(ok.code).toBe(0)
  })
})

/** Whether `pid` (a process group when negative) still has a process. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url))

/**
 * A git repository under `TMPDIR` whose `AGENTS.md` at `HEAD` allows `node hold.cjs`, with a draft
 * that runs it. `hold.cjs` starts a process in its group that runs until it is killed, writes both
 * pids to `pids`, then runs `then`.
 */
async function repository(then: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'verify-draft-'))
  await writeFile(
    join(dir, 'hold.cjs'),
    [
      "const { spawn } = require('node:child_process')",
      "const { writeFileSync } = require('node:fs')",
      "const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })",
      "writeFileSync('pids', `${process.pid} ${child.pid}`)",
      then,
      '',
    ].join('\n')
  )
  await writeFile(
    join(dir, 'AGENTS.md'),
    '# AGENTS.md\n\n## Commands\n\n```bash\nnode hold.cjs\n```\n'
  )
  await writeFile(join(dir, 'draft.md'), draft('- `node hold.cjs`: exit 0'))
  const git = (...args: string[]) =>
    execFileSync(
      'git',
      [
        '-c',
        'user.name=test',
        '-c',
        'user.email=test@example.invalid',
        '-c',
        'commit.gpgsign=false',
        '-c',
        'core.hooksPath=/dev/null',
        ...args,
      ],
      { cwd: dir, stdio: 'ignore' }
    )
  git('init', '-q')
  git('add', 'AGENTS.md')
  git('commit', '-q', '-m', 'agents')
  return dir
}

/** The pids `hold.cjs` wrote, the command's and the one it started; empty before it wrote them. */
async function readPids(dir: string): Promise<number[]> {
  try {
    return (await readFile(join(dir, 'pids'), 'utf8')).split(' ').map(Number)
  } catch {
    return []
  }
}
