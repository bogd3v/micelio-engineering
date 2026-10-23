import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { lintStandard, readPin } from '../packages/eslint-config/src/standard.js'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const SCRIPT = join(ROOT, 'scripts/template.mjs')
const REF = 'a'.repeat(40)

interface Entry {
  box: string
  files?: string[]
  setting?: string
}

const CHECKLIST = JSON.parse(
  readFileSync(join(ROOT, 'scripts/template-checklist.json'), 'utf8')
) as Entry[]

/** The boxes of section 14 that every repository needs: the list above "A plugin repository". */
function sectionFourteenBoxes(): string[] {
  const standard = readFileSync(join(ROOT, 'docs/engineering-standard.md'), 'utf8')
  const section = standard.split('## 14. Starting a new repository')[1]?.split('## 15.')[0] ?? ''
  const general = section.split('A plugin repository also needs')[0] ?? ''
  return [...general.matchAll(/^- \[ \] (.+)$/gm)].map((match) => match[1] as string)
}

/** Runs `npm run template` the way a person does, without the install step. */
function generate(target: string, ...extra: string[]) {
  return spawnSync('node', [SCRIPT, target, '--no-install', '--ref', REF, ...extra], {
    encoding: 'utf8',
  })
}

/** Every file below `directory` as paths relative to it. */
function filesOf(directory: string, prefix = ''): string[] {
  return readdirSync(join(directory, prefix), { withFileTypes: true }).flatMap((entry) => {
    const path = join(prefix, entry.name)
    return entry.isDirectory() ? filesOf(directory, path) : [path]
  })
}

