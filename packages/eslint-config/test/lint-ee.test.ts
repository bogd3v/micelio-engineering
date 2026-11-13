import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { tempDir } from '../../../test/support/temp.js'
import { lintEe } from '../src/ee.js'

const BIN = fileURLToPath(new URL('../dist/lint-ee.js', import.meta.url))

/** A git repository holding `files`, all tracked. */
function repo(files: Record<string, string>): string {
  const dir = tempDir('micelio-ee-')
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true })
    writeFileSync(join(dir, path), text)
  }
  execFileSync('git', ['init', '-q'], { cwd: dir })
  execFileSync('git', ['add', '.'], { cwd: dir })
  return dir
}

/** Runs the built bin. */
function run(dir: string, ...args: string[]) {
  return spawnSync('node', [BIN, ...args, dir], { encoding: 'utf8' })
}

describe('micelio-lint-ee', () => {
  it('fails on an import under ee/, on an Enterprise package and on STRAPI_LICENSE', () => {
    const dir = repo({
      'src/a.ts': "import x from '@strapi/admin/ee/server'\n",
      'src/b.js': "const w = require('@strapi/review-workflows')\n",
      'src/c.ts': "import r from '@strapi/content-releases/dist'\n",
      '.env.example': 'STRAPI_LICENSE=abc\n',
      'config/d.yml': 'a: 1\nkey: ${STRAPI_LICENSE}\n',
    })
    const result = run(dir)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('src/a.ts:1 imports Strapi code under ee/')
    expect(result.stderr).toContain('src/b.js:1 imports a Strapi Enterprise package')
    expect(result.stderr).toContain('src/c.ts:1 imports a Strapi Enterprise package')
    expect(result.stderr).toContain('.env.example:1 sets or reads STRAPI_LICENSE')
    expect(result.stderr).toContain('config/d.yml:2 sets or reads STRAPI_LICENSE')
    expect(result.stderr).toContain('Strapi Enterprise code must stay disabled')
  })

  it('passes on a repository with none', () => {
    const dir = repo({
      'src/a.ts': "import x from '@strapi/strapi'\nimport y from '@strapi/admin/server'\n",
      'README.md': 'STRAPI_LICENSE is named in prose, which is not scanned\n',
    })
    const result = run(dir)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('No Strapi Enterprise code enabled (1 files checked).')
  })

  it('skips the files named by --allow and files git does not track', () => {
    const dir = repo({
      'THIRD-PARTY.json': '{"note": "STRAPI_LICENSE"}\n',
      'src/a.ts': 'export {}\n',
    })
    writeFileSync(join(dir, 'untracked.ts'), 'STRAPI_LICENSE\n')
    expect(run(dir).status).toBe(1)
    expect(run(dir, '--allow', 'THIRD-PARTY.json').status).toBe(0)
    expect(lintEe(dir, ['THIRD-PARTY.json']).checked).toBe(1)
  })

  it('exits 2 when --allow has no path', () => {
    const dir = repo({ 'a.ts': 'export {}\n' })
    const result = spawnSync('node', [BIN, dir, '--allow'], { encoding: 'utf8' })
    expect(result.status).toBe(2)
  })
})
