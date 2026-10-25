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
})