describe('the repository template', () => {
  let project: string
  let created: string[]

  beforeAll(() => {
    project = join(mkdtempSync(join(tmpdir(), 'template-test-')), 'micelio-example')
    const result = generate(project, '--description', 'An example project.')
    if (result.status !== 0) throw new Error(result.stderr)
    created = filesOf(project)
  })

  it('ticks every box of section 14 with a file or an organisation setting', () => {
    const boxes = sectionFourteenBoxes()
    expect(boxes).toHaveLength(10)
    expect(CHECKLIST.map((entry) => entry.box)).toEqual(boxes)
    for (const entry of CHECKLIST) {
      expect(entry.files?.length || entry.setting, entry.box).toBeTruthy()
      for (const file of entry.files ?? []) {
        expect(created, `${file} (${entry.box})`).toContain(file)
      }
      if (entry.setting) expect(entry.setting).toMatch(/#2/)
    }
  })

  it('has the scripts that section 14 names', () => {
    const box = CHECKLIST.find((entry) => entry.box.startsWith('The scripts'))?.box ?? ''
    const names = [...box.matchAll(/`([a-z:]+)`/g)].map((match) => match[1] as string)
    expect(names).toContain('lint:standard')
    const pkg = JSON.parse(readFileSync(join(project, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>
    }
    for (const name of names) expect(pkg.scripts, name).toHaveProperty(name)
    // check runs the fast checks of section 15 in the order CI does
    expect(pkg.scripts.check).toBe(
      'npm run typecheck && npm run lint && npm run format:check && npm run test && npm run lint:licenses && npm run lint:standard'
    )
  })

  it('leaves no placeholder behind and fills the repository name', () => {
    for (const file of created) {
      const text = readFileSync(join(project, file), 'utf8')
      expect(text, file).not.toMatch(/\{\{[a-z-]+\}\}/)
    }
    const pkg = JSON.parse(readFileSync(join(project, 'package.json'), 'utf8')) as {
      name: string
      version: string
      description: string
      devDependencies: Record<string, string>
    }
    expect(pkg.name).toBe('micelio-example')
    expect(pkg.version).toBe('0.1.0')
    expect(pkg.description).toBe('An example project.')
    expect(Object.keys(pkg.devDependencies).filter((name) => name.startsWith('@micelio/'))).toEqual(
      ['@micelio/eslint-config', '@micelio/prettier-config', '@micelio/tsconfig']
    )
    expect(readFileSync(join(project, 'README.md'), 'utf8')).toContain('# Micelio Example')
  })

  it('pins the standard it carries, and lint:standard accepts it', () => {
    const standard = readFileSync(join(project, 'docs/engineering-standard.md'), 'utf8')
    const version = /^Version (\d+\.\d+) /m.exec(standard)?.[1]
    expect(readPin(readFileSync(join(project, 'AGENTS.md'), 'utf8'))).toBe(version)
    expect(lintStandard(project)).toMatchObject({ ok: true })
    expect(standard).toBe(readFileSync(join(ROOT, 'docs/engineering-standard.md'), 'utf8'))
  })

  it('calls the reusable workflows at one commit, with the branch in a comment', () => {
    const calls: string[] = []
    for (const file of created.filter((path) => path.startsWith('.github/workflows/'))) {
      const text = readFileSync(join(project, file), 'utf8')
      const matches = text.matchAll(/uses: bogd3v\/micelio-engineering\/.*$/gm)
      calls.push(...Array.from(matches, (match) => match[0]))
    }
    const called = calls.map((call) => /workflows\/(\w+)\.yml@(\w+) # main$/.exec(call))
    expect(called.map((match) => match?.[1]).sort()).toEqual([
      'check',
      'dco',
      'release',
      'scorecard',
    ])
    for (const match of called) expect(match?.[2]).toBe(REF)
  })

  it('defines every label its workflows and issue templates use', () => {
    const read = (path: string) => readFileSync(join(project, path), 'utf8')
    const defined = JSON.parse(read('.github/labels.json')) as {
      name: string
      color: string
      description: string
    }[]
    const names = defined.map((label) => label.name)
    expect(new Set(names).size).toBe(names.length)
    for (const label of defined) {
      expect(label.color).toMatch(/^[0-9a-f]{6}$/)
      expect(label.description.length).toBeGreaterThan(0)
    }

    const workflow = read('.github/workflows/pr-labels.yml')
    const added = Array.from(
      workflow.matchAll(/labels=(?:"\$\{labels:\+\$labels,\})?([a-z/-]+)"?/g),
      (match) => match[1] as string
    )
    const notes = Array.from(
      read('.github/release.yml').matchAll(/^\s+- (?!title:)([^'*\s]+)$/gm),
      (match) => (match[1] as string).trim()
    )
    const issues = created
      .filter((path) => path.startsWith('.github/ISSUE_TEMPLATE/') && !path.endsWith('config.yml'))
      .flatMap((path) => {
        const line = /^labels: (.+)$/m.exec(read(path))?.[1] ?? ''
        return Array.from(line.matchAll(/[^\s'",[\]]+/g), (match) => match[0])
      })
    expect(added).toEqual(expect.arrayContaining(['enhancement', 'code-quality', 'breaking']))
    expect(notes).toEqual(expect.arrayContaining(['ignore-for-release', 'breaking', 'seo']))
    expect(issues).toEqual(expect.arrayContaining(['bug', 'épica']))
    for (const label of [...added, ...notes, ...issues]) expect(names).toContain(label)
  })

  it('keeps one copy of the licence check and of the standard: the ones of this repository', () => {
    expect(readFileSync(join(project, 'scripts/check-licenses.mjs'), 'utf8')).toBe(
      readFileSync(join(ROOT, 'scripts/check-licenses.mjs'), 'utf8')
    )
    expect(existsSync(join(ROOT, 'template/docs'))).toBe(false)
    expect(existsSync(join(ROOT, 'template/scripts/check-licenses.mjs'))).toBe(false)
  })

  it('keeps CONTRIBUTING.md short, as section 1 asks', () => {
    const lines = readFileSync(join(project, 'CONTRIBUTING.md'), 'utf8').trimEnd().split('\n')
    expect(lines.length).toBeLessThan(40)
  })

  it('only creates a new repository, and rejects names and descriptions it cannot use', () => {
    const occupied = join(mkdtempSync(join(tmpdir(), 'template-test-')), 'taken')
    mkdirSync(occupied)
    writeFileSync(join(occupied, 'README.md'), 'mine')
    expect(generate(occupied)).toMatchObject({ status: 1 })
    expect(generate(occupied).stderr).toContain('not empty')
    expect(readFileSync(join(occupied, 'README.md'), 'utf8')).toBe('mine')

    const parent = mkdtempSync(join(tmpdir(), 'template-test-'))
    expect(generate(join(parent, 'Bad_Name')).stderr).toContain('not a repository name')
    expect(generate(join(parent, 'ok-name'), '--description', 'say "hi"').stderr).toContain(
      'may not contain'
    )
    expect(existsSync(join(parent, 'ok-name'))).toBe(false)
  })
})
