import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { errorLine } from './errors.js'
import { OWNER_REPO, issueFromGh, issueFromMarkdown, parseTarget } from './issue.js'
import type { Issue, IssueRef } from './issue.js'
import { report } from './report.js'
import { lintIssue } from './rules.js'
import type { IssueClosed } from './rules.js'

/** What `run` needs from the outside world, so that tests can replace the network and the clock. */
export interface RunDeps {
  /** Reads an issue with `gh issue view --json`. */
  readIssue: (ref: IssueRef) => Promise<Issue>
  isClosed: IssueClosed
  /** Reads a file given with `--file`, relative to the working directory. */
  readText: (path: string) => Promise<string>
  /** The day of the run, `YYYY-MM-DD`. */
  today: () => string
}

/** The outcome of a run: the exit code and what goes to standard output and standard error. */
export interface RunResult {
  /** 0 when every rule passes, 1 when one fails, 2 on a usage or read error. */
  code: 0 | 1 | 2
  stdout: string
  stderr: string
}

const USAGE = `Usage:
  factory-tools lint-issue <owner/repo#n>
  factory-tools lint-issue --file <path> [--repo <owner/repo>]
`

/**
 * Runs `factory-tools` with its arguments, without touching the process.
 *
 * @param argv - The arguments after the program name, starting with the command.
 */
export async function run(argv: string[], deps: RunDeps = defaultDeps): Promise<RunResult> {
  const [command, ...args] = argv
  if (command !== 'lint-issue') return usage(command ? `unknown command "${command}"` : '')
  const options = parseArgs(args)
  if (typeof options === 'string') return usage(options)
  let issue: Issue
  try {
    issue =
      'file' in options
        ? issueFromMarkdown(await deps.readText(options.file), options.repo)
        : await deps.readIssue(options.ref)
  } catch (error) {
    return { code: 2, stdout: '', stderr: `error: ${errorLine(error)}\n` }
  }
  const results = await lintIssue(issue, deps.isClosed)
  const target = 'file' in options ? options.file : `${options.ref.repo}#${options.ref.number}`
  return {
    code: results.every((item) => item.ok) ? 0 : 1,
    stdout: report(target, deps.today(), results),
    stderr: '',
  }
}

const exec = promisify(execFile)

async function gh(ref: IssueRef, fields: string): Promise<unknown> {
  const args = ['issue', 'view', String(ref.number), `--repo=${ref.repo}`, '--json', fields]
  const { stdout } = await exec('gh', args)
  return JSON.parse(stdout) as unknown
}

const defaultDeps: RunDeps = {
  readIssue: async (ref) => issueFromGh(await gh(ref, 'title,body'), ref.repo),
  isClosed: async (ref) => {
    const json = await gh(ref, 'state')
    const state = typeof json === 'object' && json !== null && 'state' in json ? json.state : null
    if (typeof state !== 'string') throw new Error('gh printed no state')
    return state === 'CLOSED'
  },
  readText: (path) => readFile(path, 'utf8'),
  today: () => new Date().toISOString().slice(0, 10),
}

type Options = { ref: IssueRef } | { file: string; repo: string | null }

function parseArgs(args: string[]): Options | string {
  let file: string | null = null
  let repo: string | null = null
  const positional: string[] = []
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? ''
    if (arg === '--file' || arg === '--repo') {
      const value = args[++i]
      if (value === undefined) return `${arg} needs a value`
      if (arg === '--file') file = value
      else repo = value
    } else {
      positional.push(arg)
    }
  }
  if (file !== null) {
    if (positional.length) return 'give either a target or --file, not both'
    if (repo !== null && !new RegExp(`^${OWNER_REPO}$`).test(repo))
      return `"${repo}" is not owner/repo`
    return { file, repo }
  }
  if (positional.length !== 1 || repo !== null) return 'give one target, owner/repo#n'
  const ref = parseTarget(positional[0] ?? '')
  return ref ? { ref } : `"${positional[0]}" is not owner/repo#n`
}

function usage(problem: string): RunResult {
  return { code: 2, stdout: '', stderr: `${problem ? `error: ${problem}\n` : ''}${USAGE}` }
}
