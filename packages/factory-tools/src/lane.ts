import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { errorLine } from './errors.js'
import { issueFromGh, issueFromMarkdown, parseTarget, proseOnly } from './issue.js'
import type { Issue, IssueRef } from './issue.js'

/** The lanes of ADR-0003, from the lightest to the heaviest. */
export const LANES = ['express', 'normal', 'full'] as const

/** One of the three lanes. */
export type Lane = (typeof LANES)[number]

/** The globs of the `## Lanes` block of `AGENTS.md`. */
export interface LaneGlobs {
  stack: string[]
  contract: string[]
  express: string[]
}

/** A lane and the lines that explain it. */
export interface LaneResult {
  lane: Lane
  /** One line per reason: the title's `!`, or a path and what it matched. */
  reasons: string[]
}

/**
 * The paths that are normative and never `express`, whatever `express:` says. A name that ends in
 * `/` is a folder.
 */
export const NORMATIVE = [
  'docs/engineering-standard.md',
  'docs/standard/',
  'docs/factory.md',
  'AGENTS.md',
  'CLAUDE.md',
  '.claude/',
  'template/',
  'herdr/',
] as const

const rank = (lane: Lane): number => LANES.indexOf(lane)

/**
 * Reads the `## Lanes` block of an `AGENTS.md`: the lines `stack:`, `contract:` and `express:`, each
 * a comma-separated list of globs. A line may start with a list bullet, a glob may be in backticks,
 * and the lines may sit in a fenced block. A missing line is an empty list.
 *
 * @returns `null` when there is no `## Lanes` heading.
 */
export function parseLanes(agents: string): LaneGlobs | null {
  const lines = agents.split(/\r?\n/)
  const start = lines.findIndex((line) => /^##\s+Lanes\s*$/.test(line))
  if (start === -1) return null
  const globs: LaneGlobs = { stack: [], contract: [], express: [] }
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,2}\s/.test(line)) break
    const match = /^\s*(?:[-*]\s+)?(stack|contract|express):(.*)$/.exec(line)
    if (match?.[1] === undefined) continue
    const key = match[1] as keyof LaneGlobs
    globs[key].push(
      ...(match[2] ?? '')
        .split(',')
        .map((glob) =>
          glob
            .trim()
            .replace(/^`+|`+$/g, '')
            .trim()
        )
        .filter((glob) => glob !== '')
    )
  }
  return globs
}

const escape = (text: string): string => text.replace(/[.+^${}()|[\]\\]/g, '\\$&')

/**
 * Whether a glob matches a path, written with `/`. `*` is any run of characters but `/`, `**` is any
 * run including `/` (`**` followed by `/` may also match nothing), `?` is one character but `/`,
 * and a glob that ends in `/` is a folder and matches everything under it. The glob matches the
 * whole path.
 */
export function matchGlob(glob: string, path: string): boolean {
  const body = glob.endsWith('/') ? `${glob}**` : glob
  let source = ''
  for (let i = 0; i < body.length; i++) {
    const char = body.charAt(i)
    if (char === '*' && body.charAt(i + 1) === '*') {
      if (body.charAt(i + 2) === '/') {
        source += '(?:.*/)?'
        i += 2
      } else {
        source += '.*'
        i += 1
      }
    } else if (char === '*') source += '[^/]*'
    else if (char === '?') source += '[^/]'
    else source += escape(char)
  }
  return new RegExp(`^${source}$`).test(path)
}

/** Whether a path is one of the `NORMATIVE` files or inside one of its folders. */
export function isNormative(path: string): boolean {
  return NORMATIVE.some((entry) => (entry.endsWith('/') ? path.startsWith(entry) : path === entry))
}

const firstMatch = (globs: string[], path: string): string | undefined =>
  globs.find((glob) => matchGlob(glob, path))

/**
 * The paths an issue body names in backticks: a token with a `/`, or one that ends in an extension
 * that starts with a letter (`AGENTS.md`). Fenced blocks and HTML comments are not read.
 */
