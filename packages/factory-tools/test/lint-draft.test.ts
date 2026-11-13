import { execFileSync } from 'node:child_process'
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
