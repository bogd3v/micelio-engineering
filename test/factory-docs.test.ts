import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = fileURLToPath(new URL('../', import.meta.url))

const read = (path: string): string => readFileSync(join(ROOT, path), 'utf8')

/** Words as `wc -w` counts them: runs of non-whitespace. */
const words = (text: string): number => text.split(/\s+/).filter(Boolean).length

/** A rule id of `docs/factory.md`: a gate and its number (`G2.4`), or the id of another section (`L.3`). */
const RULE_ID = /\b(?:G\d|[PRLMBSCK])\.\d+\b/g

/** The ids `docs/factory.md` defines: each rule is a list item that starts with its id in backticks. */
function definedIds(): Set<string> {
  const ids = [...read('docs/factory.md').matchAll(/^- `([A-Z][0-9]?\.\d+)`/gm)].map(
    (match) => match[1] ?? ''
  )
  return new Set(ids)
}

/** The files that cite a rule id: the prompts, the skills and the runbook, and their root copies. */
function citingFiles(): string[] {
  const dirs = ['template/.claude/agents', '.claude/agents']
  const skills = ['template/.claude/skills', '.claude/skills']
  const agents = dirs.flatMap((dir) => readdirSync(join(ROOT, dir)).map((name) => `${dir}/${name}`))
  const skillFiles = skills.flatMap((dir) =>
    readdirSync(join(ROOT, dir)).map((name) => `${dir}/${name}/SKILL.md`)
  )
  return [...agents, ...skillFiles, 'herdr/master.md']
}

/** Every `file: id` a file cites that `defined` does not hold. */
function unknownCitations(
  files: string[],
  readFile: (path: string) => string,
  defined: Set<string>
): string[] {
  return files.flatMap((file) =>
    (readFile(file).match(RULE_ID) ?? [])
      .filter((id) => !defined.has(id))
      .map((id) => `${file}: ${id}`)
  )
}

describe('the factory documents', () => {
  it('docs/factory.md has at most 5805 words and herdr/master.md at most 3807', () => {
    expect(words(read('docs/factory.md'))).toBeLessThanOrEqual(5805)
    expect(words(read('herdr/master.md'))).toBeLessThanOrEqual(3807)
  })

  it('every rule id cited outside docs/factory.md exists in it', () => {
    const defined = definedIds()
    expect(defined.size).toBeGreaterThan(40)
    const files = citingFiles()
    expect(files.length).toBeGreaterThan(0)
    expect(unknownCitations(files, read, defined)).toEqual([])
    // the prompts of the roles that restate a gate and the runbook do cite ids
    for (const file of [
      'template/.claude/agents/master.md',
      'template/.claude/agents/reviewer.md',
      'herdr/master.md',
    ]) {
      expect(read(file).match(RULE_ID)?.length ?? 0, file).toBeGreaterThan(0)
    }
  })

  it('a cited id that docs/factory.md does not define is reported with its file', () => {
    const read2 = (path: string): string => (path === 'x.md' ? 'see `G9.9` and `G2.1`' : '')
    expect(unknownCitations(['x.md'], read2, new Set(['G2.1']))).toEqual(['x.md: G9.9'])
  })
})
