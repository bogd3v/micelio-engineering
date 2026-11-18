import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { errorLine } from './errors.js'

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

/**
 * Checks the draft: its "Instructions that were wrong or missing" section against the shape of
 * `docs/factory.md`, "The learning loop" ("Nothing" passes), and its "For review" section against
 * the diff. It fails each existing test the
 * diff removes lines from that "For review" does not answer with a `test-edit:` line.
 *
 * @returns The lines that break it; an empty list when the section is right.
 */
export function lintDraft(draft: string, context: DraftContext): DraftProblem[] {
  return [
    ...instructionProblems(draft, context),
    ...editedTestProblems(draft, context.editedTests ?? []),
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
    syncedFiles: async () => {
      const json = JSON.parse(await readFile(syncList, 'utf8')) as { files?: unknown }
      if (!Array.isArray(json.files)) throw new Error('.github/standard-sync.json has no "files"')
      return json.files.filter((file): file is string => typeof file === 'string')
    },
  }
}

const USAGE = 'Usage:\n  factory-tools lint-draft --file <draft> --base <ref>\n'

/**
 * `factory-tools lint-draft --file <draft> --base <ref>`: run in the worktree of the draft, with
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
    if ((name !== '--file' && name !== '--base') || value === undefined) {
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
  try {
    const problems = lintDraft(await deps.readText(file), {
      changed: await deps.diffNames(base),
      synced: await deps.syncedFiles(),
      editedTests: (await deps.editedTests?.(base)) ?? [],
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
