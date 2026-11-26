import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { dirname, posix, resolve } from 'node:path'
import { promisify } from 'node:util'
import { errorLine } from './errors.js'
import { isRecord } from './narrow.js'
import { issueFromGh, issueFromMarkdown, parseTarget, proseOnly } from './issue.js'
import type { Issue, IssueRef } from './issue.js'

/** The lanes of ADR-0003, from the lightest to the heaviest. */
export const LANES = ['express', 'normal', 'full'] as const

/** One of the three lanes. */
export type Lane = (typeof LANES)[number]

/** Whether `value` names one of the {@link LANES}. */
function isLane(value: string): value is Lane {
  return LANES.some((lane) => lane === value)
}

/** The three keys of the `## Lanes` block, in the order {@link LaneGlobs} has them. */
const LANE_KEYS = ['stack', 'contract', 'express'] as const

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
    const key = LANE_KEYS.find((name) => name === match?.[1])
    if (key === undefined) continue
    globs[key].push(
      ...(match?.[2] ?? '')
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
function isNormative(path: string): boolean {
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

/**
 * The lane a list of changed paths fits, and the paths that raise it above `express`.
 *
 * @param versionFiles - The paths that `versionFiles` found, each with its reason: they are
 * `express` whatever the globs say.
 */
export function diffLane(
  paths: string[],
  globs: LaneGlobs | null,
  versionFiles: ReadonlyMap<string, string> = new Map()
): LaneResult & { raised: { path: string; lane: Lane }[] } {
  const each = paths.map((path) => {
    const reason = versionFiles.get(path)
    return reason === undefined
      ? { path, ...pathLane(path, globs) }
      : { path, lane: 'express' as const, reasons: [reason] }
  })
  const lane = each.reduce<Lane>((top, p) => (rank(p.lane) > rank(top) ? p.lane : top), 'express')
  return {
    lane,
    reasons: each.flatMap((p) => p.reasons),
    raised: each.filter((p) => p.lane !== 'express').map((p) => ({ path: p.path, lane: p.lane })),
  }
}

/** A string value that differs between two JSON texts, and where it sits. */
interface Change {
  keys: string[]
  old: string
  new: string
}

/**
 * The string values that differ between two parsed JSON values.
 *
 * @returns `null` when they differ in anything else: a key, an array's length, a type or a value
 * that is not a string.
 */
function stringChanges(a: unknown, b: unknown, keys: string[] = []): Change[] | null {
  if (typeof a === 'string' && typeof b === 'string') {
    return a === b ? [] : [{ keys, old: a, new: b }]
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return null
    const found: Change[] = []
    for (let i = 0; i < a.length; i++) {
      const inner = stringChanges(a[i], b[i], [...keys, String(i)])
      if (inner === null) return null
      found.push(...inner)
    }
    return found
  }
  // Arrays returned above, so a record here is any other object
  if (isRecord(a) && isRecord(b)) {
    const names = Object.keys(a)
    // The order of the keys carries meaning (the conditions of `exports`), so it must be the same.
    if (names.join('\0') !== Object.keys(b).join('\0')) return null
    const found: Change[] = []
    for (const name of names) {
      const inner = stringChanges(a[name], b[name], [...keys, name])
      if (inner === null) return null
      found.push(...inner)
    }
    return found
  }
  return a === b ? [] : null
}

const PIN_KINDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']

/**
 * Whether `next` is `previous` with the version `from` replaced by `to`, and nothing else changed.
 * The version must stand alone: after only a range operator, and not followed by a character of a
 * longer version (`0.2.1` is not in `^0.2.10`, nor in `npm:other@0.2.1`).
 */
function pinMoves(previous: string, next: string, from: string, to: string): boolean {
  for (let i = previous.indexOf(from); i !== -1; i = previous.indexOf(from, i + 1)) {
    const before = previous.slice(0, i)
    const after = previous.slice(i + from.length)
    if (!/^[\^~=<>v ]*$/.test(before) || /^[0-9A-Za-z.+-]/.test(after)) continue
    if (before + to + after === next) return true
  }
  return false
}

/** One changed `package.json` or `package-lock.json`, read at `<base>` and in the worktree. */
interface VersionCandidate {
  path: string
  dir: string
  lock: boolean
  changes: Change[]
}

/** A package whose own `version` moves in the diff. */
interface Released {
  name: string
  dir: string
  old: string
  new: string
}

/** The packages a candidate's changes move, or `null` when one change is anything else. */
function moves(c: VersionCandidate, released: ReadonlyMap<string, Released>): Released[] | null {
  const byName = new Map([...released.values()].map((r) => [r.name, r]))
  const byDir = new Map([...released.values()].map((r) => [r.dir, r]))
  const touched = new Set<Released>()
  for (const change of c.changes) {
    const { keys } = change
    const pin = keys.length >= 2 ? byName.get(keys[keys.length - 1] ?? '') : undefined
    if (pin !== undefined && PIN_KINDS.includes(keys[keys.length - 2] ?? '')) {
      if (!pinMoves(change.old, change.new, pin.old, pin.new)) return null
      touched.add(pin)
      continue
    }
    const own = keys.length === 1 && keys[0] === 'version' ? byDir.get(c.dir) : undefined
    const entry =
      c.lock && keys.length === 3 && keys[0] === 'packages' && keys[2] === 'version'
        ? byDir.get(posix.join(c.dir, keys[1] ?? '').replace(/^\.$/, ''))
        : undefined
    const target = c.lock ? (own ?? entry) : keys.length === 1 ? own : undefined
    if (target === undefined) return null
    touched.add(target)
  }
  return touched.size === 0 ? null : [...touched]
}

/**
 * The changed paths that only move the version of a released package, each with its reason. A
 * version file is a `package.json` or `package-lock.json` that exists at `<base>` and in the
 * worktree, is not normative and matches no `stack:` glob, and whose JSON differs between the two
 * only in the `version` of a released package (its own, or its entry in a lock) and in pins of
 * released packages that move from its old version to its new one. A released package is a
 * version file's `package.json` whose top-level `version` changes.
 *
 * @param paths - The changed paths, from the root of the repository.
 * @param globs - The globs of the `## Lanes` block; with none, nothing is a version file.
 * @param readBase - The text of a path at `<base>`, `null` when it does not exist there.
 * @param readWorktree - The text of a path in the worktree; rejects with `ENOENT` when missing.
 * @returns The reason of each version file, by path.
 */
export async function versionFiles(
  paths: string[],
  globs: LaneGlobs | null,
  readBase: (path: string) => Promise<string | null>,
  readWorktree: (path: string) => Promise<string>
): Promise<Map<string, string>> {
  const found = new Map<string, string>()
  if (globs === null) return found
  const candidates: VersionCandidate[] = []
  const released = new Map<string, Released>()
  for (const path of paths) {
    const file = posix.basename(path)
    if (file !== 'package.json' && file !== 'package-lock.json') continue
    if (isNormative(path) || firstMatch(globs.stack, path) !== undefined) continue
    const before = await readBase(path)
    if (before === null) continue
    let after: string
    try {
      after = await readWorktree(path)
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') continue
      throw error
    }
    let changes: Change[] | null
    let next: unknown
    try {
      next = JSON.parse(after)
      changes = stringChanges(JSON.parse(before), next)
    } catch {
      continue
    }
    if (changes === null || changes.length === 0) continue
    const dir = dirname(path) === '.' ? '' : dirname(path)
    const candidate: VersionCandidate = { path, dir, lock: file === 'package-lock.json', changes }
    candidates.push(candidate)
    const own = changes.find((c) => c.keys.length === 1 && c.keys[0] === 'version')
    const name = isRecord(next) ? next.name : undefined
    if (!candidate.lock && own !== undefined && typeof name === 'string') {
      released.set(path, { name, dir, old: own.old, new: own.new })
    }
  }
  // A package.json that changes anything else is no release, and the pins of its package then stop
  // being version moves: repeat until nothing more drops out.
  for (let dropped = true; dropped;) {
    dropped = false
    for (const [path] of released) {
      const candidate = candidates.find((c) => c.path === path)
      if (candidate !== undefined && moves(candidate, released) === null) {
        released.delete(path)
        dropped = true
      }
    }
  }
  for (const candidate of candidates) {
    const touched = moves(candidate, released)
    if (touched === null) continue
    const what = touched.map((r) => `${r.name} ${r.old} → ${r.new}`).join(', ')
    found.set(candidate.path, `${candidate.path} only moves the version of ${what}`)
  }
  return found
}

/** What `runLintLane` needs from the outside world, so that tests can replace `gh`, git and the disk. */
export interface LintLaneDeps {
  /** Reads an issue with `gh issue view --json`. */
  readIssue: (ref: IssueRef) => Promise<Issue>
  /** Reads a file, relative to the working directory; rejects with `ENOENT` when it is missing. */
  readText: (path: string) => Promise<string>
  /**
   * The `## Lanes` block of the `AGENTS.md` of a repository on its default branch, for the target
   * form; `null` when there is none.
   */
  readLanes: (repo: string) => Promise<LaneGlobs | null>
  /** The paths of `git diff --name-only <base>` and the untracked files that git does not ignore. */
  diffNames: (base: string) => Promise<string[]>
  /**
   * The text of a path at `<base>` (`git show <base>:<path>`, in the same directory as
   * `diffNames`); `null` when the path does not exist there.
   */
  readBaseText: (base: string, path: string) => Promise<string | null>
}

/** The outcome of `runLintLane`: 0 on success or a diff that fits, 1 on a diff that does not, 2 on a usage or read error. */
export interface LintLaneResult {
  code: 0 | 1 | 2
  stdout: string
  stderr: string
}

const exec = promisify(execFile)

/**
 * The `## Lanes` block of the `AGENTS.md` of `repo` on its default branch, read with
 * `gh api repos/<repo>/contents/AGENTS.md`. `lint-lane` and `lint-issue` both read lanes through it.
 *
 * @returns `null` when there is no `AGENTS.md`, or none with a `## Lanes` block.
 * @throws `Error` when `gh` fails for any reason but a 404.
 */
export async function readRepoLanes(repo: string): Promise<LaneGlobs | null> {
  try {
    const { stdout } = await exec('gh', [
      'api',
      '-H',
      'Accept: application/vnd.github.raw',
      `repos/${repo}/contents/AGENTS.md`,
    ])
    return parseLanes(stdout)
  } catch (error) {
    const stderr = error instanceof Error && 'stderr' in error ? String(error.stderr) : ''
    if (/HTTP 404/.test(stderr)) return null
    throw error
  }
}

/** The real dependencies: `gh issue view`, `gh api` for the lanes, the disk and git in the working directory. */
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
    readLanes: readRepoLanes,
    readText: (path) => readFile(resolve(cwd, path), 'utf8'),
    readBaseText: async (base, path) => {
      try {
        const { stdout } = await exec('git', ['show', `${base}:${path}`], {
          cwd,
          maxBuffer: 64 * 1024 * 1024,
        })
        return stdout
      } catch {
        return null
      }
    },
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
 * `factory-tools lint-lane`: sets an issue's lane, or checks a diff against a lane. The target
 * form reads the `## Lanes` block of the issue's repository with `gh api`; `--file` and `--diff`
 * read the `AGENTS.md` of the working directory. It has no option to force a lane.
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
      if (!isLane(lane)) return usage(`unknown lane "${lane}"`)
      const names = await deps.diffNames(diff)
      const globs = await readGlobs(deps)
      const moved = await versionFiles(
        names,
        globs,
        (path) => deps.readBaseText(diff, path),
        deps.readText
      )
      const result = diffLane(names, globs, moved)
      if (rank(result.lane) <= rank(lane)) {
        return { code: 0, stdout: `lane: ${lane}\nthe diff fits the lane\n`, stderr: '' }
      }
      const raised = result.raised
        .filter((p) => rank(p.lane) > rank(lane))
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
    let globs: LaneGlobs | null
    if (file !== undefined) {
      issue = issueFromMarkdown(await deps.readText(file), null)
      globs = await readGlobs(deps)
    } else {
      const ref = parseTarget(positional[0] ?? '')
      if (ref === null) return usage(`"${positional[0]}" is not <owner/repo#n>`)
      issue = await deps.readIssue(ref)
      globs = await deps.readLanes(ref.repo)
    }
    const result = issueLane(issue.title, issue.body, globs)
    return {
      code: 0,
      stdout: `lane: ${result.lane}\n${result.reasons.map((line) => `- ${line}\n`).join('')}`,
      stderr: '',
    }
  } catch (error) {
    return { code: 2, stdout: '', stderr: `error: ${errorLine(error)}\n` }
  }
}
