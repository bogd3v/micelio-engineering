import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { tempDir } from '../../../test/support/temp.js'
import { createDeps, lintDraft, runLintDraft } from '../src/lint-draft.js'
import type { DraftContext, LintDraftDeps } from '../src/lint-draft.js'

const SYNCED = ['.claude/agents', '.claude/skills/ship-pr', 'CLAUDE.md']

const section = (...lines: string[]): string =>
  `# feat: x\n\n## Tests\n\nfine\n\n## Instructions that were wrong or missing\n\n${lines.join('\n')}\n\n## What could not be verified\n\nNothing\n`

const context = (changed: string[]): DraftContext => ({
  changed,
  synced: SYNCED,
  checkCommand: null,
})

describe('lint-draft', () => {
  it('fails an own file reported to the master', () => {
    const problems = lintDraft(
      section('- AGENTS.md: the Docker line is wrong - reported to the master'),
      context(['AGENTS.md'])
    )
    expect(problems).toHaveLength(1)
    expect(problems[0]?.problem).toContain('fix it on the branch')
    const skill = lintDraft(
      section('.claude/skills/local/SKILL.md: a step is missing - reported to the master'),
      context([])
    )
    expect(skill).toHaveLength(1)
  })

  it('fails a line that ends fixed in a file the diff does not touch', () => {
    const problems = lintDraft(
      section('AGENTS.md: the Docker line is wrong - fixed in AGENTS.md'),
      context(['README.md'])
    )
    expect(problems).toHaveLength(1)
    expect(problems[0]?.problem).toContain('the diff does not touch')
    expect(
      lintDraft(section('AGENTS.md: wrong - fixed in AGENTS.md'), context(['AGENTS.md']))
    ).toEqual([])
  })

  it('fails a line about the issue or the standard that ends fixed in, even in a file the diff touches', () => {
    const changed = context(['AGENTS.md'])
    const issue = lintDraft(
      section('issue: the test file it names has no Strapi - fixed in AGENTS.md'),
      changed
    )
    expect(issue).toHaveLength(1)
    expect(issue[0]?.problem).toContain('reported to the master, not fixed on the branch')
    const standard = lintDraft(
      section('`Standard`: section 8 is wrong - fixed in AGENTS.md'),
      changed
    )
    expect(standard).toHaveLength(1)
    expect(standard[0]?.problem).toContain('reported to the master, not fixed on the branch')
  })

  it('fails a synced file fixed anywhere but under template/', () => {
    const changed = context(['AGENTS.md', 'template/CLAUDE.md'])
    const elsewhere = lintDraft(section('CLAUDE.md: a rule is wrong - fixed in AGENTS.md'), changed)
    expect(elsewhere).toHaveLength(1)
    expect(elsewhere[0]?.problem).toContain('reported to the master')
    expect(elsewhere[0]?.problem).toContain('fixed in template/CLAUDE.md')
    expect(
      lintDraft(section('CLAUDE.md: a rule is wrong - fixed in template/CLAUDE.md'), changed)
    ).toEqual([])
  })

  it('passes a synced file reported from another repository', () => {
    const reported = section('.claude/agents/worker.md: a rule is wrong - reported to the master')
    expect(lintDraft(reported, context([]))).toEqual([])
    expect(
      lintDraft(
        section('.claude/skills/ship-pr/SKILL.md: a step is wrong - reported to the master'),
        context([])
      )
    ).toEqual([])
  })

  it('passes a synced file fixed under template/ in micelio-engineering', () => {
    const line = 'worker.md: a rule is wrong - fixed in template/.claude/agents/worker.md'
    expect(lintDraft(section(line), context(['template/.claude/agents/worker.md']))).toEqual([])
  })

  it('passes the standard and the issue reported, and Nothing', () => {
    expect(
      lintDraft(
        section(
          'standard: section 8 is wrong - reported to the master',
          'issue: wrong - reported to the master'
        ),
        context([])
      )
    ).toEqual([])
    expect(lintDraft(section('Nothing'), context([]))).toEqual([])
  })

  it('fails a line in neither shape, an empty section and a missing section', () => {
    expect(lintDraft(section('AGENTS.md was a bit stale'), context([]))).toHaveLength(1)
    expect(lintDraft(section(''), context([]))[0]?.problem).toContain('empty')
    expect(lintDraft('# t\n\n## Tests\n', context([]))[0]?.problem).toContain('no "Instructions')
  })

  const withTests = (...lines: string[]): string =>
    `# feat: x\n\n## Tests\n\n${lines.join('\n')}\n\n## Instructions that were wrong or missing\n\nNothing\n`

  it('fails a Tests entry that runs wc -w and names the line', () => {
    const line = '- `wc -w docs/factory.md` exit 0, 5774 words, log `logs/wc.log`'
    const problems = lintDraft(withTests('- `npm test` exit 0', line), context([]))
    expect(problems).toHaveLength(1)
    expect(problems[0]?.line).toContain('wc -w docs/factory.md')
    expect(problems[0]?.problem).toContain('read from the test that holds them')
    expect(lintDraft(withTests('- `wc -lw a.md` exit 0'), context([]))).toHaveLength(1)
  })

  it('fails a wc -w command in a fenced block of the Tests section', () => {
    const draft = withTests('```bash', '# the total', 'cat a.md | wc -w', '```')
    const problems = lintDraft(draft, context([]))
    expect(problems).toHaveLength(1)
    expect(problems[0]?.line).toBe('cat a.md | wc -w')
  })

  it('fails a wc -w that a path, a late flag, a long option or a redirection hides', () => {
    for (const command of [
      '/usr/bin/wc -w a.md',
      './bin/wc -w a.md',
      'wc a.md -w',
      'wc --word a.md',
      'wc -w<a.md',
    ]) {
      expect(lintDraft(withTests(`- \`${command}\` exit 0`), context([]))).toHaveLength(1)
    }
  })

  it('checks a Tests section under a title that holds the word, and skips plain sentences', () => {
    const titled = `# feat: Tests that count\n\n## Tests\n\n- \`wc -w a.md\` exit 0\n`
    expect(
      lintDraft(`${titled}\n## Instructions that were wrong or missing\n\nNothing\n`, context([]))
    ).toHaveLength(1)
    const prose = withTests('Rows that ran `wc -w` were wrong.')
    expect(lintDraft(prose, context([]))).toEqual([])
  })

  it('passes a Tests item that only mentions wc -w, and fails one that runs it', () => {
    for (const mention of [
      '`git grep -c "wc -w" -- docs/factory.md`: exit 1',
      '`new check (wc -w in a list item): fails there`',
      'round 2: `fails a wc -w that a path hides` fails there',
    ]) {
      expect(lintDraft(withTests(`- ${mention}`), context([]))).toEqual([])
    }
    for (const run of [
      '`wc -w a.md`: 12',
      '`cd d && wc -w a.md`',
      '$(wc -w a.md)',
      '$ wc -w a.md',
    ]) {
      expect(lintDraft(withTests(`- ${run}`), context([]))).toHaveLength(1)
    }
  })

  it('stops reading at the next heading: a list item that runs wc -w below it passes', () => {
    const draft = `${withTests('- `wc -l a.md`: 3')}\n## For review\n\n- \`wc -w a.md\`: 12\n`
    expect(lintDraft(draft, context([]))).toEqual([])
  })

  it('ignores quoted text: a wc -w inside quotes is not run', () => {
    for (const quoted of [
      "`echo 'a | wc -w'`",
      '`echo "x; wc -w a.md"`',
      '`grep "wc -w" a.md | wc -l`',
    ]) {
      expect(lintDraft(withTests(`- ${quoted}`), context([]))).toEqual([])
    }
  })

  it('splits a line on |, ;, & and $( and checks each command', () => {
    for (const line of [
      'a | wc -w',
      'a; wc -w',
      'a & wc -w',
      'a || wc -w',
      'a && wc -w',
      'echo $(wc -w a.md)',
    ]) {
      expect(lintDraft(withTests('```', line, '```'), context([]))).toHaveLength(1)
    }
    expect(lintDraft(withTests('```', 'wc -l a.md | sort; echo wc', '```'), context([]))).toEqual(
      []
    )
  })

  it('skips leading VAR=value words and env before the command', () => {
    for (const line of [
      'LC_ALL=C wc -w a.md',
      'env wc -w a.md',
      'env LC_ALL=C A=1 /usr/bin/wc -w a.md',
    ]) {
      expect(lintDraft(withTests('```', line, '```'), context([]))).toHaveLength(1)
    }
    expect(lintDraft(withTests('```', 'LC_ALL=C wc -l a.md', '```'), context([]))).toEqual([])
  })

  it('looks inside docker run, xargs and sh -c', () => {
    for (const line of [
      'docker run --rm node:22 wc -w a.md',
      'ls | xargs wc -w',
      "sh -c 'wc -w a.md'",
      'sh -c "wc -w a.md"',
    ]) {
      expect(lintDraft(withTests('```', line, '```'), context([]))).toHaveLength(1)
    }
  })

  it('looks inside podman exec and bash -c, and reads a path to wc', () => {
    for (const line of [
      'podman exec c /usr/bin/wc -lw a.md',
      "bash -c 'cat a.md | wc --words'",
      '- `find docs -name "*.md" | xargs wc -w`: exit 0',
    ]) {
      expect(lintDraft(withTests('```', line, '```'), context([]))).toHaveLength(1)
    }
  })

  it('passes a wc whose -w is only in a shell comment', () => {
    for (const line of [
      'wc -l a.md # not -w',
      'ls | wc -l # wc -w is not run',
      'docker run --rm node:22 wc -l a.md',
      'ls | xargs wc -l',
      "sh -c 'wc -l a.md'",
      "sh -c 'echo hi' wc -w",
    ]) {
      expect(lintDraft(withTests('```', line, '```'), context([]))).toEqual([])
    }
  })

  it('fails a wc -w whose flag touches the ) of a $( followed by more text', () => {
    for (const line of ['[ $(cat a.md | wc -w) -le 5 ]', 'n=$(wc -w) && echo $n']) {
      expect(lintDraft(withTests('```', line, '```'), context([]))).toHaveLength(1)
    }
    expect(
      lintDraft(withTests('```', '[ $(cat a.md | wc -l) -le 5 ]', '```'), context([]))
    ).toEqual([])
  })

  it('passes wc -w outside the Tests section and wc -l inside it', () => {
    const draft = `${withTests('- `wc -l docs/factory.md` exit 0, 200 lines')}\n## For review\n\nOld rows ran wc -w.\n`
    expect(lintDraft(draft, context([]))).toEqual([])
  })
})

