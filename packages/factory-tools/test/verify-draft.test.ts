import { describe, expect, it } from 'vitest'
import { runVerifyDraft, tokenize, verifyDraft } from '../src/verify-draft.js'
import type { VerifyDraftDeps } from '../src/verify-draft.js'

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
      fake({ ...BASE, '/d.md': draft('- The fixed criterion is read by the maintainer') }).deps
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
      fake({ ...BASE, '/d.md': draft('- `rm -rf x`: exit 0 (`logs/a.log`)'), '/l/a.log': '' }).deps
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
})
