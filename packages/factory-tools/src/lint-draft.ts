import { execFile } from 'node:child_process'
import { readFile, readdir } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { promisify } from 'node:util'
import { errorLine } from './errors.js'
import {
  EXIT,
  LOG,
  WITHOUT_CHANGE,
  agentsCommandLines,
  testsEntries,
  withoutSlotPrefix,
} from './verify-draft.js'

/** The heading of the section the command reads, without the `#`s. */
export const SECTION = 'Instructions that were wrong or missing'

/** What `lintDraft` needs to know about the repository the draft is for. */
export interface DraftContext {
  /** The paths `git diff --name-only <base>` lists. */
  changed: string[]
  /** The `files` of `.github/standard-sync.json`: the synced files and folders. */
  synced: string[]
  /** The test files the diff removes lines from (`git diff --numstat`); left out, none. */
  editedTests?: string[]
  /**
   * The words of the check command of the repository (`checkCommandOf`); `null` when it has none,
   * and then the draft is not asked to report one.
   */
  checkCommand: string[] | null
  /**
   * The files of the packet's logs directory, as paths relative to it (`npm-test.log`); left out,
   * the "Tests" section is not checked for logs.
   */
  logFiles?: string[]
}

/** A line of the section that breaks the shape, and why. */
export interface DraftProblem {
  line: string
  problem: string
}

const FIXED = /^(?<subject>.+?): .+ - fixed in (?<path>\S+)$/
const REPORTED = /^(?<subject>.+?): .+ - reported to the master$/

const unquote = (text: string): string => text.replace(/^`|`$/g, '').replace(/[.,;]$/, '')

/** The heading of the section where the draft answers an edited test. */
const REVIEW = 'For review'

/** `test-edit: <path> - <sentence>`; the path may hold spaces, so it ends at the first ` - `. */
const ANSWER = /^test-edit: (?<path>.+?) - \S.*$/