describe('runLintDraft', () => {
  const deps = (draft: string, changed: string[]): LintDraftDeps => ({
    readText: async () => draft,
    diffNames: async () => changed,
    syncedFiles: async () => SYNCED,
  })

  it('exits 0 on a right section, 1 on a wrong one', async () => {
    const ok = await runLintDraft(
      ['lint-draft', '--file', 'd.md', '--base', 'origin/main'],
      deps(section('Nothing'), [])
    )
    expect(ok.code).toBe(0)
    const bad = await runLintDraft(
      ['lint-draft', '--file', 'd.md', '--base', 'origin/main'],
      deps(section('AGENTS.md: x - reported to the master'), [])
    )
    expect(bad.code).toBe(1)
    expect(bad.stdout).toContain('1 problem(s)')
  })

  it('exits 2 on bad arguments and on an unreadable draft', async () => {
    expect((await runLintDraft(['lint-draft', '--file', 'd.md'], deps('', []))).code).toBe(2)
    expect((await runLintDraft(['lint-draft', '--bogus', 'x'], deps('', []))).code).toBe(2)
    const unreadable = await runLintDraft(['lint-draft', '--file', 'd.md', '--base', 'b'], {
      ...deps('', []),
      readText: async () => {
        throw new Error('ENOENT')
      },
    })
    expect(unreadable.code).toBe(2)
    expect(unreadable.stderr).toContain('ENOENT')
  })
})

