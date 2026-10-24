import { errorLine } from './errors.js'
import { OWNER_REPO, nameMatches, proseOnly, sections, stripComments } from './issue.js'
import type { Issue, IssueRef, Section } from './issue.js'

/** The identifiers of the rules, in the order the report lists them. */
export const RULE_IDS = [
  'title',
  'task-parts',
  'criteria',
  'citations',
  'out-of-scope',
  'delivery',
  'depends-on',
] as const

/** One rule of the Definition of Ready. */
export type RuleId = (typeof RULE_IDS)[number]

/** The outcome of one rule. */
export interface RuleResult {
  rule: RuleId
  ok: boolean
  /** What is missing, for the report. Empty when the rule passes. */
  detail: string
}

/**
 * Answers whether an issue is closed.
 *
 * @throws `Error` when the issue cannot be read; the rule reports it as a failure.
 */
export type IssueClosed = (ref: IssueRef) => Promise<boolean>

/** The five parts of a task (template `.github/ISSUE_TEMPLATE/task.md`, standard section 12). */
const TASK_PARTS = ['why', 'what to build', 'requirements', 'acceptance criteria', 'progress']
/** The sections the rules read; none of them nests under another heading. */
const SECTION_NAMES = [...TASK_PARTS, 'out of scope', 'delivery', 'depends on']

/** The types of the Task template's title comment. */
const TYPES = ['feat', 'fix', 'docs', 'refactor', 'style', 'test', 'ci', 'perf', 'chore']
const CONVENTIONAL = new RegExp(`^(?:${TYPES.join('|')})(?:\\([\\w./-]+\\))?(!)?: \\S`)

/** The paragraph of a breaking change (standard section 7), not the words quoted in prose. */
/** A list marker (`-`, `*`, `+`, `1.`) may come first: Requirements is a list in the template. */
// Tested line by line: with `/m`, `[\s>]*` would cross line breaks and scan every blank line that
// follows each line start, quadratic in the length of the body.
const BREAKING = /^[\s>]*(?:(?:[-*+]|\d+[.)])\s+)?[*_]*BREAKING CHANGE[*_]*:/
const LIST_ITEM = /^\s*(?:[-*]|\d+\.)\s+/
/** Extensions that make a bare file name without a directory count as a path. */
// `js` is left out so that `Node.js` and `Vue.js` are not paths; `src/a.js` still is one.
const FILE_EXTENSIONS = /\.(?:md|ts|mjs|cjs|json|ya?ml|vue|toml|html|css|sh|txt)$/
const ADR = /\bADR[- ]?\d{1,4}\b/i
const STANDARD_SECTION =
  /\bstandard\b[^.\n]{0,40}\bsections?\s+\d+|\bsections?\s+\d+(?:\s+(?:and|,)\s+\d+)*\s+of the(?:\s+engineering)?\s+standard\b/i
