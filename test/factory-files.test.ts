import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const SYNCED = (
  JSON.parse(readFileSync(join(ROOT, '.github/standard-sync.json'), 'utf8')) as { files: string[] }
).files

/** Every file at `path` (a file or a directory) relative to `base`, or none when it does not exist. */
function filesAt(base: string, path: string): string[] {
  const full = join(base, path)
  let stats
  try {
    stats = statSync(full)
  } catch {
    return []
  }
  if (!stats.isDirectory()) return [path]
  return readdirSync(full)
    .sort()
    .flatMap((name) => filesAt(base, join(path, name)))
}

describe("this repository's own factory files", () => {
  const template = join(ROOT, 'template')

  it('holds a byte-identical copy of every synced file that template/ has', () => {
    for (const path of SYNCED) {
      expect(filesAt(template, path).length, `${path} is missing from template/`).toBeGreaterThan(0)
    }
    expect(SYNCED).toContain('.claude/skills/ship-pr')
    expect(SYNCED).not.toContain('.claude/skills')
    const expected = SYNCED.flatMap((path) => filesAt(template, path))
    expect(expected.length).toBeGreaterThan(0)
    for (const file of expected) {
      expect(readFileSync(join(ROOT, file)).equals(readFileSync(join(template, file))), file).toBe(
        true
      )
    }
  })

  it('holds no synced file that template/ lacks', () => {
    for (const path of SYNCED) {
      const own = filesAt(ROOT, path)
      const source = filesAt(template, path)
      expect(own, path).toEqual(source)
    }
  })
})

describe('CLAUDE.md', () => {
  it('does not import the engineering standard', () => {
    const imports = readFileSync(join(ROOT, 'template/CLAUDE.md'), 'utf8')
      .split('\n')
      .filter((line) => line.startsWith('@'))
    expect(imports.filter((line) => line.includes('engineering-standard.md'))).toEqual([])
  })
})

describe('the factory roles', () => {
  const agents = join(ROOT, 'template/.claude/agents')
  const skills = [
    ...new Set([
      ...readdirSync(join(ROOT, 'template/.claude/skills')),
      ...readdirSync(join(ROOT, '.claude/skills')),
    ]),
  ]
  const runbook = readFileSync(join(ROOT, 'herdr/master.md'), 'utf8')

  it.each(readdirSync(agents).map((file) => file.replace(/\.md$/, '')))(
    '%s has the Skill tool when its prompt or its runbook prompt names a skill',
    (name) => {
      const prompt = readFileSync(join(agents, `${name}.md`), 'utf8')
      const prompted = runbook
        .split('\n')
        .filter((line) => line.includes(`herdr agent prompt ${name}-`))
        .join('\n')
      const named = skills.filter((skill) =>
        new RegExp(`\`${skill}\`|${skill} skill`).test(`${prompt}\n${prompted}`)
      )
      const tools = /^tools: (.*)$/m.exec(prompt)?.[1]?.split(', ') ?? []
      if (named.length > 0) expect(tools, named.join(', ')).toContain('Skill')
    }
  )

  it("the runbook gives a later reviewer the previous diff without an earlier round's directory", () => {
    const lines = runbook.split('\n')
    const prompts = lines.filter((line) => line.includes('herdr agent prompt '))
    const later = lines.filter((line) => line.startsWith('From round 2, add:'))
    expect(later).toHaveLength(1)
    expect(later[0]).toContain('<packets>/<N>/r<K>/previous.patch')
    expect(runbook).toMatch(
      /copy round K-1's `diff\.patch` to `<packets>\/<N>\/r<K>\/previous\.patch`/
    )
    expect(runbook).not.toMatch(/r<K-1>|r<K\+1>|r<K>\/(review|verify)\//)
    // a prompt (and the round 2 sentence) names a path of this round or the logs, never another one
    for (const line of [...prompts, ...later]) {
      for (const [, dir] of line.matchAll(/<packets>\/<N>\/([^/\s.]+)/g)) {
        expect(['r<K>', 'logs'], line).toContain(dir)
      }
    }
    expect(prompts.filter((line) => line.includes('reviewer-'))).not.toHaveLength(0)
  })

  it('the runbook writes each report in a directory no prompt names and moves it to archive/', () => {
    const prompts = runbook.split('\n').filter((line) => line.includes('herdr agent prompt '))
    expect(runbook).toMatch(/^uuidgen .*<packets>\/<N>\/reports\/<that id>$/m)
    expect(runbook).toMatch(/^mkdir -p <report dir> /m)
    expect(runbook).toContain(
      'mkdir -p <packets>/<N>/archive && mv <report dir> <packets>/<N>/archive/gate<G>-r<K>'
    )
    expect(runbook).toContain('it is not a sandbox')
    expect(runbook).not.toContain('$out')
    for (const name of ['reviewer', 'verifier']) {
      const line = prompts.find((l) => l.includes(`herdr agent prompt ${name}-`))
      expect(line, name).toContain('Write report.md and summary.md in <report dir>.')
      expect(line, name).not.toMatch(/reports\/|archive\//)
    }
  })
})