describe('createDeps', () => {
  it('reads the synced files from this checkout, not from a target that has none', async () => {
    const target = tempDir('lint-draft-target-')
    const git = (...args: string[]): string =>
      execFileSync('git', ['-C', target, ...args], { encoding: 'utf8' })
    git('init', '-q')
    await writeFile(join(target, 'AGENTS.md'), 'a\n')
    git('add', '.')
    git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'x')
    const draft = join(target, 'draft.md')
    await writeFile(
      draft,
      '## Instructions that were wrong or missing\n\n.claude/skills/ship-pr/SKILL.md: x - reported to the master\n'
    )
    const result = await runLintDraft(
      ['lint-draft', '--file', draft, '--base', 'HEAD'],
      createDeps(target)
    )
    expect(result.stderr).toBe('')
    expect(result.code).toBe(0)
  })
})

describe('runLintDraft edited tests', () => {
  it('fails a draft when the dependencies report an edited test, and passes once answered', async () => {
    const make = (draft: string): LintDraftDeps => ({
      readText: () => Promise.resolve(draft),
      diffNames: () => Promise.resolve(['test/a.test.ts']),
      syncedFiles: () => Promise.resolve(SYNCED),
      editedTests: () => Promise.resolve(['test/a.test.ts']),
    })
    const base = '## For review\n\n%s\n\n## Instructions that were wrong or missing\n\nNothing\n'
    const argv = ['lint-draft', '--file', 'd.md', '--base', 'b']
    const bad = await runLintDraft(argv, make(base.replace('%s', 'Nothing.')))
    expect(bad.code).toBe(1)
    expect(bad.stdout).toContain('test/a.test.ts')
    const answer = 'test-edit: test/a.test.ts - "Rename it."'
    expect((await runLintDraft(argv, make(base.replace('%s', answer)))).code).toBe(0)
  })
})

describe('lint-draft edited tests', () => {
  const withReview = (review: string): string =>
    `# feat: x\n\n## For review\n\n${review}\n\n## Instructions that were wrong or missing\n\nNothing\n`
  const edited = (...editedTests: string[]): DraftContext => ({
    changed: editedTests,
    synced: SYNCED,
    editedTests,
    checkCommand: null,
  })

  it('fails a draft whose diff removes lines of an existing test', () => {
    const problems = lintDraft(withReview('Nothing to say.'), edited('test/a.test.ts'))
    expect(problems).toHaveLength(1)
    expect(problems[0]?.problem).toContain('test/a.test.ts')
    expect(problems[0]?.problem).toContain('G3.3')
  })

  it('passes an existing test the diff only adds to, and a new test file', () => {
    expect(lintDraft(withReview('Nothing to say.'), edited())).toEqual([])
    expect(lintDraft(withReview('Nothing to say.'), context(['test/new.test.ts']))).toEqual([])
  })

  it('passes an edited test that For review answers with test-edit:', () => {
    const answer = 'test-edit: test/a.test.ts - "Rename the case to match the new term."'
    expect(lintDraft(withReview(answer), edited('test/a.test.ts'))).toEqual([])
    expect(lintDraft(withReview(`- ${answer}`), edited('test/a.test.ts'))).toEqual([])
    // an answer for another path, or one with no sentence, does not answer
    expect(lintDraft(withReview(answer), edited('test/b.test.ts'))).toHaveLength(1)
    expect(
      lintDraft(withReview('test-edit: test/a.test.ts - '), edited('test/a.test.ts'))
    ).toHaveLength(1)
  })

  it('answers a path with spaces, and ignores a test-edit: line outside For review', () => {
    const path = 'test/my file.test.ts'
    const answer = `test-edit: ${path} - "Rename the case."`
    expect(lintDraft(withReview(answer), edited(path))).toEqual([])
    const outside = `# feat: x\n\n## For review\n\nNothing.\n\n## Tests\n\n${answer}\n\n## Instructions that were wrong or missing\n\nNothing\n`
    expect(lintDraft(outside, edited(path))).toHaveLength(1)
  })

  it('a fixture and a file that is not a test are not edited tests', () => {
    const paths = ['test/fixtures/a.test.ts', 'src/a.ts', 'tests/fixtures/x.json']
    expect(lintDraft(withReview('Nothing.'), edited(...paths))).toEqual([])
    const tests = ['tests/helper.ts', 'src/__tests__/x.ts', 'e2e/flow.ts', 'src/a.spec.ts']
    expect(lintDraft(withReview('Nothing.'), edited(...tests))).toHaveLength(4)
  })
})