export function issuePaths(body: string): string[] {
  const found = new Set<string>()
  for (const match of proseOnly(body).matchAll(/`([^`\n]+)`/g)) {
    const token = (match[1] ?? '').trim().replace(/^\.\//, '')
    if (!/^[\w.@/-]+$/.test(token) || token.startsWith('-')) continue
    if (token.includes('/') || /\.[A-Za-z]\w*$/.test(token)) found.add(token)
  }
  return [...found]
}

/** The lane of one path and the reason; with no block every path is `full`. */
function pathLane(path: string, globs: LaneGlobs | null): LaneResult {
  if (globs === null) return { lane: 'full', reasons: [`\`${path}\`: no \`## Lanes\` block`] }
  for (const key of ['stack', 'contract'] as const) {
    const glob = firstMatch(globs[key], path)
    if (glob !== undefined) {
      return { lane: 'full', reasons: [`\`${path}\` matches ${key}: \`${glob}\``] }
    }
  }
  if (isNormative(path)) return { lane: 'normal', reasons: [`\`${path}\` is normative`] }
  const glob = firstMatch(globs.express, path)
  if (glob !== undefined)
    return { lane: 'express', reasons: [`\`${path}\` matches express: \`${glob}\``] }
  return { lane: 'normal', reasons: [`\`${path}\` matches no glob`] }
}

/** The lane of an issue: its title and the paths it names, against the globs. */
export function issueLane(title: string, body: string, globs: LaneGlobs | null): LaneResult {
  const reasons: string[] = []
  if (/^\s*\w+(?:\([^)]*\))?!:/.test(title)) reasons.push('the title has `!`')
  const paths = issuePaths(body).map((path) => pathLane(path, globs))
  const lane: Lane =
    globs === null || reasons.length > 0 || paths.some((p) => p.lane === 'full')
      ? 'full'
      : paths.length > 0 && paths.every((p) => p.lane === 'express')
        ? 'express'
        : 'normal'
  if (globs === null) reasons.push('no `## Lanes` block in `AGENTS.md`')
  else if (paths.length === 0) reasons.push('the issue names no path')
  else for (const path of paths) reasons.push(...path.reasons)
  return { lane, reasons }
}

/** The lane a list of changed paths fits, and the paths that raise it above `express`. */
export function diffLane(
  paths: string[],
  globs: LaneGlobs | null
): LaneResult & { raised: { path: string; lane: Lane }[] } {
  const each = paths.map((path) => ({ path, ...pathLane(path, globs) }))
  const lane = each.reduce<Lane>((top, p) => (rank(p.lane) > rank(top) ? p.lane : top), 'express')
  return {
    lane,
    reasons: each.flatMap((p) => p.reasons),
    raised: each.filter((p) => p.lane !== 'express').map((p) => ({ path: p.path, lane: p.lane })),
  }
}

/** What `runLintLane` needs from the outside world, so that tests can replace `gh`, git and the disk. */
export interface LintLaneDeps {
  /** Reads an issue with `gh issue view --json`. */
  readIssue: (ref: IssueRef) => Promise<Issue>
  /** Reads a file, relative to the working directory; rejects with `ENOENT` when it is missing. */
  readText: (path: string) => Promise<string>
  /** The paths of `git diff --name-only <base>` and the untracked files that git does not ignore. */
  diffNames: (base: string) => Promise<string[]>
}

/** The outcome of `runLintLane`: 0 on success or a diff that fits, 1 on a diff that does not, 2 on a usage or read error. */
export interface LintLaneResult {
  code: 0 | 1 | 2
  stdout: string
  stderr: string
}

const exec = promisify(execFile)

