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

  it('a reindented line gives no term', async () => {
    const repo = await repository({
      'src/cli.ts': "const x = a\n  ? 1\n  : argv[0] === 'project-fields-backfill'\n",
      'docs/a.md':
        "It runs `argv[0] === 'project-fields-backfill'`.\nAnd project-fields-backfill too.\n",
    })
    await writeFile(
      join(repo, 'src/cli.ts'),
      "const x = a\n  ? 1\n    : argv[0] === 'project-fields-backfill'\n"
    )
    const result = await hits(repo)
    expect(result.code).toBe(0)
    expect(result.stdout).toBe('docs-hits · base HEAD · no hit\n')
  })

  it('a file marked linguist-generated gives no term', async () => {
    const files = {
      'out/hashes.json': '{ "shared.playground": "1" }\n',
      'docs/a.md': 'It keeps `shared.playground`.\n',
    }
    const marked = await repository(files)
    await writeFile(join(marked, '.gitattributes'), 'out/hashes.json linguist-generated=true\n')
    await writeFile(join(marked, 'out/hashes.json'), '{}\n')
    expect(await hits(marked)).toMatchObject({ code: 0 })
    const plain = await repository(files)
    await writeFile(join(plain, 'out/hashes.json'), '{}\n')
    const result = await hits(plain)
    expect(result.code).toBe(1)
    expect(result.stdout).toContain('docs/a.md:1: shared.playground\n')
  })

  it('a capitals term starts at a word boundary', () => {
    const diff = [
      'diff --git a/src/a.ts b/src/a.ts',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -1 +0,0 @@',
      '-fooBAR_BAZ and QUX_QUUX',
      '',
    ].join('\n')
    expect(removedTerms(diff)).toEqual(['QUX_QUUX'])
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

  it('a document that names a changed file by its path is a hit', async () => {
    const repo = await repository({
      'src/view.ts': '// View.\nexport const A = 1\n',
      'docs/a.md':
        'Nothing here.\nIt is `src/view.ts` that renders.\nAnd ../src/view.ts too.\nNot xsrc/view.ts.\n',
      'src/README.md': 'See view.ts here and ./view.ts there.\n',
    })
    await writeFile(join(repo, 'src/view.ts'), '// View.\nexport const A = 2\n')
    const result = await hits(repo)
    expect(result.code).toBe(1)
    expect(result.stdout).toContain('docs/a.md:2: names src/view.ts\n')
    expect(result.stdout).toContain('docs/a.md:3: names src/view.ts\n')
    expect(result.stdout).not.toContain('docs/a.md:4')
    expect(result.stdout).toContain('src/README.md:1: names src/view.ts\n')
    expect(result.stdout).toContain('src/view.ts:1: header comment\n')
    expect(result.stdout).toContain('4 hit(s)')
  })

  it('a document the diff touches that names a changed file is a hit', async () => {
    const repo = await repository({
      'src/view.ts': '// View.\nexport const A = 1\n',
      'README.md': 'It runs src/view.ts.\n',
    })
    await writeFile(join(repo, 'src/view.ts'), '// View.\nexport const A = 2\n')
    await writeFile(join(repo, 'README.md'), 'It runs src/view.ts, edited.\n')
    const result = await hits(repo)
    expect(result.code).toBe(1)
    expect(result.stdout).toContain('README.md:1: names src/view.ts\n')
  })

  it('the header comment of a changed file the diff leaves alone is a hit', async () => {
    const source = '#!/bin/sh\n\n/** Reads\n * nothing.\n */\n\nexport const A = 1\n'
    const repo = await repository({ 'src/view.ts': source })
    await writeFile(join(repo, 'src/view.ts'), source.replace('= 1', '= 2'))
    const result = await hits(repo)
    expect(result.code).toBe(1)
    expect(result.stdout).toContain('src/view.ts:3: header comment\n')
    const edited = await repository({ 'src/view.ts': source })
    await writeFile(join(edited, 'src/view.ts'), source.replace('nothing', 'a file'))
    expect(await hits(edited)).toMatchObject({ code: 0 })
    const bare = await repository({ 'src/view.ts': 'export const A = 1\n' })
    await writeFile(join(bare, 'src/view.ts'), 'export const A = 2\n')
    expect(await hits(bare)).toMatchObject({ code: 0 })
  })

  it('one answer in For review answers a changed file and its header comment', async () => {
    const repo = await repository({
      'src/view.ts': '// View.\nexport const A = 1\n',
      'docs/a.md': 'It is `src/view.ts`.\n',
    })
    await writeFile(join(repo, 'src/view.ts'), '// View.\nexport const A = 2\n')
    const answer = async (...paths: string[]): ReturnType<typeof runDocsHits> => {
      const draft = join(tempDir('docs-hits-draft-'), 'draft.md')
      const lines = paths.map((path) => `- docs-hits: ${path} - still true\n`).join('')
      await writeFile(draft, `## For review\n\n${lines}`)
      return hits(repo, '--draft', draft)
    }
    const before = await hits(repo)
    expect(before.stdout).toContain('src/view.ts:1: header comment\n')
    expect(before.stdout).toContain('docs/a.md:1: names src/view.ts\n')
    expect(before.stdout).toContain('2 hit(s)')
    const file = await answer('src/view.ts')
    expect(file.stdout).not.toContain('header comment')
    expect(file.stdout).toContain('docs/a.md:1: names src/view.ts\n')
    const document = await answer('docs/a.md')
    expect(document.stdout).toContain('src/view.ts:1: header comment\n')
    expect(document.stdout).not.toContain('names')
    expect(await answer('src/view.ts', 'docs/a.md')).toMatchObject({
      code: 0,
      stdout: 'docs-hits · base HEAD · no hit\n',
    })
  })
})