/** "Depends on" as a label, not quoted in prose ("every "Depends on" issue"). */
const DEPENDS_ON = /(?<!["“'`])\bDepends on\b(?!["”'`])(.*)$/
/** Where the list after "Depends on" ends: a sentence break, a dash or a parenthesis. */
const LIST_END = /[.;](?:\s|$)|\s[—–-]\s|\(/
const ISSUE_REF = new RegExp(`(?:\\b(${OWNER_REPO}))?#(\\d+)\\b`, 'g')
const ISSUE_URL = new RegExp(`https://github\\.com/(${OWNER_REPO})/issues/(\\d+)`, 'g')

/**
 * Checks an issue against the seven rules of the Definition of Ready, the table in this
 * package's `README.md`.
 *
 * @param isClosed - Reads the state of each "Depends on" issue; called only when there is one.
 * @returns One result per rule, in the order of `RULE_IDS`.
 */
export async function lintIssue(issue: Issue, isClosed: IssueClosed): Promise<RuleResult[]> {
  const parts = sections(issue.body, SECTION_NAMES)
  const prose = proseOnly(issue.body)
  return [
    title(issue.title, prose),
    taskParts(parts),
    criteria(parts),
    citations(stripComments(issue.body)),
    outOfScope(prose, parts),
    delivery(parts),
    await dependsOn(issue.repo, prose, parts, isClosed),
  ]
}

function result(rule: RuleId, detail: string): RuleResult {
  return { rule, ok: detail === '', detail }
}

function section(parts: Section[], name: string): Section | undefined {
  return (
    parts.find((part) => part.name === name) ?? parts.find((part) => nameMatches(part.name, name))
  )
}

function title(text: string, prose: string): RuleResult {
  const match = CONVENTIONAL.exec(text)
  if (!match) {
    return result(
      'title',
      `the title has no conventional prefix (\`${TYPES.join('`, `')}\`, optional scope, then \`: \`)`
    )
  }
  const breaking = prose.split(/[\n\r\u2028\u2029]/).some((line) => BREAKING.test(line))
  if (breaking && match[1] !== '!') {
    return result('title', 'the body has a `BREAKING CHANGE:` paragraph but the title has no `!`')
  }
  return result('title', '')
}

function taskParts(parts: Section[]): RuleResult {
  const missing = TASK_PARTS.filter((name) => !section(parts, name))
  const empty = TASK_PARTS.filter((name) => section(parts, name)?.content === '')
  const problems = [
    ...(missing.length ? [`missing ${quoteList(missing)}`] : []),
    ...(empty.length ? [`empty ${quoteList(empty)}`] : []),
  ]
  return result('task-parts', problems.length ? `Task parts ${problems.join('; ')}` : '')
}

function criteria(parts: Section[]): RuleResult {
  const part = section(parts, 'acceptance criteria')
  const items = (part?.content ?? '').split('\n').filter((line) => LIST_ITEM.test(line))
  const named = items.some((line) => line.includes('`') || line.includes('npm run'))
  return result(
    'criteria',
    named
      ? ''
      : 'no acceptance criterion names a command, a test or a file (a backtick or `npm run`)'
  )
}

function citations(body: string): RuleResult {
  const paths = filePaths(body)
  const hasPath = paths.length > 0
  const hasDocument =
    ADR.test(body) ||
    STANDARD_SECTION.test(body) ||
    paths.some((path) => path.endsWith('.md') || /(?:^|\/)docs\//.test(path))
  const missing = [
    ...(hasPath ? [] : ['file path']),
    ...(hasDocument ? [] : ['ADR or document (`ADR-n`, a `.md` file, a section of the standard)']),
  ]
  return result('citations', missing.length ? `the body cites no ${missing.join(' and no ')}` : '')
}

function outOfScope(prose: string, parts: Section[]): RuleResult {
  const heading = section(parts, 'out of scope')
  const line = prose
    .split('\n')
    .some((text) => /^\W*out of scope\b[\s*_:]*\S/i.test(text) && !/^\s*#/.test(text))
  const ok = (heading !== undefined && heading.content !== '') || line
  return result('out-of-scope', ok ? '' : 'no "Out of scope" section or line')
}

function delivery(parts: Section[]): RuleResult {
  const part = section(parts, 'delivery')
  if (!part) return result('delivery', 'no "Delivery" section')
  return result('delivery', part.content === '' ? 'the "Delivery" section is empty' : '')
}

async function dependsOn(
  repo: string | null,
  prose: string,
  parts: Section[],
  isClosed: IssueClosed
): Promise<RuleResult> {
  const refs = dependencies(repo, prose, parts)
  const problems: string[] = []
  for (const ref of refs) {
    const name = `${ref.repo ?? ''}#${ref.number}`
    if (ref.repo === null) {
      problems.push(`${name} has no repository (read the file with \`--repo owner/repo\`)`)
      continue
    }
    try {
      if (!(await isClosed({ repo: ref.repo, number: ref.number })))
        problems.push(`${name} is open`)
    } catch (error) {
      problems.push(`${name} could not be read (${errorLine(error)})`)
    }
  }
  return result('depends-on', problems.length ? `depends on ${problems.join(', ')}` : '')
}

/** The issues listed right after "Depends on", up to the end of that sentence, or in its section. */
function dependencies(
  repo: string | null,
  prose: string,
  parts: Section[]
): { repo: string | null; number: number }[] {
  const texts = prose
    .split('\n')
    .map((line) => DEPENDS_ON.exec(line)?.[1]?.split(LIST_END)[0])
    .filter((text): text is string => text !== undefined)
  const part = section(parts, 'depends on')
  if (part) texts.push(part.content)
  const seen = new Map<string, { repo: string | null; number: number }>()
  for (const text of texts) {
    for (const pattern of [ISSUE_URL, ISSUE_REF]) {
      for (const match of text.matchAll(pattern)) {
        const ref = { repo: match[1] ?? repo, number: Number(match[2]) }
        seen.set(`${ref.repo ?? ''}#${ref.number}`, ref)
      }
    }
  }
  return [...seen.values()]
}

/** The tokens of a body that look like repository paths: `a/b.ts`, `dir/`, `AGENTS.md`. */
function filePaths(body: string): string[] {
  return body
    .split(/[\s`'"()<>[\]{},;]+/)
    .map((token) => token.replace(/[.:!?]+$/, ''))
    .filter((token) => /^[\w.]/.test(token) && !token.includes('://'))
    .filter((token) =>
      token.includes('/')
        ? /[A-Za-z]\/$/.test(token) || /\.[A-Za-z][A-Za-z0-9]{0,5}$/.test(token)
        : FILE_EXTENSIONS.test(token)
    )
}

function quoteList(names: string[]): string {
  return names.map((name) => `"${name[0]?.toUpperCase()}${name.slice(1)}"`).join(', ')
}
