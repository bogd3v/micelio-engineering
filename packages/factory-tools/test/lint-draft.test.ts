import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { tempDir } from '../../../test/support/temp.js'
import { createDeps, lintDraft, runLintDraft } from '../src/lint-draft.js'
import type { DraftContext, LintDraftDeps } from '../src/lint-draft.js'

const SYNCED = ['.claude/agents', '.claude/skills/ship-pr', 'CLAUDE.md']

const section = (...lines: string[]): string =>
  `# feat: x\n\n## Tests\n\nfine\n\n## Instructions that were wrong or missing\n\n${lines.join('\n')}\n\n## What could not be verified\n\nNothing\n`

const context = (changed: string[]): DraftContext => ({ changed, synced: SYNCED })

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

  it('does not look inside docker run, xargs or sh -c: the documented limits', () => {
    for (const line of [
      'docker run --rm node:22 wc -w a.md',
      'ls | xargs wc -w',
      "sh -c 'wc -w a.md'",
      'sh -c "wc -w a.md"',
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