describe('createDeps editedTests', () => {
  it('createDeps lists the test files the diff removes lines from', async () => {
    const repo = tempDir('lint-draft-edited-')
    const git = (...args: string[]): string =>
      execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' })
    git('init', '-q')
    mkdirSync(join(repo, 'test', 'fixtures'), { recursive: true })
    await writeFile(join(repo, 'test', 'a.test.ts'), 'one\ntwo\n')
    await writeFile(join(repo, 'test', 'b.test.ts'), 'one\n')
    await writeFile(join(repo, 'test', 'fixtures', 'c.test.ts'), 'one\ntwo\n')
    await writeFile(join(repo, 'src.ts'), 'one\ntwo\n')
    git('add', '.')
    git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'x')
    await writeFile(join(repo, 'test', 'a.test.ts'), 'one\nthree\n')
    await writeFile(join(repo, 'test', 'b.test.ts'), 'one\ntwo\n')
    await writeFile(join(repo, 'test', 'fixtures', 'c.test.ts'), 'one\n')
    await writeFile(join(repo, 'src.ts'), 'one\n')
    await writeFile(join(repo, 'test', 'new.test.ts'), 'x\n')
    git('add', '-N', '.')
    const edited = await createDeps(repo).editedTests?.('HEAD')
    expect(edited).toEqual(['test/a.test.ts'])
  })

  it('createDeps reports a renamed test as removed and a non-ASCII path unquoted', async () => {
    const repo = tempDir('lint-draft-rename-')
    const git = (...args: string[]): string =>
      execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' })
    git('init', '-q')
    mkdirSync(join(repo, 'test'), { recursive: true })
    await writeFile(join(repo, 'test', 'old.test.ts'), 'one\ntwo\n')
    await writeFile(join(repo, 'test', 'ñandú.test.ts'), 'one\ntwo\n')
    git('add', '.')
    git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'x')
    git('mv', 'test/old.test.ts', 'test/new.test.ts')
    await writeFile(join(repo, 'test', 'ñandú.test.ts'), 'one\n')
    git('add', '-A')
    const edited = await createDeps(repo).editedTests?.('HEAD')
    expect(edited).toEqual(['test/old.test.ts', 'test/ñandú.test.ts'])
  })
})

describe('lint-draft check command', () => {
  const CHECK = ['npm', 'run', 'check']
  const withTests = (...items: string[]): string =>
    `# chore: x\n\n## Tests\n\n${items.join('\n')}\n\n## Instructions that were wrong or missing\n\nNothing\n`
  const needs = (changed: string[] = []): DraftContext => ({
    changed,
    synced: SYNCED,
    checkCommand: CHECK,
  })

  it('fails a draft whose Tests section says the check command was not run', () => {
    const problems = lintDraft(
      withTests('- Not run: `npm run check` (no code or tested path changes)'),
      needs()
    )
    expect(problems).toHaveLength(1)
    expect(problems[0]?.problem).toContain('npm run check')
    expect(problems[0]?.problem).toContain('G2.1')
  })

  it('fails a draft with no Tests section, or whose check entry does not report exit 0', () => {
    expect(
      lintDraft('## Instructions that were wrong or missing\n\nNothing\n', needs())
    ).toHaveLength(1)
    expect(lintDraft(withTests('- `npm run check`: exit 1, 3 failed'), needs())).toHaveLength(1)
    expect(lintDraft(withTests('- `npm run lint`: exit 0'), needs())).toHaveLength(1)
  })

  it('passes the check command reported with exit 0, through factory-slot.sh run too', () => {
    expect(
      lintDraft(withTests('- `npm run check`: exit 0, 12 passed, `logs/check.log`'), needs())
    ).toEqual([])
    expect(
      lintDraft(
        withTests('- `/x/herdr/factory-slot.sh run -- npm run check`: exit 0, `logs/check.log`'),
        needs()
      )
    ).toEqual([])
    expect(lintDraft(withTests('- `npm run check`\n  exit 0, `logs/check.log`'), needs())).toEqual(
      []
    )
  })

  it('does not judge a repository with no check command', () => {
    expect(lintDraft(withTests('- `npm test`: exit 0'), context([]))).toEqual([])
  })

  it('runLintDraft reads the check command from the dependencies', async () => {
    const deps: LintDraftDeps = {
      readText: async () => withTests('- Not run: `npm run check`'),
      diffNames: async () => [],
      syncedFiles: async () => SYNCED,
      checkCommand: async () => CHECK,
    }
    const result = await runLintDraft(['lint-draft', '--file', 'd.md', '--base', 'b'], deps)
    expect(result.code).toBe(1)
    expect(result.stdout).toContain('G2.1')
  })

  it("createDeps reads the check command from AGENTS.md, else from the manifest's check script", async () => {
    const dir = tempDir('lint-draft-check-')
    const read = (): Promise<string[] | null> | undefined => createDeps(dir).checkCommand?.()
    expect(await read()).toBeNull()
    await writeFile(join(dir, 'package.json'), '{"scripts":{"test":"x"}}')
    expect(await read()).toBeNull()
    await writeFile(join(dir, 'package.json'), '{"scripts":{"check":"x"}}')
    expect(await read()).toEqual(CHECK)
    await writeFile(
      join(dir, 'AGENTS.md'),
      '## Commands\n\n```bash\ntest: make test\ncheck: make verify [--fast]   # all of it\n```\n'
    )
    expect(await read()).toEqual(['make', 'verify'])
    await writeFile(join(dir, 'AGENTS.md'), '## Commands\n\n```bash\ntest: make test\n```\n')
    expect(await read()).toEqual(CHECK)
  })

  it('createDeps fails on an AGENTS.md it cannot read or a manifest that is not JSON, not as no check command', async () => {
    const dir = tempDir('lint-draft-check-')
    await writeFile(join(dir, 'package.json'), '{not json')
    await expect(createDeps(dir).checkCommand?.()).rejects.toThrow()
    rmSync(join(dir, 'package.json'))
    mkdirSync(join(dir, 'AGENTS.md'))
    await expect(createDeps(dir).checkCommand?.()).rejects.toThrow()
  })

  it('runLintDraft exits 2 when the check command cannot be read', async () => {
    const deps: LintDraftDeps = {
      readText: async () => withTests('- `npm run check`: exit 0'),
      diffNames: async () => [],
      syncedFiles: async () => SYNCED,
      checkCommand: async () => {
        throw new Error('bad package.json')
      },
    }
    const result = await runLintDraft(['lint-draft', '--file', 'd.md', '--base', 'b'], deps)
    expect(result.code).toBe(2)
  })
})

