import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { tempDir } from '../../../test/support/temp.js'
import { createDocsHitsDeps, removedTerms, runDocsHits } from '../src/docs-hits.js'

/** A repository with one commit; `files` are the paths and texts of it. */
async function repository(files: Record<string, string>): Promise<string> {
  const repo = tempDir('docs-hits-')
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(repo, path, '..'), { recursive: true })
    await writeFile(join(repo, path), text)
  }
  git(repo, 'init', '-q')
  git(repo, 'add', '.')
  git(repo, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'x')
  return repo
}

const git = (repo: string, ...args: string[]): string =>
  execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' })

const hits = (repo: string, ...extra: string[]): ReturnType<typeof runDocsHits> => {
  git(repo, 'add', '-N', '.')
  return runDocsHits(['docs-hits', '--base', 'HEAD', ...extra], createDocsHitsDeps(repo))
}

describe('docs-hits', () => {
  it('a term the diff removes from code and an untouched document still names is a hit', async () => {
    const repo = await repository({
      'src/populate.ts': "export const PAGE = { sections: ['shared.playground'] }\n",
      'docs/islands.md': 'intro\n\nA page draft keeps its `shared.playground` sections.\n',
    })
    await writeFile(join(repo, 'src/populate.ts'), 'export const PAGE = { sections: [] }\n')
    const result = await hits(repo)
    expect(result.code).toBe(1)
    expect(result.stdout).toContain('docs/islands.md:3: shared.playground\n')
    expect(result.stdout).toContain('1 hit(s)')
  })

  it('a term whose document the diff touches is not a hit', async () => {
    const repo = await repository({
      'src/populate.ts': "export const PAGE = ['shared.playground']\n",
      'docs/islands.md': 'It keeps `shared.playground`.\n',
      'docs/other.md': 'Elsewhere: nothing.\n',
    })
    await writeFile(join(repo, 'src/populate.ts'), 'export const PAGE = []\n')
    await writeFile(join(repo, 'docs/islands.md'), 'It keeps `shared.playground` no more.\n')
    await writeFile(join(repo, 'docs/new.md'), 'The `shared.playground` is gone.\n')
    const result = await hits(repo)
    expect(result).toMatchObject({ code: 0 })
    expect(result.stdout).toBe('docs-hits · base HEAD · no hit\n')
  })

  it('a term the diff also adds back is still a hit', async () => {
    const repo = await repository({
      'src/populate.ts': "export const PAGE = ['shared.playground']\n",
      'docs/islands.md': 'It keeps `shared.playground`.\n',
    })
    await writeFile(
      join(repo, 'src/populate.ts'),
      '/** The `shared.playground` section is gone. */\nexport const PAGE = []\n'
    )
    const result = await hits(repo)
    expect(result.code).toBe(1)
    expect(result.stdout).toContain('docs/islands.md:1: shared.playground\n')
  })

  it('words without a joiner, short tokens and test files give no terms', () => {
    const diff = [
      'diff --git a/src/a.ts b/src/a.ts',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -1,3 +0,0 @@',
      '-const playground = populate_all + a.b + x-y + 1.2.3.4 + "plain words here"',
      '-DRAFT_PAGE_POPULATE and config.preview-token',
      'diff --git a/test/a.test.ts b/test/a.test.ts',
      '--- a/test/a.test.ts',
      '+++ b/test/a.test.ts',
      '@@ -1 +0,0 @@',
      '-shared.playground',
      'diff --git a/docs/a.md b/docs/a.md',
      '--- a/docs/a.md',
      '+++ b/docs/a.md',
      '@@ -1 +0,0 @@',
      '-the docs.removed-term',
      '',
    ].join('\n')
    expect(removedTerms(diff)).toEqual(['config.preview-token', 'DRAFT_PAGE_POPULATE'])
  })

  it('a hit answered in For review is not listed', async () => {
    const repo = await repository({
      'src/populate.ts': "export const PAGE = ['shared.playground', 'meta.actor']\n",
      'docs/islands.md': 'It keeps `shared.playground`.\n',
      'docs/other.md': 'The meta.actor is read.\n',
    })
    await writeFile(join(repo, 'src/populate.ts'), 'export const PAGE = []\n')
    const draft = join(tempDir('docs-hits-draft-'), 'draft.md')
    await writeFile(
      draft,
      '## For review\n\n- docs-hits: docs/islands.md - the page draft still keeps it\n\n## Tests\n\ndocs-hits: docs/other.md - not in For review\n'
    )
    const result = await hits(repo, '--draft', draft)
    expect(result.code).toBe(1)
    expect(result.stdout).not.toContain('docs/islands.md')
    expect(result.stdout).toContain('docs/other.md:1: meta.actor\n')
  })

  it('exits 1 with hits, 0 without and 2 on a usage error', async () => {
    const repo = await repository({
      'src/a.ts': "export const A = 'shared.playground'\n",
      'docs/a.md': 'shared.playground\n',
    })
    expect((await hits(repo)).code).toBe(0)
    await writeFile(join(repo, 'src/a.ts'), 'export const A = 1\n')
    expect((await hits(repo)).code).toBe(1)
    const usage = await runDocsHits(['docs-hits'])
    expect(usage.code).toBe(2)
    expect(usage.stderr).toContain('needs --base')
    expect((await runDocsHits(['docs-hits', '--base'])).code).toBe(2)
    expect((await runDocsHits(['docs-hits', '--base', 'HEAD', '--bogus', 'x'])).code).toBe(2)
    const bad = await runDocsHits(['docs-hits', '--base', 'nope-rev', '--cwd', repo])
    expect(bad.code).toBe(2)
  })

  it('a term inside a longer word is not a hit', async () => {
    const repo = await repository({
      'src/a.ts': "export const A = 'PAGE_POPULATE'\n",
      'docs/a.md': 'The DRAFT_PAGE_POPULATE constant and PAGE_POPULATED stay.\nPAGE_POPULATE.\n',
    })
    await writeFile(join(repo, 'src/a.ts'), 'export const A = 1\n')
    const result = await hits(repo)
    expect(result.stdout).toContain('docs/a.md:2: PAGE_POPULATE\n')
    expect(result.stdout).not.toContain('docs/a.md:1')
  })

  it('runs as the bin', async () => {
    const repo = await repository({
      'src/a.ts': "export const A = 'shared.playground'\n",
      'docs/a.md': 'shared.playground\n',
    })
    await writeFile(join(repo, 'src/a.ts'), 'export const A = 1\n')
    const bin = fileURLToPath(new URL('../dist/cli.js', import.meta.url))
    const result = spawnSync('node', [bin, 'docs-hits', '--base', 'HEAD', '--cwd', repo], {
      encoding: 'utf8',
    })
    expect(result.status).toBe(1)
    expect(result.stdout).toContain('docs/a.md:1: shared.playground\n')
  })

  it('a base that looks like an option reads nothing and writes nothing', async () => {
    const repo = await repository({ 'src/a.ts': 'export const A = 1\n' })
    const out = join(repo, 'written.txt')
    const result = await runDocsHits(
      ['docs-hits', '--base', `--output=${out}`],
      createDocsHitsDeps(repo)
    )
    expect(result.code).toBe(2)
    expect(existsSync(out)).toBe(false)
  })
})
