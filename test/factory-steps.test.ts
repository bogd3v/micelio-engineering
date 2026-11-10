import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = fileURLToPath(new URL('../', import.meta.url))

const AGENTS = 'template/.claude/agents/'
const SKILLS = 'template/.claude/skills/'

/**
 * The words the factory's steps share, each with the files that state it today.
 * A step that changes in one of these files and not in the others fails here, instead
 * of reaching the reviewer. A new shared term is added to this table (planner, step 3).
 */
const STEPS: Record<string, string[]> = {
  'logs/': [
    `${AGENTS}master.md`,
    `${AGENTS}verifier.md`,
    `${AGENTS}worker.md`,
    `${SKILLS}ship-pr/SKILL.md`,
    `${SKILLS}verify-pr/SKILL.md`,
    'herdr/master.md',
    'docs/factory.md',
  ],
  'decisions.md': [
    `${AGENTS}master.md`,
    `${AGENTS}reviewer.md`,
    `${AGENTS}worker.md`,
    `${SKILLS}blind-review/SKILL.md`,
    `${SKILLS}verify-pr/SKILL.md`,
    'herdr/master.md',
    'docs/factory.md',
  ],
  'factory-log |': [
    `${AGENTS}master.md`,
    `${SKILLS}ship-pr/SKILL.md`,
    'herdr/master.md',
    'docs/factory.md',
  ],
  'time:': [
    `${AGENTS}planner.md`,
    `${SKILLS}ship-pr/SKILL.md`,
    'herdr/master.md',
    'docs/factory.md',
  ],
  'whatever K is, 0 and 1 included': [`${SKILLS}verify-pr/SKILL.md`],
  'the check command': [
    `${AGENTS}verifier.md`,
    `${AGENTS}worker.md`,
    `${SKILLS}ship-pr/SKILL.md`,
    `${SKILLS}verify-pr/SKILL.md`,
    '.github/pull_request_template.md',
    'herdr/master.md',
    'docs/factory.md',
    'template/.claude/TEAM.md',
  ],
  'factory-slot.sh': [
    `${AGENTS}master.md`,
    `${AGENTS}verifier.md`,
    `${AGENTS}worker.md`,
    'herdr/master.md',
    'docs/factory.md',
  ],
  'production or staging': [
    `${AGENTS}master.md`,
    `${AGENTS}planner.md`,
    `${AGENTS}reviewer.md`,
    `${AGENTS}verifier.md`,
    `${AGENTS}worker.md`,
    `${SKILLS}verify-pr/SKILL.md`,
    'template/.claude/TEAM.md',
  ],
}

/** One line per listed file that does not contain its term, naming the file. */
function missingTerms(read: (path: string) => string): string[] {
  return Object.entries(STEPS).flatMap(([term, files]) =>
    files
      .filter((file) => !read(file).includes(term))
      .map((file) => `${file} does not name "${term}"`)
  )
}

const readRepo = (path: string): string => readFileSync(join(ROOT, path), 'utf8')

describe("the terms the factory's steps share", () => {
  it('every file listed for a factory step names its term', () => {
    expect(missingTerms(readRepo)).toEqual([])
  })

  it('every file that states the check command uses the same term', () => {
    const files = STEPS['the check command'] ?? []
    expect(files.length).toBeGreaterThan(0)
    // a file that spells the command another way names the npm script instead of the term
    const other = files.filter((file) => /npm (run )?check|\bnpm ci\b/.test(readRepo(file)))
    expect(other).toEqual([])
    for (const file of files) expect(readRepo(file), file).toContain('the check command')
  })

  it('a listed file that drops the term fails and names the file', () => {
    const dropped = 'template/.claude/skills/ship-pr/SKILL.md'
    const read = (path: string): string =>
      path === dropped ? readRepo(path).replaceAll('factory-log |', 'factory log') : readRepo(path)
    const missing = missingTerms(read)
    expect(missing).toEqual([`${dropped} does not name "factory-log |"`])
  })
})