/** The lines of the section, without bullets and blanks; `null` when the draft has no section. */
function sectionLines(draft: string, heading: string = SECTION): string[] | null {
  const lines = draft.split('\n')
  const start = lines.findIndex((line) => /^#{1,6}\s/.test(line) && line.includes(heading))
  if (start === -1) return null
  const rest = lines.slice(start + 1)
  const end = rest.findIndex((line) => /^#{1,6}\s/.test(line))
  return (end === -1 ? rest : rest.slice(0, end))
    .map((line) => line.replace(/^\s*(?:[-*]\s+)?/, '').trim())
    .filter((line) => line !== '')
}

/** Whether `path` is one of the synced entries, or inside a synced folder. */
function isSynced(path: string, synced: string[]): boolean {
  return synced.some((entry) => path === entry || path.startsWith(`${entry}/`))
}

/** An own file: `AGENTS.md`, or a skill that `.github/standard-sync.json` does not list. */
function isOwn(path: string, synced: string[]): boolean {
  return path === 'AGENTS.md' || (path.startsWith('.claude/skills/') && !isSynced(path, synced))
}

/**
 * Whether `path` is a test file: its name has `.test.` or `.spec.`, or it is under `__tests__/`,
 * `tests/` or `e2e/`; a file under `fixtures/` is not.
 */
function isTestFile(path: string): boolean {
  const parts = path.split('/')
  if (parts.slice(0, -1).includes('fixtures')) return false
  const name = parts.at(-1) ?? ''
  return (
    name.includes('.test.') ||
    name.includes('.spec.') ||
    parts.slice(0, -1).some((dir) => dir === '__tests__' || dir === 'tests' || dir === 'e2e')
  )
}

/** Where a command ends and the next starts: `|`, `;`, `&` (so `||` and `&&` too) and `$(`. */
const COMMAND_BREAK = /[|;&]|\$\(/

/** Whether one argument of `wc` is its `-w` flag: alone, in a cluster such as `-lw`, or `--w` to `--words`; a redirection ends it. */
function isWordsFlag(arg: string): boolean {
  const flag = arg.replace(/[<>)].*$/, '')
  if (flag.startsWith('--')) return flag.length > 2 && 'words'.startsWith(flag.slice(2))
  return /^-[a-zA-Z]*w[a-zA-Z]*$/.test(flag)
}

/**
 * Whether `line` runs `wc` with its `-w` flag, wherever the flag is among the arguments. Quoted text
 * is ignored; the line is split on `|`, `;`, `&` and `$(`; each part skips leading `VAR=value` words
 * and `env`; the command is `wc`, bare or with a path. It does not look inside `docker run`, `xargs`
 * or `sh -c` (`packages/factory-tools/README.md`).
 */
function runsWordCount(line: string): boolean {
  const unquoted = line.replace(/"[^"]*"|'[^']*'/g, '""')
  return unquoted.split(COMMAND_BREAK).some((part) => {
    const words = (part.split('`')[part.startsWith('`') ? 1 : 0] ?? '')
      .replace(/^\s*\$\s+/, '')
      .replace(/\)+\s*$/, '')
      .split(/\s+/)
      .filter((word) => word !== '')
    let i = 0
    while (i < words.length && (words[i] === 'env' || /^[A-Za-z_]\w*=/.test(words[i] ?? ''))) i++
    const command = words[i]?.split('/').at(-1)
    return command === 'wc' && words.slice(i + 1).some(isWordsFlag)
  })
}

/**
 * The list items and the lines of fenced blocks of the "Tests" section, up to the next heading
 * outside a fenced block; `null` without a section titled exactly "Tests".
 */
function testsLines(draft: string): string[] | null {
  const lines = draft.split('\n')
  const start = lines.findIndex((line) => /^#{1,6}\s+Tests\s*$/.test(line))
  if (start === -1) return null
  const out: string[] = []
  let fenced = false
  for (const line of lines.slice(start + 1)) {
    if (/^\s*(?:```|~~~)/.test(line)) fenced = !fenced
    else if (fenced) out.push(line.trim())
    else if (/^#{1,6}\s/.test(line)) break
    else if (/^\s*(?:[-*+]|\d+[.)])\s/.test(line))
      out.push(line.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '').trim())
  }
  return out.filter((line) => line !== '')
}

/** One problem for each list item or fenced line of the "Tests" section that runs `wc -w`: its total changes with the locale. */
function wordCountProblems(draft: string): DraftProblem[] {
  return (testsLines(draft) ?? []).filter(runsWordCount).map((line) => ({
    line,
    problem: `runs wc -w, whose total depends on the machine's locale: the word budgets are read from the test that holds them (test/factory-files.test.ts, test/factory-docs.test.ts)`,
  }))
}

/** One problem for each edited test file that "For review" does not answer with `test-edit:` (`G3.3`). */
function editedTestProblems(draft: string, edited: string[]): DraftProblem[] {
  const answered = new Set(
    (sectionLines(draft, REVIEW) ?? []).flatMap((line) => {
      const path = ANSWER.exec(line)?.groups?.['path']
      return path === undefined ? [] : [unquote(path)]
    })
  )
  return edited
    .filter((path) => isTestFile(path) && !answered.has(path))
    .map((path) => ({
      line: path,
      problem: `${path} is an existing test the diff removes lines from (G3.3): add "test-edit: ${path} - <the sentence of the issue that asks for the change>" to "${REVIEW}", or add to the test instead of editing it`,
    }))
}

/** The fenced blocks of the "Tests" section whose first line starts `$ `, with the line above the fence. */
function testsBlocks(draft: string): { lines: string[]; intro: string }[] {
  const lines = draft.split('\n')
  const start = lines.findIndex((line) => /^#{1,6}\s+Tests\s*$/.test(line))
  if (start === -1) return []
  const depth = (line: string): number => /^(#{1,6})\s/.exec(line)?.[1]?.length ?? 7
  const level = depth(lines[start] ?? '')
  const blocks: { lines: string[]; intro: string }[] = []
  let current: string[] | null = null
  let intro = ''
  let last = ''
  for (const line of lines.slice(start + 1)) {
    if (/^\s*(?:```|~~~)/.test(line)) {
      if (current === null) {
        current = []
        intro = last
      } else {
        const body = current.map((l) => l.trim()).filter((l) => l !== '')
        if (body[0]?.startsWith('$ ')) blocks.push({ lines: body, intro })
        current = null
        last = ''
      }
    } else if (current !== null) current.push(line)
    else if (depth(line) <= level) break
    else if (line.trim() !== '') last = line.trim()
  }
  return blocks
}

/** A problem for a log the packet lacks: `name` is what the draft writes after `logs/`. */
function missingLog(files: string[], name: string | undefined): string | null {
  if (name === undefined)
    return 'names no log file: add `log: logs/<name>.log` or `logs/<name>.log`'
  const clean = name.replace(/^\.?\/+/, '')
  return files.includes(clean)
    ? null
    : `its log \`logs/${clean}\` is not a file in the packet's logs directory`
}

/**
 * One problem for each command of the "Tests" section with no log in the packet (`G2`): a fenced
 * block whose first line starts `$ ` and an item that starts with a command in backticks. A run shown
 * failing (`without the change`, not exit 0) needs none.
 */
function logProblems(draft: string, files: string[] | undefined): DraftProblem[] {
  if (files === undefined) return []
  const problems: DraftProblem[] = []
  for (const block of testsBlocks(draft)) {
    if (WITHOUT_CHANGE.test(block.intro)) continue
    const command = (block.lines[0] ?? '').replace(/^\$\s+/, '')
    const named = block.lines.map((l) => /^log:\s*(\S+)/.exec(l)?.[1]).find((n) => n !== undefined)
    const problem = missingLog(files, named?.replace(/^logs\//, ''))
    if (problem !== null) problems.push({ line: command, problem: `the block ${problem}` })
  }
  for (const entry of testsEntries(draft) ?? []) {
    const parsed = /^`([^`]+)`(.*)$/.exec(entry.text)
    if (parsed === null) continue
    const summary = parsed[2] ?? ''
    if (
      (WITHOUT_CHANGE.test(entry.text) || WITHOUT_CHANGE.test(entry.intro)) &&
      EXIT.exec(summary)?.[1] !== '0'
    )
      continue
    const problem = missingLog(files, LOG.exec(summary)?.[1])
    if (problem !== null)
      problems.push({ line: (parsed[1] ?? '').trim(), problem: `the item ${problem}` })
  }
  return problems
}

/**
 * The check command of a repository: the `check:` line of the first `## Commands` block of its
 * `AGENTS.md`; else `npm run check` when its manifest has a `check` script; else `null`.
 *
 * @param agents - The text of `AGENTS.md`; empty when the repository has none.
 * @param manifest - The text of the root `package.json`; empty when the repository has none.
 * @throws When `AGENTS.md` has no `check:` line and a non-empty manifest is not JSON.
 */
export function checkCommandOf(agents: string, manifest: string): string[] | null {
  const line = agentsCommandLines(agents).find((command) => command.label === 'check')
  if (line !== undefined) return line.words
  if (manifest === '') return null
  const json = JSON.parse(manifest) as { scripts?: { check?: unknown } } | null
  return typeof json?.scripts?.check === 'string' ? ['npm', 'run', 'check'] : null
}

/** One problem when `checkCommand` is set and no entry of "Tests" runs it and reports `exit 0` (`G2.1`). */
function checkCommandProblems(draft: string, checkCommand: string[] | null): DraftProblem[] {
  if (checkCommand === null) return []
  const reported = (testsEntries(draft) ?? []).some((entry) => {
    const parsed = /^`([^`]+)`(.*)$/.exec(entry.text)
    if (parsed === null) return false
    const words = withoutSlotPrefix((parsed[1] ?? '').trim()).split(/\s+/)
    return (
      checkCommand.every((word, i) => words[i] === word) && EXIT.exec(parsed[2] ?? '')?.[1] === '0'
    )
  })
  if (reported) return []
  const command = checkCommand.join(' ')
  return [
    {
      line: '',
      problem: `the "Tests" section has no entry that runs \`${command}\`, the check command, and reports exit 0 (G2.1): run it once at the end, in every lane, whatever the change`,
    },
  ]
}

/**
 * Checks the draft: its "Instructions that were wrong or missing" section against the shape of
 * `docs/factory.md`, "The learning loop" ("Nothing" passes), and its "For review" section against
 * the diff. It fails each existing test the
 * diff removes lines from that "For review" does not answer with a `test-edit:` line, and each list item
 * or fenced line of the "Tests" section that runs `wc -w`, and a draft whose "Tests" section has no
 * entry that runs the check command and reports `exit 0` (`G2.1`) when the context has one.
 *
 * @returns The lines that break it; an empty list when the section is right.
 */
export function lintDraft(draft: string, context: DraftContext): DraftProblem[] {
  return [
    ...instructionProblems(draft, context),
    ...editedTestProblems(draft, context.editedTests ?? []),
    ...wordCountProblems(draft),
    ...checkCommandProblems(draft, context.checkCommand),
    ...logProblems(draft, context.logFiles),
  ]
}

function instructionProblems(draft: string, context: DraftContext): DraftProblem[] {
  const lines = sectionLines(draft)
  if (lines === null) return [{ line: '', problem: `the draft has no "${SECTION}" section` }]
  if (lines.length === 0) return [{ line: '', problem: 'the section is empty; write "Nothing"' }]
  const problems: DraftProblem[] = []
  for (const line of lines) {
    if (/^nothing\.?$/i.test(line)) continue
    const fixed = FIXED.exec(line)
    if (fixed?.groups) {
      const path = unquote(fixed.groups['path'] ?? '')
      const subject = unquote(fixed.groups['subject'] ?? '')
      if (/^(?:issue|standard)$/i.test(subject)) {
        problems.push({
          line,
          problem: 'the issue and the standard are reported to the master, not fixed on the branch',
        })
        continue
      }
      if (isSynced(subject, context.synced) && path !== `template/${subject}`) {
        problems.push({
          line,
          problem: `${subject} is a synced file: outside micelio-engineering it ends "reported to the master", inside it ends "fixed in template/${subject}"`,
        })
        continue
      }
      if (!context.changed.includes(path)) {
        problems.push({ line, problem: `ends "fixed in ${path}", which the diff does not touch` })
      }
      continue
    }
    const reported = REPORTED.exec(line)
    if (reported?.groups) {
      const subject = unquote(reported.groups['subject'] ?? '')
      if (isOwn(subject, context.synced)) {
        problems.push({
          line,
          problem: `${subject} is a file of this repository: fix it on the branch, do not report it`,
        })
      }
      continue
    }
    problems.push({
      line,
      problem:
        'neither "<path>: <what> - fixed in <path>" nor "<subject>: <what> - reported to the master"',
    })
  }
  return problems
}

/** What `runLintDraft` needs from the outside world, so that tests can replace git and the disk. */
export interface LintDraftDeps {
  readText: (path: string) => Promise<string>
  /** The paths `git diff --name-only <base>` lists. */
  diffNames: (base: string) => Promise<string[]>
  /** The `files` of `.github/standard-sync.json` of the `micelio-engineering` checkout. */
  syncedFiles: () => Promise<string[]>
  /** The paths `git diff --numstat -z --no-renames <base>` shows with deleted lines, test files only. Optional. */
  editedTests?: (base: string) => Promise<string[]>
  /** `checkCommandOf` of the `AGENTS.md` and `package.json` in the worktree. Optional; left out, `null`. */
  checkCommand?: () => Promise<string[] | null>
  /** The files under a logs directory, relative to it, in any depth. Optional; used with `--logs`. */
  logFiles?: (dir: string) => Promise<string[]>
}

/** The outcome of `runLintDraft`: 0 when the draft is right, 1 when a line breaks a rule, 2 on a usage or read error. */
export interface LintDraftResult {
  code: 0 | 1 | 2
  stdout: string
  stderr: string
}

const exec = promisify(execFile)

/** `.github/standard-sync.json` of the checkout this package is in (`packages/factory-tools/{src,dist}` is two levels below `packages`). */
const OWN_SYNC_LIST = new URL('../../../.github/standard-sync.json', import.meta.url)

/**
 * The real dependencies: git in `cwd` (the worktree of the draft) and the list of synced files of
 * the `micelio-engineering` checkout the command was built in, which is not the target repository:
 * only `micelio-engineering` has `.github/standard-sync.json`.
 *
 * @param cwd - The directory the git command runs in.
 * @param syncList - The file that lists the synced files; by default the one of this checkout.
 */
export function createDeps(cwd: string, syncList: URL = OWN_SYNC_LIST): LintDraftDeps {
  return {
    readText: (path) => readFile(path, 'utf8'),
    diffNames: async (base) => {
      const { stdout } = await exec('git', ['diff', '--name-only', base], { cwd })
      return stdout.split('\n').filter((line) => line !== '')
    },
    editedTests: async (base) => {
      // -z: paths come raw, never C-quoted; records end in NUL
      const { stdout } = await exec('git', ['diff', '--numstat', '-z', '--no-renames', base], {
        cwd,
      })
      return stdout
        .split('\0')
        .map((record) => record.split('\t'))
        .filter(([, deleted]) => /^[1-9]\d*$/.test(deleted ?? ''))
        .map((cols) => cols.slice(2).join('\t'))
        .filter(isTestFile)
    },
    checkCommand: async () => {
      const read = async (name: string): Promise<string> => {
        try {
          return await readFile(join(cwd, name), 'utf8')
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''
          throw error
        }
      }
      return checkCommandOf(await read('AGENTS.md'), await read('package.json'))
    },
    logFiles: async (dir) =>
      (await readdir(dir, { recursive: true, withFileTypes: true }))
        .filter((entry) => entry.isFile())
        .map((entry) => relative(dir, join(entry.parentPath, entry.name))),
    syncedFiles: async () => {
      const json = JSON.parse(await readFile(syncList, 'utf8')) as { files?: unknown }
      if (!Array.isArray(json.files)) throw new Error('.github/standard-sync.json has no "files"')
      return json.files.filter((file): file is string => typeof file === 'string')
    },
  }
}

const USAGE = 'Usage:\n  factory-tools lint-draft --file <draft> --base <ref> [--logs <dir>]\n'

/**
 * `factory-tools lint-draft --file <draft> --base <ref> [--logs <dir>]`: run in the worktree of the draft, with
 * the branch checked out, by the command built in the `micelio-engineering` checkout.
 *
 * @param argv - The arguments after the program name, starting with `lint-draft`.
 */
export async function runLintDraft(
  argv: string[],
  deps: LintDraftDeps = createDeps(process.cwd())
): Promise<LintDraftResult> {
  const values = new Map<string, string>()
  const args = argv.slice(1)
  for (let i = 0; i < args.length; i++) {
    const name = args[i] ?? ''
    const value = args[i + 1]
    if (!['--file', '--base', '--logs'].includes(name) || value === undefined) {
      return { code: 2, stdout: '', stderr: `error: bad argument "${name}"\n${USAGE}` }
    }
    values.set(name, value)
    i++
  }
  const file = values.get('--file')
  const base = values.get('--base')
  if (file === undefined || base === undefined) {
    return { code: 2, stdout: '', stderr: `error: lint-draft needs --file and --base\n${USAGE}` }
  }
  const logs = values.get('--logs')
  try {
    const problems = lintDraft(await deps.readText(file), {
      changed: await deps.diffNames(base),
      synced: await deps.syncedFiles(),
      editedTests: (await deps.editedTests?.(base)) ?? [],
      checkCommand: (await deps.checkCommand?.()) ?? null,
      ...(logs === undefined || deps.logFiles === undefined
        ? {}
        : { logFiles: await deps.logFiles(logs) }),
    })
    if (problems.length === 0) {
      return { code: 0, stdout: `lint-draft · ${file} · the draft is right\n`, stderr: '' }
    }
    const body = problems.map((p) => `- ${p.line === '' ? '' : `\`${p.line}\`: `}${p.problem}\n`)
    return {
      code: 1,
      stdout: `lint-draft · ${file} · ${problems.length} problem(s)\n\n${body.join('')}`,
      stderr: '',
    }
  } catch (error) {
    return { code: 2, stdout: '', stderr: `error: ${errorLine(error)}\n` }
  }
}
