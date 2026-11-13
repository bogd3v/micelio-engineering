import { execFile } from 'node:child_process'
import { access, readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { errorLine } from './errors.js'

/** What `verifyDraft` needs from the outside world, so that tests can replace the disk and the commands. */
export interface VerifyDraftDeps {
  readText: (path: string) => Promise<string>
  exists: (path: string) => Promise<boolean>
  /** The `AGENTS.md` of the merge base (the clean copy's `HEAD`), not the one the diff may have changed. */
  baseAgents: (cwd: string) => Promise<string>
  /** Runs `file` with `args` in `cwd`, without a shell; `output` is standard output and standard error together. */
  exec: (file: string, args: string[], cwd: string) => Promise<{ code: number; output: string }>
}

/** The outcome of `runVerifyDraft`: 0 when nothing mismatches and a command ran, 1 when a command mismatches or none ran, 2 on a usage or read error. */
export interface VerifyDraftResult {
  code: 0 | 1 | 2
  stdout: string
  stderr: string
}

/** What one entry of the draft's Tests section came to. */
export type EntryOutcome =
  | { kind: 'match'; command: string }
  | { kind: 'mismatch'; command: string; reasons: string[] }
  | { kind: 'variance'; command: string; reported: string; got: string }
  | { kind: 'skipped'; command: string }
  | { kind: 'not-run'; command: string }
  | { kind: 'not-checked'; criterion: string }

/** The heading of the section the command reads, without the `#`s. */
export const TESTS_SECTION = 'Tests'

/** One item of the Tests section: a bullet (`- `, `* `) or a numbered item (`1. `, `1) `). */
interface Entry {
  text: string
  /** The nearest line above it that is not an item. */
  intro: string
}

const WITHOUT_CHANGE = /without the change/i
const VARIANCE = /\b(\d+)\s+failed\s+of\s+(\d+)\b/i
const EXIT = /\bexit(?:ed|s)?(?:\s+code)?\s+(\d+)/i
const LOG = /\blogs\/([^\s`),;]+)/
const NUMBER = String.raw`\d{1,3}(?:[ ,]\d{3})+|\d+`
const MAX_BUFFER = 256 * 1024 * 1024

/** The items of the Tests section, bullets and numbered, each with its continuation lines; `null` when there is no section. */
function testsEntries(draft: string): Entry[] | null {
  const lines = draft.split(/\r?\n/)
  const start = lines.findIndex((line) => /^#{1,6}\s+Tests\s*$/.test(line))
  if (start === -1) return null
  const level = /^#+/.exec(lines[start] ?? '')?.[0].length ?? 1
  const entries: Entry[] = []
  let intro = ''
  for (const line of lines.slice(start + 1)) {
    const heading = /^(#{1,6})\s/.exec(line)
    if (heading && (heading[1]?.length ?? 7) <= level) break
    const bullet = /^(?:[-*]|\d+[.)])\s+(.*)$/.exec(line)
    if (bullet) {
      entries.push({ text: (bullet[1] ?? '').trim(), intro })
    } else if (/^\s+\S/.test(line) && entries.length > 0) {
      const last = entries[entries.length - 1]
      if (last) last.text += ` ${line.trim()}`
    } else if (line.trim() !== '') {
      intro = line.trim()
    }
  }
  return entries
}

/**
 * The command a worker ran through the slot script: `<path>/factory-slot.sh run -- <command>` is
 * `<command>`. Only that prefix is removed; anything else is returned as it is, and the rest still
 * goes through `tokenize` and the repository's commands.
 */
export function withoutSlotPrefix(command: string): string {
  const prefixed = /^\S*factory-slot\.sh\s+run\s+--\s+(\S.*)$/.exec(command)
  return prefixed?.[1] ?? command
}

/** The command's words, or `null` when it has a shell construct (a pipe, `;`, `&&`, a redirection, `$(…)`, a backtick, a URL, a path outside the copy). */
export function tokenize(command: string): string[] | null {
  if (/:\/\//.test(command)) return null
  const tokens: string[] = []
  let current = ''
  let quote: string | null = null
  let started = false
  for (const char of command) {
    if (quote !== null) {
      if (char === quote) quote = null
      else current += char
    } else if (char === "'" || char === '"') {
      quote = char
      started = true
    } else if (/\s/.test(char)) {
      if (started) tokens.push(current)
      current = ''
      started = false
    } else if ('|;&<>$`()!\\'.includes(char)) {
      return null
    } else {
      current += char
      started = true
    }
  }
  if (quote !== null) return null
  if (started) tokens.push(current)
  if (tokens.some((token) => token.startsWith('/') || token.split('/').includes('..'))) return null
  return tokens.length > 0 ? tokens : null
}

