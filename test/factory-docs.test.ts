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
  it('docs/factory.md and herdr/master.md stay under their word caps', () => {
    expect(words(read('docs/factory.md'))).toBeLessThanOrEqual(6360)
    expect(words(read('herdr/master.md'))).toBeLessThanOrEqual(5160)
  })

  it("herdr/master.md has the master write the worktree, packet directory, branch and draft to the issue's Progress before the worker's brief, and check it at gate 5", () => {
    const runbook = read('herdr/master.md')
    const start = runbook.indexOf('## Starting an agent')
    const starting = runbook.slice(start, runbook.indexOf('\n## ', start + 1))
    const item = starting.split('\n').find((line) => line.startsWith('3. '))
    expect(item).toMatch(/Before it sends the worker's brief in round 1/)
    for (const term of [
      'worktree',
      'packet directory',
      'branch',
      'draft',
      '`## Progress`',
      '`M.3`',
    ])
      expect(item, term).toContain(term)
    const brief = starting.split('\n').find((line) => line.startsWith('2. The brief'))
    expect(starting.indexOf(item ?? '')).toBeGreaterThan(starting.indexOf(brief ?? ''))
    const gate5 = runbook.slice(runbook.indexOf('## Gate 5 — delivery'))
    expect(gate5.split('\n').find((l) => l.startsWith('1. '))).toMatch(
      /check that Progress names the worktree, and add it first if not/
    )
    const session = runbook.slice(runbook.indexOf('## Session length'))
    expect(session.split('\n').find((l) => l.startsWith('2. '))).toMatch(
      /checks that the Progress of each issue in flight names its worktree, packet directory and draft path, adds what is missing/
    )
  })

  it('herdr/master.md sets the Status through the REST Projects endpoints: the fields, the item of the issue and its PATCH', () => {
    const runbook = read('herdr/master.md')
    const start = runbook.indexOf('## The Project Status flow')
    const flow = runbook.slice(start, runbook.indexOf('\n## ', start + 1))
    for (const term of [
      '{{project}}',
      '`<owner>/<number>`',
      'gh api "orgs/<owner>/projectsV2/<number>/fields?per_page=100" --jq \'.[] | select(.name == "Status")\'',
      'gh api --paginate "orgs/<owner>/projectsV2/<number>/items?per_page=100" --jq \'.[] | select(.content.html_url == "https://github.com/<owner>/<repo>/issues/<n>") | .id\'',
      'gh api -X PATCH orgs/<owner>/projectsV2/<number>/items/<item id> --input <file>',
      '`{"fields":[{"id":<field id>,"value":"<option id>"}]}`',
      'looked up each run',
    ])
      expect(flow, term).toContain(term)
    // The ids are looked up, never written in the runbook.
    expect(flow).not.toMatch(/429852189|f75ad846|0b81dac3|47fc9ee4|0bd5f6b0|98236657/)
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