describe('lint-draft logs of the Tests section', () => {
  const tests = (...lines: string[]): string =>
    `# chore: x\n\n## Tests\n\n${lines.join('\n')}\n\n## Instructions that were wrong or missing\n\nNothing\n`
  const withLogs = (...logFiles: string[]): DraftContext => ({
    changed: [],
    synced: SYNCED,
    checkCommand: null,
    logFiles,
  })
  const grepBlock = ['```text', '$ git grep -n "pin" -- docs', 'exit 0', '3 matches', '```']

  it('a Tests block with no log line is a problem and names the command', () => {
    const problems = lintDraft(tests(...grepBlock), withLogs('npm-test.log'))
    expect(problems).toHaveLength(1)
    expect(problems[0]?.line).toBe('git grep -n "pin" -- docs')
    expect(problems[0]?.problem).toContain('names no log file')
  })

  it('a log line whose file is not in the logs directory is a problem', () => {
    const block = [...grepBlock.slice(0, -1), 'log: logs/git-grep.log', '```']
    const problems = lintDraft(tests(...block), withLogs('npm-test.log'))
    expect(problems).toHaveLength(1)
    expect(problems[0]?.problem).toContain('logs/git-grep.log')
    expect(lintDraft(tests(...block), withLogs('git-grep.log'))).toEqual([])
  })

  it('a block shown failing without the change needs no log', () => {
    const draft = tests('The test, run without the change:', '', ...grepBlock)
    expect(lintDraft(draft, withLogs())).toEqual([])
  })

  it('without --logs the Tests section is not read', async () => {
    expect(lintDraft(tests(...grepBlock, '- `npm test`: exit 0'), context([]))).toEqual([])
    const deps: LintDraftDeps = {
      readText: async () => tests(...grepBlock),
      diffNames: async () => [],
      syncedFiles: async () => SYNCED,
      logFiles: async () => [],
    }
    const without = await runLintDraft(['lint-draft', '--file', 'd.md', '--base', 'b'], deps)
    expect(without.code).toBe(0)
    const given = await runLintDraft(
      ['lint-draft', '--file', 'd.md', '--base', 'b', '--logs', 'logs'],
      deps
    )
    expect(given.code).toBe(1)
    expect(given.stdout).toContain('git grep')
  })

  it('a draft whose blocks all have their logs passes', async () => {
    const fixture = await readFile(
      new URL('../../../fixtures/factory/wrong-test-count.md', import.meta.url),
      'utf8'
    )
    expect(lintDraft(fixture, withLogs())).toHaveLength(1)
    expect(lintDraft(fixture, withLogs('npm-test.log'))).toEqual([])
  })

  it('a Tests list item with no log is a problem and names the command', () => {
    const problems = lintDraft(tests('- `git grep -c pin docs`: exit 0, 3 matches'), withLogs())
    expect(problems).toHaveLength(1)
    expect(problems[0]?.line).toBe('git grep -c pin docs')
    expect(problems[0]?.problem).toContain('names no log file')
    const numbered = lintDraft(tests('1. `ls`: exit 0'), withLogs())
    expect(numbered).toHaveLength(1)
  })

  it('a list item whose log file is not in the logs directory is a problem', () => {
    const item = '- `npm test`: exit 0 (`logs/npm-test.log`)'
    const problems = lintDraft(tests(item), withLogs('other.log'))
    expect(problems).toHaveLength(1)
    expect(problems[0]?.problem).toContain('logs/npm-test.log')
  })

  it('a list item shown failing without the change needs no log', () => {
    const inline = '- `npm test` without the change: exit 1, 2 failed'
    expect(lintDraft(tests(inline), withLogs())).toEqual([])
    const under = tests('Run without the change:', '', '- `npm test`: exit 1, 2 failed')
    expect(lintDraft(under, withLogs())).toEqual([])
    // exit 0 under that line is a run that passed: it needs its log
    expect(
      lintDraft(tests('Run without the change:', '', '- `npm test`: exit 0'), withLogs())
    ).toHaveLength(1)
  })

  it('a draft whose list items all have their logs passes', () => {
    const draft = tests(
      '- `npm test`: exit 0, 4 passed (`logs/npm-test.log`)',
      '* `npm run check`: exit 0, `logs/check.log`',
      '- no test: not code'
    )
    expect(lintDraft(draft, withLogs('npm-test.log', 'check.log'))).toEqual([])
  })

  it('createDeps lists the files of a logs directory', async () => {
    const dir = tempDir('lint-draft-logs-')
    await writeFile(join(dir, 'a.log'), 'x')
    mkdirSync(join(dir, 'sub'))
    await writeFile(join(dir, 'sub', 'b.log'), 'x')
    const files = await createDeps(dir).logFiles?.(dir)
    expect([...(files ?? [])].sort()).toEqual(['a.log', 'sub/b.log'])
  })

  it('a block after a block shown without the change does not take its intro', () => {
    const failing = ['The test, run without the change:', '```text', '$ npm test', 'exit 1', '```']
    const passing = ['```text', '$ git grep -n "pin" -- docs', 'exit 0', '```']
    const problems = lintDraft(tests(...failing, ...passing), withLogs())
    expect(problems).toHaveLength(1)
    expect(problems[0]?.line).toBe('git grep -n "pin" -- docs')
  })

  it('a block under a subheading of the Tests section is checked', () => {
    const problems = lintDraft(tests('### More', '', ...grepBlock), withLogs())
    expect(problems).toHaveLength(1)
    expect(problems[0]?.line).toBe('git grep -n "pin" -- docs')
  })

  it('a block under a heading of the same level as Tests is not read', () => {
    const draft = `# chore: x\n\n## Tests\n\nnone\n\n## Notes\n\n${grepBlock.join('\n')}\n`
    const lines = lintDraft(draft, withLogs()).map((problem) => problem.line)
    expect(lines).not.toContain('git grep -n "pin" -- docs')
  })

  it('createDeps lists the files of a logs directory given unnormalised', async () => {
    const dir = tempDir('lint-draft-logs-')
    await writeFile(join(dir, 'a.log'), 'x')
    mkdirSync(join(dir, 'sub'))
    await writeFile(join(dir, 'sub', 'b.log'), 'x')
    for (const given of [`${dir}//`, `${dir}/./`, join(dir, 'sub', '..')]) {
      const files = await createDeps(dir).logFiles?.(given)
      expect([...(files ?? [])].sort()).toEqual(['a.log', 'sub/b.log'])
    }
  })
})