/** The lines of the first `## Commands` block of `AGENTS.md`, as the words a command must start with. */
export function agentsCommands(agents: string): string[][] {
  const lines = agents.split('\n')
  const start = lines.findIndex((line) => /^##\s+Commands\s*$/.test(line))
  if (start === -1) return []
  const rest = lines.slice(start + 1)
  const open = rest.findIndex((line) => /^```/.test(line))
  if (open === -1) return []
  const close = rest.findIndex((line, i) => i > open && /^```/.test(line))
  const block = close === -1 ? rest.slice(open + 1) : rest.slice(open + 1, close)
  const commands: string[][] = []
  for (const line of block) {
    const text = line
      .replace(/\s+#.*$/, '')
      .replace(/^[a-z-]+:\s+/, '')
      .trim()
    if (text === '') continue
    const words: string[] = []
    for (const word of text.split(/\s+/)) {
      if (word.startsWith('<') || word.startsWith('[')) break
      words.push(word)
    }
    if (words.length > 0) commands.push(words)
  }
  return commands
}

/** The scripts of a `package.json`; empty when it has none or is not JSON. */
function manifestScripts(manifest: string): string[] {
  try {
    const json = JSON.parse(manifest) as { scripts?: unknown }
    return typeof json.scripts === 'object' && json.scripts !== null
      ? Object.keys(json.scripts)
      : []
  } catch {
    return []
  }
}

/** Whether the words are a repository command: a line of `AGENTS.md` with its arguments, or a script of the manifest. */
function isRepositoryCommand(words: string[], agents: string[][], scripts: string[]): boolean {
  if (agents.some((own) => own.every((word, i) => words[i] === word))) return true
  if (words[0] !== 'npm') return false
  if (words[1] === 'test' || words[1] === 'start') return scripts.includes(words[1])
  return words[1] === 'run' && words[2] !== undefined && scripts.includes(words[2])
}

/** The figures a summary line reports: `482 tests`, `23 passed`, as `[number, word]`. */
function figures(summary: string): [string, string][] {
  const text = summary
    .replace(/`[^`]*`/g, ' ')
    .replace(/\bround\s+\d+/gi, ' ')
    .replace(VARIANCE, ' ')
    .replace(EXIT, ' ')
  const out: [string, string][] = []
  for (const match of text.matchAll(
    new RegExp(`(?<![\\w.])(${NUMBER})\\s+([A-Za-z][\\w-]*(?:\\s+files?\\b)?)`, 'g')
  )) {
    out.push([
      (match[1] ?? '').replace(/[ ,]/g, ''),
      (match[2] ?? '').toLowerCase().replace(/\s+/g, ' '),
    ])
  }
  return out
}

/**
 * The numbers the output of a run gives for `word`: the ones before it (`482 passed`) and the ones
 * after it as a label (`Tests  482 passed`, `Test Files  23 passed`, for `tests` and `test files`).
 */
function numbersBefore(output: string, word: string): string[] {
  const plain = output.replace(/\u001b\[[0-9;]*m/g, '')
  const parts = word.split(' ')
  const last = (parts.pop() ?? '').replace(/s$/, '')
  const name = [...parts, `${last}s?`].join('\\s+')
  const before = new RegExp(`(?<![\\w.])(${NUMBER})\\s+${name}\\b`, 'gi')
  const label = new RegExp(`^\\s*${name}\\s+(${NUMBER})\\b`, 'gim')
  return [...plain.matchAll(before), ...plain.matchAll(label)].map((m) =>
    (m[1] ?? '').replace(/[ ,]/g, '')
  )
}

/**
 * Reads the Tests section of a pull request draft, reruns each repository command in `cwd` and
 * compares its exit code and the figures of its summary line with the draft's.
 *
 * @param draft - The text of the pull request draft.
 * @param logs - The directory the draft's `logs/` files are in; `undefined` when there is none (a pull request's CI), and then a command with no log is not a mismatch.
 * @param cwd - The clean copy the commands run in.
 * @returns One outcome per bullet of the section; `null` when the draft has no Tests section.
 */
export async function verifyDraft(
  draft: string,
  logs: string | undefined,
  cwd: string,
  deps: VerifyDraftDeps
): Promise<EntryOutcome[] | null> {
  const entries = testsEntries(draft)
  if (entries === null) return null
  let manifest = ''
  try {
    manifest = await deps.readText(join(cwd, 'package.json'))
  } catch {
    manifest = ''
  }
  const agents = agentsCommands(await deps.baseAgents(cwd))
  const scripts = manifestScripts(manifest)
  const outcomes: EntryOutcome[] = []
  for (const entry of entries) {
    const parsed = /^`([^`]+)`(.*)$/.exec(entry.text)
    if (parsed === null) {
      if (!/^no test:/i.test(entry.text))
        outcomes.push({ kind: 'not-checked', criterion: entry.text })
      continue
    }
    const command = (parsed[1] ?? '').trim()
    const summary = parsed[2] ?? ''
    const exitReported = EXIT.exec(summary)?.[1]
    if (
      (WITHOUT_CHANGE.test(entry.text) || WITHOUT_CHANGE.test(entry.intro)) &&
      exitReported !== '0'
    ) {
      outcomes.push({ kind: 'skipped', command })
      continue
    }
    const logName = LOG.exec(summary)?.[1]
    const hasLog =
      logs === undefined ||
      (logName !== undefined && (await deps.exists(join(logs, basename(logName)))))
    const words = tokenize(withoutSlotPrefix(command))
    if (words === null || !isRepositoryCommand(words, agents, scripts)) {
      outcomes.push(
        hasLog ? { kind: 'not-run', command } : { kind: 'mismatch', command, reasons: ['no log'] }
      )
      continue
    }
    const [file = '', ...args] = words
    const variance = VARIANCE.exec(summary)
    if (variance) {
      if (!hasLog) {
        outcomes.push({ kind: 'mismatch', command, reasons: ['no log'] })
        continue
      }
      const runs = Number(variance[2])
      let failed = 0
      for (let i = 0; i < runs; i++) if ((await deps.exec(file, args, cwd)).code !== 0) failed++
      outcomes.push({
        kind: 'variance',
        command,
        reported: `${variance[1]} failed of ${variance[2]}`,
        got: `${failed} failed of ${runs}`,
      })
      continue
    }
    const reasons: string[] = hasLog ? [] : ['no log']
    const exit = EXIT.exec(summary)?.[1]
    const run = await deps.exec(file, args, cwd)
    if (exit === undefined) reasons.push('the draft gives no exit code')
    else if (Number(exit) !== run.code) reasons.push(`exit code: draft ${exit}, got ${run.code}`)
    for (const [number, word] of figures(summary)) {
      const got = numbersBefore(run.output, word)
      if (got.includes(number)) continue
      reasons.push(
        got.length === 0
          ? `${word}: draft ${number}, the output has no "<n> ${word}"`
          : `${word}: draft ${number}, got ${[...new Set(got)].join(' or ')}`
      )
    }
    outcomes.push(
      reasons.length === 0 ? { kind: 'match', command } : { kind: 'mismatch', command, reasons }
    )
  }
  return outcomes
}

/** The printed form of one outcome. */
function line(outcome: EntryOutcome): string {
  switch (outcome.kind) {
    case 'match':
      return `match: ${outcome.command}`
    case 'mismatch':
      return `mismatch: ${outcome.command}: ${outcome.reasons.join('; ')}`
    case 'variance':
      return `variance: ${outcome.command}: draft ${outcome.reported}, got ${outcome.got}`
    case 'skipped':
      return `skipped: ${outcome.command} (shown failing without the change)`
    case 'not-run':
      return `not run: ${outcome.command}`
    case 'not-checked':
      return `not checked: ${outcome.criterion}`
  }
}

const exec = (
  file: string,
  args: string[],
  cwd: string
): Promise<{ code: number; output: string }> =>
  new Promise<{ code: number; output: string }>((resolve) => {
    execFile(file, args, { cwd, maxBuffer: MAX_BUFFER }, (error, stdout, stderr) => {
      const code = error === null ? 0 : typeof error.code === 'number' ? error.code : 1
      resolve({ code, output: `${stdout}${stderr}` })
    })
  })

/** The real dependencies: the disk and `execFile`. */
export const defaultVerifyDeps: VerifyDraftDeps = {
  readText: (path) => readFile(path, 'utf8'),
  exists: async (path) => {
    try {
      await access(path)
      return true
    } catch {
      return false
    }
  },
  baseAgents: async (cwd) => {
    const { code, output } = await exec('git', ['show', 'HEAD:AGENTS.md'], cwd)
    if (code !== 0) {
      throw new Error(
        `${cwd} has no AGENTS.md at HEAD: --cwd must be a clean copy at the merge base`
      )
    }
    return output
  },
  exec,
}

const NO_COMMAND_RAN =
  'no command ran: gate 4 of the normal lane needs at least one repository command in the Tests section'

const USAGE =
  'Usage:\n  factory-tools verify-draft --draft <file> [--logs <dir>] [--cwd <clean copy>]\n'

/**
 * `factory-tools verify-draft --draft <file> [--logs <dir>] [--cwd <clean copy>]`: the script that
 * stands in for the verifier in the `normal` lane. It prints one line per bullet of the Tests
 * section and a verdict line, `Red` when no command ran. Without `--logs` it prints `logs: not checked` before the verdict.
 *
 * @param argv - The arguments after the program name, starting with `verify-draft`.
 */
export async function runVerifyDraft(
  argv: string[],
  deps: VerifyDraftDeps = defaultVerifyDeps,
  defaultCwd: string = process.cwd()
): Promise<VerifyDraftResult> {
  const values = new Map<string, string>()
  const args = argv.slice(1)
  for (let i = 0; i < args.length; i++) {
    const name = args[i] ?? ''
    const value = args[i + 1]
    if (!['--draft', '--logs', '--cwd'].includes(name) || value === undefined) {
      return { code: 2, stdout: '', stderr: `error: bad argument "${name}"\n${USAGE}` }
    }
    values.set(name, value)
    i++
  }
  const draft = values.get('--draft')
  const logs = values.get('--logs')
  if (draft === undefined) {
    return { code: 2, stdout: '', stderr: `error: verify-draft needs --draft\n${USAGE}` }
  }
  try {
    const outcomes = await verifyDraft(
      await deps.readText(draft),
      logs,
      values.get('--cwd') ?? defaultCwd,
      deps
    )
    if (outcomes === null) {
      return { code: 2, stdout: '', stderr: `error: ${draft} has no "${TESTS_SECTION}" section\n` }
    }
    const mismatches = outcomes.filter((outcome) => outcome.kind === 'mismatch').length
    const ran = outcomes.some((outcome) => ['match', 'mismatch', 'variance'].includes(outcome.kind))
    const red = mismatches > 0 || !ran
    const verdict = `Verdict: ${red ? 'Red' : 'Pass'} · ${mismatches} mismatches`
    return {
      code: red ? 1 : 0,
      stdout: `${outcomes.map((outcome) => `${line(outcome)}\n`).join('')}${
        logs === undefined ? 'logs: not checked\n' : ''
      }${ran ? '' : `${NO_COMMAND_RAN}\n`}${verdict}\n`,
      stderr: '',
    }
  } catch (error) {
    return { code: 2, stdout: '', stderr: `error: ${errorLine(error)}\n` }
  }
}
