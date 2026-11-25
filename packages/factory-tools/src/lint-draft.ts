import { execFile } from 'node:child_process'
import { access, readFile, readdir, stat } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { promisify } from 'node:util'
import { errorLine } from './errors.js'
import {
  EXIT,
  LOG,
  WITHOUT_CHANGE,
  agentsCommandLines,
  figures,
  numbersBefore,
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
   * Whether the worktree is `micelio-engineering` (`createDeps` sets it when it has
   * `.github/standard-sync.json`). There a synced file, a path under `template/` and a path under
   * `herdr/` belong to the repository and are fixed on the branch, never reported to the master;
   * left out, false.
   */
  home?: boolean
  /**
   * The files of the packet's logs directory, as paths relative to it (`npm-test.log`); left out,
   * the "Tests" section is not checked for logs.
   */
  logFiles?: string[]
  /**
   * The modification time (ms) of each file the "Tests" section names, keyed by the name the draft
   * writes (`logs/npm-test.log`, `shots/a.png`); a file that does not exist has no key. With
   * `changedTimes` it turns on the check that evidence is not older than the code; left out, skipped.
   */
  evidenceTimes?: Record<string, number>
  /** The modification time (ms) of each file the diff changes and each untracked file git does not ignore, by path; left out, the check is skipped. */
  changedTimes?: Record<string, number>
  /**
   * The text of each log the "Tests" section names, keyed by the file after `logs/` (`npm-test.log`);
   * a log that does not exist has no key. With it, each figure of an entry is compared with the log
   * the entry names, by `verify-draft`'s rules; left out, skipped.
   */
  logContents?: Record<string, string>
  /**
   * The issue's body (its first line `# <title>` is allowed). With it, each item of its "Acceptance
   * criteria" that holds the form `<test file> > "<name>"` in backticks needs a test of that file titled `<name>`
   * (`namedTestProblems`); left out, skipped.
   */
  issue?: string
  /** The text of each test file the criteria of `issue` name, keyed by the path they write; a file that does not exist has no key. */
  testSources?: Record<string, string>
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
export function sectionLines(draft: string, heading: string = SECTION): string[] | null {
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
 * How to fix a file `micelio-engineering` owns: a synced file (with or without its `template/`
 * prefix), any path under `template/`, any path under `herdr/`. `null` for any other path.
 */
function homeFix(path: string, synced: string[]): string | null {
  const bare = path.startsWith('template/') ? path.slice('template/'.length) : path
  if (isSynced(bare, synced)) return `fix it on the branch and end "fixed in template/${bare}"`
  if (path.startsWith('template/') || path.startsWith('herdr/')) return 'fix it on the branch'
  return null
}

/**
 * Whether `path` is a test file: its name has `.test.` or `.spec.`, or it is under `__tests__/`,
 * `tests/` or `e2e/`; a file under `fixtures/` is not.
 */
export function isTestFile(path: string): boolean {
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
 * is ignored, except the quoted argument of `sh -c` or `bash -c`, which is read as a line of its own;
 * the words from the first one that starts with `#` are a shell comment and are dropped; the line is
 * split on `|`, `;`, `&` and `$(`; each part skips leading `VAR=value` words and `env`. The command
 * is `wc`, bare or with a path; or `xargs`, or `docker` or `podman` followed by `run` or `exec`,
 * with a later word that is `wc` followed by the flag. Every other part is read as is
 * (`packages/factory-tools/README.md`).
 */
function runsWordCount(line: string): boolean {
  const quoted: string[] = []
  const unquoted = line.replace(
    /"([^"]*)"|'([^']*)'/g,
    (_all, double?: string, single?: string) => {
      quoted.push(double ?? single ?? '')
      return `"Q${quoted.length - 1}"`
    }
  )
  const comment = /(^|\s)#/.exec(unquoted)
  const code = comment === null ? unquoted : unquoted.slice(0, comment.index + comment[1]!.length)
  return code.split(COMMAND_BREAK).some((part) => {
    const words = (part.split('`')[part.startsWith('`') ? 1 : 0] ?? '')
      .replace(/^\s*\$\s+/, '')
      .replace(/\)+\s*$/, '')
      .split(/\s+/)
      .filter((word) => word !== '')
    let i = 0
    while (i < words.length && (words[i] === 'env' || /^[A-Za-z_]\w*=/.test(words[i] ?? ''))) i++
    const command = words[i]?.split('/').at(-1)
    const rest = words.slice(i + 1)
    if (command === 'wc') return rest.some(isWordsFlag)
    const wrapper =
      command === 'xargs' ||
      ((command === 'docker' || command === 'podman') && (rest[0] === 'run' || rest[0] === 'exec'))
    if (wrapper) {
      const at = rest.findIndex((word) => word.split('/').at(-1) === 'wc')
      return at !== -1 && rest.slice(at + 1).some(isWordsFlag)
    }
    if (command === 'sh' || command === 'bash') {
      const flag = rest.findIndex((word) => /^-[a-zA-Z]*c$/.test(word))
      const text = /^"Q(\d+)"$/.exec(rest[flag + 1] ?? '')?.[1]
      return flag !== -1 && text !== undefined && runsWordCount(quoted[Number(text)] ?? '')
    }
    return false
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

/** A round named in a Tests entry or in the line above a fenced block: `round 2`. */
const ROUND = /\brounds?\s+\d+/i

/** The files an entry or block names: each `logs/<file>` and each path that ends `.png`. */
function namedFiles(text: string): string[] {
  const names = [
    ...(text.match(/\blogs\/[^\s`),;]+/g) ?? []),
    ...(text.match(/[^\s`(),;"']+\.png\b/g) ?? []),
  ].map((name) => name.replace(/[.:]+$/, '').replace(/^\.?\/+/, ''))
  return [...new Set(names)]
}

/**
 * What the "Tests" section names as evidence, with the line to blame and whether the entry is
 * exempt: a run shown failing without the change, or an entry (or the line above its block) that
 * names its round.
 */
function evidenceItems(draft: string): { line: string; names: string[]; exempt: boolean }[] {
  const items: { line: string; names: string[]; exempt: boolean }[] = []
  for (const block of testsBlocks(draft)) {
    const failing = WITHOUT_CHANGE.test(block.intro)
    const named = block.lines.join(' ')
    items.push({
      line: (block.lines[0] ?? '').replace(/^\$\s+/, ''),
      names: namedFiles(named),
      exempt: failing || ROUND.test(block.intro),
    })
  }
  for (const entry of testsEntries(draft) ?? []) {
    const parsed = /^`([^`]+)`(.*)$/.exec(entry.text)
    const failing =
      (WITHOUT_CHANGE.test(entry.text) || WITHOUT_CHANGE.test(entry.intro)) &&
      EXIT.exec(parsed?.[2] ?? '')?.[1] !== '0'
    items.push({
      line: (parsed?.[1] ?? entry.text).trim(),
      names: namedFiles(entry.text),
      exempt: failing || ROUND.test(entry.text),
    })
  }
  return items
}

/** The files the "Tests" section names whose times the rule needs (`runLintDraft` reads them). */
export function evidenceNames(draft: string): string[] {
  return [
    ...new Set(
      evidenceItems(draft)
        .filter((item) => !item.exempt)
        .flatMap((item) => item.names)
    ),
  ]
}

const iso = (ms: number): string => new Date(ms).toISOString()

/**
 * One problem for each log or image a "Tests" entry names that is older than the newest file the
 * diff changes, unless the entry names its round (`G2.6`). Skipped without both sets of times.
 */
function staleEvidenceProblems(
  draft: string,
  evidence: Record<string, number> | undefined,
  changed: Record<string, number> | undefined
): DraftProblem[] {
  if (evidence === undefined || changed === undefined) return []
  const newest = Object.entries(changed).reduce<[string, number] | null>(
    (best, entry) => (best === null || entry[1] > best[1] ? entry : best),
    null
  )
  if (newest === null) return []
  const problems: DraftProblem[] = []
  for (const item of evidenceItems(draft)) {
    if (item.exempt) continue
    for (const name of item.names) {
      const time = evidence[name]
      if (time === undefined || time >= newest[1]) continue
      problems.push({
        line: item.line,
        problem: `\`${name}\` (${iso(time)}) is older than \`${newest[0]}\` (${iso(newest[1])}), a file the diff changes (G2.6): run the command again, or name its round as "round <k>" in the entry`,
      })
    }
  }
  return problems
}

/** The log an entry names, as the file after `logs/` (`npm-test.log`); `undefined` when it names none. */
function namedLog(summary: string): string | undefined {
  return LOG.exec(summary)?.[1]
    ?.replace(/[.:]+$/, '')
    .replace(/^\.?\/+/, '')
}

/** The logs the figures rule needs (`runLintDraft` reads them): those named by an entry that is not a run shown failing. */
export function figureLogNames(draft: string): string[] {
  const names: string[] = []
  for (const entry of testsEntries(draft) ?? []) {
    const parsed = /^`([^`]+)`(.*)$/.exec(entry.text)
    if (parsed === null) continue
    const summary = parsed[2] ?? ''
    if (
      (WITHOUT_CHANGE.test(entry.text) || WITHOUT_CHANGE.test(entry.intro)) &&
      EXIT.exec(summary)?.[1] !== '0'
    )
      continue
    const name = namedLog(summary)
    if (name !== undefined) names.push(name)
  }
  return [...new Set(names)]
}

/**
 * One problem for each figure of a "Tests" entry that the log the entry names does not hold, with
 * `verify-draft`'s rules (`figures` and `numbersBefore`): a word the log never counts is prose,
 * unless no figure of the line is counted at all. A run shown failing and a log that is not there
 * (`logProblems` reports it) are skipped, as is the whole rule without `logs`.
 */
function figureProblems(draft: string, logs: Record<string, string> | undefined): DraftProblem[] {
  if (logs === undefined) return []
  const problems: DraftProblem[] = []
  for (const entry of testsEntries(draft) ?? []) {
    const parsed = /^`([^`]+)`(.*)$/.exec(entry.text)
    if (parsed === null) continue
    const summary = parsed[2] ?? ''
    if (
      (WITHOUT_CHANGE.test(entry.text) || WITHOUT_CHANGE.test(entry.intro)) &&
      EXIT.exec(summary)?.[1] !== '0'
    )
      continue
    const name = namedLog(summary)
    const text = name === undefined ? undefined : logs[name]
    if (name === undefined || text === undefined) continue
    const counted = figures(summary).map(
      ([number, word]) => [number, word, numbersBefore(text, word)] as const
    )
    const compared = counted.some(([, , got]) => got.length > 0)
      ? counted.filter(([, , got]) => got.length > 0)
      : counted
    for (const [number, word, got] of compared) {
      if (got.includes(number)) continue
      problems.push({
        line: (parsed[1] ?? '').trim(),
        problem:
          got.length === 0
            ? `the figure "${number} ${word}" is not in \`logs/${name}\`: it has no "<n> ${word}"`
            : `the figure "${number} ${word}" is not in \`logs/${name}\`: it has ${[...new Set(got)].join(' or ')}`,
      })
    }
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
    ...staleEvidenceProblems(draft, context.evidenceTimes, context.changedTimes),
    ...figureProblems(draft, context.logContents),
    ...(context.issue === undefined
      ? []
      : namedTestProblems(context.issue, context.testSources ?? {})),
  ]
}

/** The heading of the issue's section that lists the criteria. */
const CRITERIA = 'Acceptance criteria'

/** A criterion names a test as a test file, then the name in double quotes, all in backticks. */
const NAMED_TEST = /`([^\s`]+) > "(.*?)"`/g

/**
 * The test files and names the criteria of an issue's body give (a file and a name), with
 * the item each comes from, in order.
 *
 * @param issue - The issue's body.
 */
export function namedTests(issue: string): { item: string; file: string; name: string }[] {
  const named: { item: string; file: string; name: string }[] = []
  for (const item of sectionLines(issue, CRITERIA) ?? []) {
    for (const match of item.matchAll(NAMED_TEST)) {
      named.push({ item, file: match[1] ?? '', name: match[2] ?? '' })
    }
  }
  return named
}

/** The value of the escape that starts at `text[i]` (after the backslash) and where it ends. */
function unescape(text: string, i: number): { value: string; end: number } {
  const c = text[i] ?? ''
  const simple: Record<string, string> = {
    n: '\n',
    t: '\t',
    r: '\r',
    b: '\b',
    f: '\f',
    v: '\v',
    '0': '\0',
  }
  if (c === 'x' && /^[0-9a-fA-F]{2}/.test(text.slice(i + 1, i + 3))) {
    return { value: String.fromCharCode(parseInt(text.slice(i + 1, i + 3), 16)), end: i + 3 }
  }
  if (c === 'u') {
    const braced = /^\{([0-9a-fA-F]+)\}/.exec(text.slice(i + 1))
    if (braced) {
      return {
        value: String.fromCodePoint(parseInt(braced[1] ?? '0', 16)),
        end: i + 1 + braced[0].length,
      }
    }
    if (/^[0-9a-fA-F]{4}/.test(text.slice(i + 1, i + 5))) {
      return { value: String.fromCharCode(parseInt(text.slice(i + 1, i + 5), 16)), end: i + 5 }
    }
  }
  return { value: simple[c] ?? c, end: i + 1 }
}

/**
 * The string literal that starts at `source[at]` (a quote) when it is the whole first argument: its
 * value and the index after it, or `null` for a template with `${`, or a literal that is followed
 * by anything but `,` or `)`.
 */
function stringLiteralAt(source: string, at: number): { value: string; end: number } | null {
  const quote = source[at]
  let value = ''
  let i = at + 1
  while (i < source.length) {
    const c = source[i] ?? ''
    if (c === '\\') {
      const escape = unescape(source, i + 1)
      value += escape.value
      i = escape.end
      continue
    }
    if (c === quote) {
      const after = /^\s*([,)])/.exec(source.slice(i + 1))
      return after ? { value, end: i + 1 } : null
    }
    if (quote === '`' && c === '$' && source[i + 1] === '{') return null
    if (c === '\n' && quote !== '`') return null
    value += c
    i++
  }
  return null
}