describe('lint-draft in micelio-engineering', () => {
  const home = (changed: string[] = []): DraftContext => ({ ...context(changed), home: true })

  it('in micelio-engineering, fails a synced file reported to the master', () => {
    const problems = lintDraft(
      section('.claude/agents/worker.md: a rule is wrong - reported to the master'),
      home()
    )
    expect(problems).toHaveLength(1)
    expect(problems[0]?.problem).toContain('fixed in template/.claude/agents/worker.md')
    const prefixed = lintDraft(
      section('template/.claude/agents/worker.md: a rule is wrong - reported to the master'),
      home()
    )
    expect(prefixed).toHaveLength(1)
    expect(prefixed[0]?.problem).toContain('fixed in template/.claude/agents/worker.md')
  })

  it('in micelio-engineering, fails a file under herdr/ or template/ reported to the master', () => {
    for (const path of ['herdr/master.md', 'template/.claude/skills/blind-review/SKILL.md']) {
      const problems = lintDraft(
        section(`${path}: a step is wrong - reported to the master`),
        home()
      )
      expect(problems, path).toHaveLength(1)
      expect(problems[0]?.problem).toContain('fix it on the branch')
    }
  })

  it('in micelio-engineering, still passes the standard and the issue reported', () => {
    expect(
      lintDraft(
        section(
          'standard: section 8 is wrong - reported to the master',
          'issue: wrong - reported to the master'
        ),
        home()
      )
    ).toEqual([])
  })

  it("createDeps reads home from the worktree's .github/standard-sync.json", async () => {
    const make = (withFile: boolean): string => {
      const dir = tempDir('lint-draft-home-')
      execFileSync('git', ['-C', dir, 'init', '-q'])
      if (withFile) {
        mkdirSync(join(dir, '.github'))
        execFileSync('sh', ['-c', `echo '{"files":[]}' > "${dir}/.github/standard-sync.json"`])
      }
      return dir
    }
    expect(await createDeps(make(true)).home?.()).toBe(true)
    expect(await createDeps(make(false)).home?.()).toBe(false)
  })

  it('runLintDraft passes home from its dependencies to the rule', async () => {
    const run = (isHome: boolean): ReturnType<typeof runLintDraft> =>
      runLintDraft(['lint-draft', '--file', 'd.md', '--base', 'HEAD'], {
        readText: () =>
          Promise.resolve(section('herdr/master.md: a step is wrong - reported to the master')),
        diffNames: () => Promise.resolve([]),
        syncedFiles: () => Promise.resolve(SYNCED),
        home: () => Promise.resolve(isHome),
      })
    expect((await run(true)).code).toBe(1)
    expect((await run(false)).code).toBe(0)
  })
})

