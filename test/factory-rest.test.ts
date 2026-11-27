import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = fileURLToPath(new URL('../', import.meta.url))

/** The factory's own files that call GitHub: GitHub's GraphQL quota must not stop any of them. */
const PATHS = [
  'template/.claude/',
  '.claude/',
  'herdr/master.md',
  'herdr/factory-clean.sh',
  'packages/factory-tools/src/run.ts',
  'packages/factory-tools/src/lane.ts',
  'packages/factory-tools/src/issue.ts',
  'packages/factory-tools/README.md',
  'docs/factory.md',
]

/** What gh sends through GraphQL: a `gh issue`, `gh pr` or `gh project` command, written or as an argument list. */
const FORBIDDEN = [/\bgh\s+(?:issue|pr|project)\b/g, /(['"])(?:issue|pr|project)\1\s*,/g]

/** `file:line` of each forbidden call in a file's text. */
function graphqlCalls(file: string, text: string): string[] {
  return FORBIDDEN.flatMap((pattern) =>
    [...text.matchAll(pattern)].map(
      (match) => `${file}:${String(text.slice(0, match.index).split('\n').length)}`
    )
  )
}

/** The files under `PATHS` that git tracks or would add. */
function files(): string[] {
  const listed = execFileSync(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', ...PATHS],
    { cwd: ROOT, encoding: 'utf8' }
  )
  return listed.split('\0').filter(Boolean)
}

describe("the factory's own GitHub calls", () => {
  it('the role prompts, the skills, herdr/master.md, herdr/factory-clean.sh, docs/factory.md and the live forms of lint-issue and lint-lane run no gh issue, gh pr or gh project command', () => {
    const read = files()
    // Every path of the list names at least one file: a moved file must not leave the check empty.
    for (const path of PATHS) {
      expect(
        read.some((file) => file === path || (path.endsWith('/') && file.startsWith(path))),
        path
      ).toBe(true)
    }
    expect(
      read.flatMap((file) => graphqlCalls(file, readFileSync(join(ROOT, file), 'utf8')))
    ).toEqual([])
  })

  it('names the file and the line of a command and of an argument list', () => {
    const text = [
      'run `gh issue view 1`',
      'gh api repos/example/site/issues/1',
      "exec('gh', ['pr', 'list'])",
      'exec("gh", [',
      '  "project",',
    ].join('\n')
    expect(graphqlCalls('x.md', text)).toEqual(['x.md:1', 'x.md:3', 'x.md:5'])
  })
})