/** The real dependencies: `gh issue view`, the disk and git in the working directory. */
export function createDeps(cwd: string = process.cwd()): LintLaneDeps {
  return {
    readIssue: async (ref) => {
      const { stdout } = await exec('gh', [
        'issue',
        'view',
        String(ref.number),
        '--repo',
        ref.repo,
        '--json',
        'title,body',
      ])
      return issueFromGh(JSON.parse(stdout), ref.repo)
    },
    readText: (path) => readFile(path, 'utf8'),
    diffNames: async (base) => {
      const lines = async (args: string[]): Promise<string[]> =>
        (await exec('git', args, { cwd, maxBuffer: 64 * 1024 * 1024 })).stdout
          .split('\0')
          .filter((line) => line !== '')
      // `-z` keeps non-ASCII names unquoted; `--no-renames` lists the old name of a rename too, so
      // moving a file out of a `contract:` path does not lower the lane.
      const tracked = await lines(['diff', '--name-only', '--no-renames', '-z', base])
      const untracked = await lines([
        'ls-files',
        '--others',
        '--exclude-standard',
        '--full-name',
        '-z',
      ])
      return [...new Set([...tracked, ...untracked])]
    },
  }
}

const USAGE = `Usage:
  factory-tools lint-lane <owner/repo#n>
  factory-tools lint-lane --file <path>
  factory-tools lint-lane --diff <base> --lane <express|normal|full>
`

const usage = (problem: string): LintLaneResult => ({
  code: 2,
  stdout: '',
  stderr: `error: ${problem}\n${USAGE}`,
})

/** `AGENTS.md` of the working directory, `null` when it has none. */
async function readGlobs(deps: LintLaneDeps): Promise<LaneGlobs | null> {
  try {
    return parseLanes(await deps.readText('AGENTS.md'))
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null
    throw error
  }
}

/**
 * `factory-tools lint-lane`: sets an issue's lane, or checks a diff against a lane. Run in the
 * checkout of the issue's repository, whose `AGENTS.md` holds the `## Lanes` block. It has no
 * option to force a lane.
 *
 * @param argv - The arguments after the program name, starting with `lint-lane`.
 */
export async function runLintLane(
  argv: string[],
  deps: LintLaneDeps = createDeps()
): Promise<LintLaneResult> {
  const values = new Map<string, string>()
  const positional: string[] = []
  const args = argv.slice(1)
  for (let i = 0; i < args.length; i++) {
    const name = args[i] ?? ''
    if (name === '--file' || name === '--diff' || name === '--lane') {
      const value = args[i + 1]
      if (value === undefined || values.has(name)) return usage(`bad argument "${name}"`)
      values.set(name, value)
      i++
    } else if (name.startsWith('-')) return usage(`unknown option "${name}"`)
    else positional.push(name)
  }
  const diff = values.get('--diff')
  const lane = values.get('--lane')
  const file = values.get('--file')
  try {
    if (diff !== undefined || lane !== undefined) {
      if (diff === undefined || lane === undefined || file !== undefined || positional.length > 0) {
        return usage('--diff and --lane go together and take no issue')
      }
      if (!LANES.includes(lane as Lane)) return usage(`unknown lane "${lane}"`)
      const result = diffLane(await deps.diffNames(diff), await readGlobs(deps))
      if (rank(result.lane) <= rank(lane as Lane)) {
        return { code: 0, stdout: `lane: ${lane}\nthe diff fits the lane\n`, stderr: '' }
      }
      const raised = result.raised
        .filter((p) => rank(p.lane) > rank(lane as Lane))
        .map((p) => `- ${p.path} (${p.lane})\n`)
      return {
        code: 1,
        stdout: `lane: ${result.lane}\nthe diff does not fit ${lane}; these paths raise it:\n${raised.join('')}`,
        stderr: '',
      }
    }
    if ((file === undefined ? 0 : 1) + positional.length !== 1) {
      return usage('give one issue, <owner/repo#n> or --file <path>')
    }
    let issue: Issue
    if (file !== undefined) {
      issue = issueFromMarkdown(await deps.readText(file), null)
    } else {
      const ref = parseTarget(positional[0] ?? '')
      if (ref === null) return usage(`"${positional[0]}" is not <owner/repo#n>`)
      issue = await deps.readIssue(ref)
    }
    const result = issueLane(issue.title, issue.body, await readGlobs(deps))
    return {
      code: 0,
      stdout: `lane: ${result.lane}\n${result.reasons.map((line) => `- ${line}\n`).join('')}`,
      stderr: '',
    }
  } catch (error) {
    return { code: 2, stdout: '', stderr: `error: ${errorLine(error)}\n` }
  }
}