describe('lint-draft age of the evidence of the Tests section', () => {
  const tests = (...lines: string[]): string =>
    `# chore: x\n\n## Tests\n\n${lines.join('\n')}\n\n## Instructions that were wrong or missing\n\nNothing\n`
  const aged = (
    evidenceTimes: Record<string, number>,
    changedTimes: Record<string, number> = { 'src/a.ts': 2000 }
  ): DraftContext => ({
    changed: Object.keys(changedTimes),
    synced: SYNCED,
    checkCommand: null,
    evidenceTimes,
    changedTimes,
  })

  it('fails a log older than the newest changed file when its entry names no round', () => {
    const problems = lintDraft(
      tests('- `npm test`: exit 0 (`logs/npm-test.log`)'),
      aged({ 'logs/npm-test.log': 1000 })
    )
    expect(problems).toHaveLength(1)
    expect(problems[0]?.problem).toContain('logs/npm-test.log')
    expect(problems[0]?.problem).toContain('1970-01-01T00:00:01.000Z')
    expect(problems[0]?.problem).toContain('src/a.ts')
    const block = tests('```text', '$ npm test', 'exit 0', 'log: logs/npm-test.log', '```')
    expect(lintDraft(block, aged({ 'logs/npm-test.log': 1000 }))).toHaveLength(1)
  })

  it('fails an image the Tests section names that predates the newest changed file', () => {
    const problems = lintDraft(
      tests('- `herdr-app shot`: exit 0, `shots/Panel.png`'),
      aged({ 'shots/Panel.png': 1999 })
    )
    expect(problems).toHaveLength(1)
    expect(problems[0]?.problem).toContain('shots/Panel.png')
  })

  it('fails an image a fenced block names', () => {
    const block = tests('```text', '$ herdr-app shot --out shots/X.png', 'exit 0', '```')
    expect(lintDraft(block, aged({ 'shots/X.png': 1000 }))).toHaveLength(1)
  })

  it('passes an older log whose entry names its round', () => {
    const old = aged({ 'logs/npm-test.log': 1000 })
    expect(
      lintDraft(tests('- `npm test`: exit 0, `logs/npm-test.log` (from round 1)'), old)
    ).toEqual([])
    const block = tests('From round 1:', '```text', '$ npm test', 'log: logs/npm-test.log', '```')
    expect(lintDraft(block, old)).toEqual([])
    const failing = tests('- `npm test` without the change: exit 1, `logs/npm-test.log`')
    expect(lintDraft(failing, old)).toEqual([])
  })

  it('passes a log written after the last change to the diff', () => {
    const item = tests('- `npm test`: exit 0 (`logs/npm-test.log`)')
    expect(lintDraft(item, aged({ 'logs/npm-test.log': 2000 }))).toEqual([])
    expect(lintDraft(item, aged({ 'logs/npm-test.log': 3000 }))).toEqual([])
  })

  it('is skipped without the times, and for a file that does not exist', () => {
    const item = tests('- `npm test`: exit 0 (`logs/npm-test.log`)')
    expect(lintDraft(item, context([]))).toEqual([])
    expect(lintDraft(item, aged({}))).toEqual([])
    expect(lintDraft(item, aged({ 'logs/npm-test.log': 1 }, {}))).toEqual([])
  })

  it('createDeps reads the times of the packet files and of the changed and untracked files', async () => {
    const root = tempDir('lint-draft-age-')
    const repo = join(root, 'wt')
    const packet = join(root, 'packet')
    mkdirSync(repo)
    mkdirSync(join(packet, 'logs'), { recursive: true })
    execFileSync('git', ['-C', repo, 'init', '-q'])
    await writeFile(join(repo, 'a.ts'), 'x')
    execFileSync('git', ['-C', repo, 'add', '.'])
    execFileSync('git', [
      '-C',
      repo,
      '-c',
      'user.name=t',
      '-c',
      'user.email=t@t',
      'commit',
      '-q',
      '-m',
      'x',
    ])
    await writeFile(join(repo, 'a.ts'), 'y')
    await writeFile(join(repo, 'b.ts'), 'x')
    await writeFile(join(packet, 'logs', 'a.log'), 'x')
    const deps = createDeps(repo)
    const evidence = await deps.evidenceTimes?.(join(packet, 'logs'), ['logs/a.log', 'logs/b.log'])
    expect(Object.keys(evidence ?? {})).toEqual(['logs/a.log'])
    const changed = await deps.changedTimes?.('HEAD')
    expect(Object.keys(changed ?? {}).sort()).toEqual(['a.ts', 'b.ts'])
  })

  it('runLintDraft passes the times from its dependencies to the rule', async () => {
    const deps = (log: number): LintDraftDeps => ({
      readText: () => Promise.resolve(tests('- `npm test`: exit 0 (`logs/npm-test.log`)')),
      diffNames: () => Promise.resolve([]),
      syncedFiles: () => Promise.resolve(SYNCED),
      logFiles: () => Promise.resolve(['npm-test.log']),
      evidenceTimes: () => Promise.resolve({ 'logs/npm-test.log': log }),
      changedTimes: () => Promise.resolve({ 'src/a.ts': 2000 }),
    })
    const argv = ['lint-draft', '--file', 'd.md', '--base', 'b', '--logs', 'logs']
    expect((await runLintDraft(argv, deps(1000))).code).toBe(1)
    expect((await runLintDraft(argv, deps(2000))).code).toBe(0)
  })
})

describe('lint-draft figures of the Tests section against their logs', () => {
  const tests = (...lines: string[]): string =>
    `# chore: x\n\n## Tests\n\n${lines.join('\n')}\n\n## Instructions that were wrong or missing\n\nNothing\n`
  const withLogs = (logContents: Record<string, string>): DraftContext => ({
    changed: [],
    synced: SYNCED,
    checkCommand: null,
    logContents,
  })
  const vitest = ' Test Files  23 passed (23)\n      Tests  706 passed (706)\n'

  it('fails a baseline figure in parentheses that the named log does not hold', () => {
    const problems = lintDraft(
      tests('- `npm test`: exit 0, 706 passed (700 passed on main) (`logs/npm-test.log`)'),
      withLogs({ 'npm-test.log': vitest })
    )
    expect(problems).toHaveLength(1)
    expect(problems[0]?.line).toBe('npm test')
    expect(problems[0]?.problem).toContain('700 passed')
    expect(problems[0]?.problem).toContain('logs/npm-test.log')
  })

  it('fails a reuse count written in a form the named log does not print', () => {
    const problems = lintDraft(
      tests('- `reuse lint`: exit 0, 43 / 43 files (`logs/reuse.log`)'),
      withLogs({ 'reuse.log': '* Files with copyright information: 43 / 43\n' })
    )
    expect(problems).toHaveLength(1)
    expect(problems[0]?.problem).toContain('43 files')
    expect(problems[0]?.problem).toContain('logs/reuse.log')
  })

  it('passes an entry whose figures the named log holds', () => {
    const draft = tests(
      '- `npm test`: exit 0, 23 test files, 706 tests, round 2 (`logs/npm-test.log`)',
      '- `npm test`: exit 1, 1,706 passed without the change (`logs/other.log`)',
      '- `npm test`: exit 0, 706 passed (`logs/missing.log`)'
    )
    expect(lintDraft(draft, withLogs({ 'npm-test.log': vitest }))).toEqual([])
  })

  it('does not compare a prose figure that verify-draft does not compare', () => {
    const draft = tests(
      '- `npm test`: exit 0, 706 passed, +5 new tests, load 7.66 on 8 cores (`logs/npm-test.log`)'
    )
    expect(lintDraft(draft, withLogs({ 'npm-test.log': vitest }))).toEqual([])
  })

  it('compares an entry that verify-draft prints as earlier, and is skipped without log texts', () => {
    const draft = tests(
      '- `npm test`: exit 0, 700 passed (`logs/a.log`)',
      '- `npm test`: exit 0, 706 passed (`logs/b.log`)'
    )
    const texts = { 'a.log': vitest, 'b.log': vitest }
    expect(lintDraft(draft, withLogs(texts))).toHaveLength(1)
    expect(lintDraft(draft, { ...withLogs(texts), logContents: undefined })).toEqual([])
  })

  it('createDeps reads the texts of the named logs and runLintDraft hands them to the rule', async () => {
    const dir = tempDir('lint-draft-figures-')
    await writeFile(join(dir, 'npm-test.log'), vitest)
    const draft = tests('- `npm test`: exit 0, 700 passed (`logs/npm-test.log`)')
    const deps = createDeps(dir)
    expect(await deps.logContents?.(dir, ['npm-test.log', 'gone.log'])).toEqual({
      'npm-test.log': vitest,
    })
    const run = await runLintDraft(
      ['lint-draft', '--file', 'd.md', '--base', 'b', '--logs', 'logs'],
      {
        readText: () => Promise.resolve(draft),
        diffNames: () => Promise.resolve([]),
        syncedFiles: () => Promise.resolve(SYNCED),
        logContents: () => Promise.resolve({ 'npm-test.log': vitest }),
      }
    )
    expect(run.code).toBe(1)
    expect(run.stdout).toContain('700 passed')
  })
})