/** The index after the bracket group that opens at `source[at]`, skipping the strings in it; `-1` when it never closes. */
function skipGroup(source: string, at: number): number {
  let depth = 0
  for (let i = at; i < source.length; i++) {
    const c = source[i] ?? ''
    if (c === "'" || c === '"' || c === '`') {
      for (i++; i < source.length && source[i] !== c; i++) if (source[i] === '\\') i++
    } else if ('([{'.includes(c)) depth++
    else if (')]}'.includes(c) && --depth === 0) return i + 1
  }
  return -1
}

/**
 * The titles of the tests of a file: the first argument, when it is a string literal, of each call
 * `it(`, `test(`, `it.each(…)(` and `test.each(…)(`; `.skip`, `.todo` and the rest are not read.
 *
 * @param source - The text of a test file.
 */
export function testTitles(source: string): string[] {
  const titles: string[] = []
  for (const call of source.matchAll(/(?<![\w$.])(?:it|test)(\.each)?\s*(?=[(`])/g)) {
    let at = (call.index ?? 0) + call[0].length
    if (call[1] !== undefined) {
      at = skipGroup(source, at)
      if (at === -1) continue
      while (/\s/.test(source[at] ?? '')) at++
    }
    if (source[at] !== '(') continue
    at++
    while (/\s/.test(source[at] ?? '')) at++
    if (!'\'"`'.includes(source[at] ?? '\0')) continue
    const literal = stringLiteralAt(source, at)
    if (literal) titles.push(literal.value)
  }
  return titles
}

/** Each named test of the issue's criteria whose file is missing or holds no title equal to the name. */
function namedTestProblems(issue: string, sources: Record<string, string>): DraftProblem[] {
  const problems: DraftProblem[] = []
  for (const { item, file, name } of namedTests(issue)) {
    const source = sources[file]
    if (source === undefined) {
      problems.push({
        line: item,
        problem: `the test file ${file} that the criterion names does not exist (test "${name}")`,
      })
    } else if (!testTitles(source).includes(name)) {
      problems.push({
        line: item,
        problem: `no test of ${file} has the title "${name}", byte for byte, that the criterion names`,
      })
    }
  }
  return problems
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
      const fix = context.home === true ? homeFix(subject, context.synced) : null
      if (fix !== null) {
        problems.push({
          line,
          problem: `${subject} is a file micelio-engineering owns: ${fix}, do not report it`,
        })
      } else if (isOwn(subject, context.synced)) {
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
  /** Whether the worktree is `micelio-engineering`: it has `.github/standard-sync.json`. Optional; left out, false. */
  home?: () => Promise<boolean>
  /** The files under a logs directory, relative to it, in any depth. Optional; used with `--logs`. */
  logFiles?: (dir: string) => Promise<string[]>
  /**
   * The modification times (ms) of the files `names` the draft writes, read under the packet
   * directory that holds `dir` (`<dir>/..`); a file that is not there has no key. Optional; used with `--logs`.
   */
  evidenceTimes?: (dir: string, names: string[]) => Promise<Record<string, number>>
  /** The modification times (ms) of the files `git diff --name-only <base>` lists and of the untracked files git does not ignore, by path. Optional; used with `--logs`. */
  changedTimes?: (base: string) => Promise<Record<string, number>>
  /** The text of the logs `names` (files under `dir`, as the draft writes them after `logs/`); a log that is not there has no key. Optional; used with `--logs`. */
  logContents?: (dir: string, names: string[]) => Promise<Record<string, string>>
  /** The text of the test files `paths` (relative to the worktree); a file that is not there, or outside it, has no key. Optional; used with `--issue`. */
  testSources?: (paths: string[]) => Promise<Record<string, string>>
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
    home: async () => {
      try {
        await access(join(cwd, '.github/standard-sync.json'))
        return true
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
        throw error
      }
    },
    logFiles: async (dir) =>
      (await readdir(dir, { recursive: true, withFileTypes: true }))
        .filter((entry) => entry.isFile())
        .map((entry) => relative(dir, join(entry.parentPath, entry.name))),
    evidenceTimes: async (dir, names) => {
      const packet = dirname(resolve(dir))
      const times: Record<string, number> = {}
      for (const name of names) {
        try {
          times[name] = (await stat(join(packet, name))).mtimeMs
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        }
      }
      return times
    },
    changedTimes: async (base) => {
      const tracked = await exec('git', ['diff', '--name-only', base], { cwd })
      const untracked = await exec('git', ['ls-files', '--others', '--exclude-standard'], { cwd })
      const paths = [...tracked.stdout.split('\n'), ...untracked.stdout.split('\n')].filter(
        (line) => line !== ''
      )
      const times: Record<string, number> = {}
      for (const path of paths) {
        try {
          times[path] = (await stat(join(cwd, path))).mtimeMs
        } catch (error) {
          // a file the diff deletes has no time
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        }
      }
      return times
    },
    logContents: async (dir, names) => {
      const texts: Record<string, string> = {}
      for (const name of names) {
        try {
          texts[name] = await readFile(join(dir, name), 'utf8')
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        }
      }
      return texts
    },
    testSources: async (paths) => {
      const texts: Record<string, string> = {}
      for (const path of paths) {
        const full = resolve(cwd, path)
        if (relative(cwd, full).startsWith('..') || full === resolve(cwd)) continue
        try {
          texts[path] = await readFile(full, 'utf8')
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code
          if (code !== 'ENOENT' && code !== 'EISDIR') throw error
        }
      }
      return texts
    },
    syncedFiles: async () => {
      const json = JSON.parse(await readFile(syncList, 'utf8')) as { files?: unknown }
      if (!Array.isArray(json.files)) throw new Error('.github/standard-sync.json has no "files"')
      return json.files.filter((file): file is string => typeof file === 'string')
    },
  }
}

const USAGE =
  'Usage:\n  factory-tools lint-draft --file <draft> --base <ref> [--logs <dir>] [--issue <file>]\n'

/**
 * `factory-tools lint-draft --file <draft> --base <ref> [--logs <dir>] [--issue <file>]`: run in the worktree of the draft, with
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
    if (!['--file', '--base', '--logs', '--issue'].includes(name) || value === undefined) {
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
  const issueFile = values.get('--issue')
  try {
    const draft = await deps.readText(file)
    const issue = issueFile === undefined ? undefined : await deps.readText(issueFile)
    const problems = lintDraft(draft, {
      changed: await deps.diffNames(base),
      synced: await deps.syncedFiles(),
      editedTests: (await deps.editedTests?.(base)) ?? [],
      checkCommand: (await deps.checkCommand?.()) ?? null,
      home: (await deps.home?.()) ?? false,
      ...(logs === undefined || deps.logFiles === undefined
        ? {}
        : { logFiles: await deps.logFiles(logs) }),
      ...(issue === undefined
        ? {}
        : {
            issue,
            testSources: await (deps.testSources?.(namedTests(issue).map((n) => n.file)) ?? {}),
          }),
      ...(logs === undefined || deps.logContents === undefined
        ? {}
        : { logContents: await deps.logContents(logs, figureLogNames(draft)) }),
      ...(logs === undefined || deps.evidenceTimes === undefined || deps.changedTimes === undefined
        ? {}
        : {
            evidenceTimes: await deps.evidenceTimes(logs, evidenceNames(draft)),
            changedTimes: await deps.changedTimes(base),
          }),
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