describe('lint-draft --issue', () => {
  const ISSUE = (name: string): string =>
    `# chore: x\n\n## Why\n\nx\n\n## Acceptance criteria\n\n- [ ] \`test/a.test.ts > "${name}"\`\n- [ ] \`npm run check\` exits 0.\n\n## Out of scope\n\nnothing\n`
  const SOURCE = `describe('run-canary.sh', () => {\n  it('fails the apostrophe isn\\'t', () => {})\n  it.each([[1], [2]])('passes %s', () => {})\n  it.skip('skipped one', () => {})\n  test("quoted \\u2019", () => {})\n})\n`
  const run = (issue: string, sources: Record<string, string>) =>
    lintDraft(section('Nothing'), { ...context([]), issue, testSources: sources })

  it('fails a named test whose title differs from the criterion by one character', () => {
    const problems = run(ISSUE('fails the apostrophe isn’t'), { 'test/a.test.ts': SOURCE })
    expect(problems).toHaveLength(1)
    expect(problems[0]?.problem).toContain('no test of test/a.test.ts has the title')
    expect(problems[0]?.problem).toContain('fails the apostrophe isn’t')
    expect(problems[0]?.line).toContain('[ ] `test/a.test.ts')
  })

  it('fails a named test whose name is its describe and title joined', () => {
    const problems = run(ISSUE("run-canary.sh fails the apostrophe isn't"), {
      'test/a.test.ts': SOURCE,
    })
    expect(problems).toHaveLength(1)
    expect(problems[0]?.problem).toContain('no test of test/a.test.ts')
  })

  it('fails a named test whose file does not exist', () => {
    const problems = run(ISSUE('anything'), {})
    expect(problems).toHaveLength(1)
    expect(problems[0]?.problem).toContain('test file test/a.test.ts')
    expect(problems[0]?.problem).toContain('does not exist')
  })

  it('passes a named test whose title equals the criterion byte for byte', () => {
    const sources = { 'test/a.test.ts': SOURCE }
    expect(run(ISSUE("fails the apostrophe isn't"), sources)).toEqual([])
    expect(run(ISSUE('passes %s'), sources)).toEqual([])
    expect(run(ISSUE('quoted ’'), sources)).toEqual([])
    // the same file with a name that is not a title: the rule is on, so it fails
    expect(run(ISSUE('passes'), sources)).toHaveLength(1)
  })

  it('does not read a skipped test, and leaves the issue alone without --issue', () => {
    expect(run(ISSUE('skipped one'), { 'test/a.test.ts': SOURCE })).toHaveLength(1)
    expect(lintDraft(section('Nothing'), context([]))).toEqual([])
  })

  it('reads the issue file and the test files through --issue', async () => {
    const dir = tempDir('lint-draft-issue-')
    mkdirSync(join(dir, 'test'))
    await writeFile(join(dir, 'test/a.test.ts'), SOURCE)
    await writeFile(join(dir, 'issue.md'), ISSUE('passes %s'))
    await writeFile(join(dir, 'bad.md'), ISSUE('missing'))
    const make = (): LintDraftDeps => ({
      ...createDeps(dir),
      readText: (path) => readFile(path, 'utf8'),
      diffNames: () => Promise.resolve([]),
      syncedFiles: () => Promise.resolve(SYNCED),
      editedTests: () => Promise.resolve([]),
      checkCommand: () => Promise.resolve(null),
      home: () => Promise.resolve(false),
    })
    await writeFile(join(dir, 'd.md'), section('Nothing'))
    const argv = (issue: string): string[] => [
      'lint-draft',
      '--file',
      join(dir, 'd.md'),
      '--base',
      'x',
      '--issue',
      join(dir, issue),
    ]
    expect((await runLintDraft(argv('issue.md'), make())).code).toBe(0)
    const bad = await runLintDraft(argv('bad.md'), make())
    expect(bad.code).toBe(1)
    expect(bad.stdout).toContain('no test of test/a.test.ts')
  })
})
