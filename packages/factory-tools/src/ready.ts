import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { errorLine } from './errors.js'
import { parseTarget } from './issue.js'
import type { IssueRef } from './issue.js'

/** Hidden in the first line of the comment, so the next run finds it and updates it in place. */
export const MARKER = '<!-- micelio:issue-ready -->'

/** The label that marks an issue that passed the Definition of Ready. */
export const READY_LABEL = 'ready'

const LABEL_COLOR = '0e8a16'
const LABEL_DESCRIPTION = 'Passes the Definition of Ready (lint-issue); a worker can start it'

/** The GitHub calls `issue-ready` makes, so that tests can replace the network. */
export interface Gh {
  /** A REST call; the path starts with `/`. Throws a `GhError` when GitHub answers an error. */
  rest: (
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    body?: unknown
  ) => Promise<unknown>
  /** A GraphQL call; throws a `GhError` when the response has `errors`. */
  graphql: (query: string, variables: Record<string, unknown>) => Promise<unknown>
}

/** An error answered by GitHub. */
export class GhError extends Error {
  /** The HTTP status, or `null` for a GraphQL error or a failure to run `gh`. */
  readonly status: number | null

  constructor(message: string, status: number | null) {
    super(message)
    this.name = 'GhError'
    this.status = status
  }
}

/** What to do with one issue. */
export interface ReadyParams {
  ref: IssueRef
  /** Whether `lint-issue` passed every rule. */
  passed: boolean
  /** The Markdown report of `lint-issue`. */
  report: string
  /** The organisation project, as its owner and number. */
  project: { owner: string; number: number }
  /** The Status option that means "can start now". */
  readyStatus: string
  /** The Status an issue starts in, which a pass moves to the ready option. A fail never sets it. */
  notReadyStatus: string
  /** The login that owns the comment, `<app slug>[bot]`: a comment from anyone else is never edited. */
  author: string
  /** `author_association` of the issue's author, as GitHub reports it. */
  association: string
  /** `open` or `closed`. */
  state: string
}

/** Who can put an issue in the "can start now" view: the people who work on the repository. */
export const TRUSTED_ASSOCIATIONS = ['OWNER', 'MEMBER', 'COLLABORATOR']

/** The comment that carries the marker, as the API lists it. */
interface Comment {
  id: number
  body: string
  login: string
}

/** One Status option of the project, by the name it has in the project settings. */
interface StatusField {
  projectId: string
  fieldId: string
  options: Map<string, string>
}

/**
 * Turns the result of `lint-issue` into a label, a comment and a project Status, and returns one
 * line per thing it did. Every step is idempotent, so editing an issue again changes nothing it
 * already changed (the report carries the date, so an unchanged comment holds within a day). It
 * never edits the issue body and never touches another field of the project.
 *
 * - Not trusted: an issue that is closed, or whose author is not an owner, member or collaborator,
 *   is skipped without a call that writes.
 * - Pass: adds `ready`, updates the comment if there is one (never creates it), adds the issue to
 *   the project and sets Status to the ready option when it has none or is on the not-ready one.
 * - Fail: removes `ready`, creates or updates the comment and, only if the issue is already an item
 *   of the project on the ready option, sets its Status to the not-ready option (Todo). It never adds an issue to the project.
 *   An issue In Progress or Done keeps its Status: moving it is not this workflow's job.
 *
 * The Status field and its options are found by name. A missing option fails before anything is
 * changed. `@` mentions and images in the report are neutralised in the comment.
 */
export async function applyReadiness(gh: Gh, params: ReadyParams): Promise<string[]> {
  const { ref, passed } = params
  if (params.state !== 'open') return [`skipped: the issue is ${params.state}`]
  if (!TRUSTED_ASSOCIATIONS.includes(params.association))
    return [`skipped: the author is not a member (${params.association})`]
  const done: string[] = []
  const status = await findStatus(gh, params)

  await ensureLabel(gh, ref.repo, done)
  const issues = `/repos/${ref.repo}/issues/${ref.number}`
  if (passed) {
    await gh.rest('POST', `${issues}/labels`, { labels: [READY_LABEL] })
    done.push(`label ${READY_LABEL} added`)
  } else {
    await removeLabel(gh, issues)
    done.push(`label ${READY_LABEL} removed`)
  }

  const comment = await findComment(gh, issues, params.author)
  const body = `${MARKER}\n${neutralise(params.report)}`
  if (comment) {
    if (comment.body === body) {
      done.push('comment unchanged')
    } else {
      await gh.rest('PATCH', `/repos/${ref.repo}/issues/comments/${comment.id}`, { body })
      done.push('comment updated')
    }
  } else if (!passed) {
    await gh.rest('POST', `${issues}/comments`, { body })
    done.push('comment created')
  }

  done.push(await setStatus(gh, params, status))
  return done
}

/**
 * The report echoes text of the issue, and the bot posts it: `&` and `<` are escaped so raw HTML does not render and `&#64;` stays text, and a zero-width joiner stops `@user` and
 * `@org/team` from notifying anyone and `![` from rendering an image under the bot's name.
 */
export function neutralise(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/@/g, '@\u200d')
    .replace(/!\[/g, '!\u200d[')
}

/** Finds the project, its Status field and the two options by name; throws if one is missing. */
async function findStatus(gh: Gh, params: ReadyParams): Promise<StatusField> {
  const { owner, number } = params.project
  const data = await gh.graphql(PROJECT_QUERY, { owner, number })
  const project = at(data, 'organization', 'projectV2')
  if (!isRecord(project)) throw new Error(`project ${owner}/${number} not found or not readable`)
  const projectId = at(project, 'id')
  const nodes = at(project, 'fields', 'nodes')
  if (typeof projectId !== 'string' || !Array.isArray(nodes))
    throw new Error(`project ${owner}/${number}: unexpected response`)
  const field = nodes.find((node) => isRecord(node) && node.name === 'Status')
  const fieldId = at(field, 'id')
  const options = at(field, 'options')
  if (typeof fieldId !== 'string' || !Array.isArray(options))
    throw new Error(`project ${owner}/${number} has no single-select field named "Status"`)
  const byName = new Map<string, string>()
  for (const option of options) {
    const id = at(option, 'id')
    const name = at(option, 'name')
    if (typeof id === 'string' && typeof name === 'string') byName.set(name, id)
  }
  for (const name of [params.readyStatus, params.notReadyStatus]) {
    if (!byName.has(name)) {
      const known = [...byName.keys()].join(', ')
      throw new Error(
        `the Status of project ${owner}/${number} has no option "${name}" (it has: ${known}); add it in the project settings`
      )
    }
  }
  return { projectId, fieldId, options: byName }
}

async function ensureLabel(gh: Gh, repo: string, done: string[]): Promise<void> {
  try {
    await gh.rest('GET', `/repos/${repo}/labels/${READY_LABEL}`)
  } catch (error) {
    if (!(error instanceof GhError) || error.status !== 404) throw error
    try {
      await gh.rest('POST', `/repos/${repo}/labels`, {
        name: READY_LABEL,
        color: LABEL_COLOR,
        description: LABEL_DESCRIPTION,
      })
      done.push(`label ${READY_LABEL} created`)
    } catch (created) {
      // Another issue's run created it first.
      if (!(created instanceof GhError) || created.status !== 422) throw created
    }
  }
}

async function removeLabel(gh: Gh, issues: string): Promise<void> {
  try {
    await gh.rest('DELETE', `${issues}/labels/${READY_LABEL}`)
  } catch (error) {
    // The issue did not have it.
    if (!(error instanceof GhError) || error.status !== 404) throw error
  }
}

/** The marked comment written by `author`, looking through every page. */
async function findComment(gh: Gh, issues: string, author: string): Promise<Comment | null> {
  for (let page = 1; ; page++) {
    const data = await gh.rest('GET', `${issues}/comments?per_page=100&page=${page}`)
    if (!Array.isArray(data)) throw new Error('unexpected comments response')
    for (const item of data) {
      const id = at(item, 'id')
      const body = at(item, 'body')
      const login = at(item, 'user', 'login')
      if (
        typeof id === 'number' &&
        typeof body === 'string' &&
        login === author &&
        body.startsWith(MARKER)
      )
        return { id, body, login }
    }
    if (data.length < 100) return null
  }
}

async function setStatus(gh: Gh, params: ReadyParams, status: StatusField): Promise<string> {
  const { ref, passed } = params
  const issue = await gh.graphql(ISSUE_QUERY, {
    owner: ref.repo.split('/')[0],
    name: ref.repo.split('/')[1],
    number: ref.number,
  })
  const issueId = at(issue, 'repository', 'issue', 'id')
  if (typeof issueId !== 'string') throw new Error(`issue ${ref.repo}#${ref.number} not found`)
  const readyId = status.options.get(params.readyStatus)

  if (!passed) {
    // A fail never adds the issue: only an item that is Ready is taken out of the "can start" view.
    const items = at(issue, 'repository', 'issue', 'projectItems', 'nodes')
    const own = Array.isArray(items)
      ? items.find((item) => at(item, 'project', 'id') === status.projectId)
      : undefined
    const itemId = at(own, 'id')
    if (typeof itemId !== 'string') return 'not in the project, left alone'
    const current = await gh.graphql(ITEM_QUERY, { item: itemId })
    if (at(current, 'node', 'fieldValueByName', 'optionId') !== readyId)
      return `status left as it is (${String(at(current, 'node', 'fieldValueByName', 'name') ?? 'none')})`
    await gh.graphql(SET_STATUS, {
      project: status.projectId,
      item: itemId,
      field: status.fieldId,
      option: status.options.get(params.notReadyStatus),
    })
    return `status set to ${params.notReadyStatus}`
  }

  // Adding an issue that is already in the project returns its existing item.
  const added = await gh.graphql(ADD_ITEM, { project: status.projectId, content: issueId })
  const itemId = at(added, 'addProjectV2ItemById', 'item', 'id')
  if (typeof itemId !== 'string') throw new Error('the project did not return the item')

  const current = await gh.graphql(ITEM_QUERY, { item: itemId })
  const optionId = at(current, 'node', 'fieldValueByName', 'optionId')
  // Only a new item or one in the starting state moves; nothing set by hand or by the project's own
  // workflows (In Progress, Done) is overwritten.
  const from = status.options.get(params.notReadyStatus)
  if (optionId === readyId) return `status already ${params.readyStatus}`
  if (typeof optionId === 'string' && optionId !== from)
    return `status left as it is (${String(at(current, 'node', 'fieldValueByName', 'name'))})`
  await gh.graphql(SET_STATUS, {
    project: status.projectId,
    item: itemId,
    field: status.fieldId,
    option: readyId,
  })
  return `status set to ${params.readyStatus}`
}

const PROJECT_QUERY = `query($owner: String!, $number: Int!) {
  organization(login: $owner) {
    projectV2(number: $number) {
      id
      fields(first: 50) {
        nodes { ... on ProjectV2SingleSelectField { id name options { id name } } }
      }
    }
  }
}`

const ISSUE_QUERY = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    issue(number: $number) { id projectItems(first: 20) { nodes { id project { id } } } }
  }
}`

const ADD_ITEM = `mutation($project: ID!, $content: ID!) {
  addProjectV2ItemById(input: { projectId: $project, contentId: $content }) { item { id } }
}`

const ITEM_QUERY = `query($item: ID!) {
  node(id: $item) {
    ... on ProjectV2Item {
      fieldValueByName(name: "Status") {
        ... on ProjectV2ItemFieldSingleSelectValue { optionId name }
      }
    }
  }
}`

const SET_STATUS = `mutation($project: ID!, $item: ID!, $field: ID!, $option: String!) {
  updateProjectV2ItemFieldValue(input: {
    projectId: $project, itemId: $item, fieldId: $field,
    value: { singleSelectOptionId: $option }
  }) { projectV2Item { id } }
}`

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** `value.a.b…` when every step is an object, otherwise `undefined`. */
function at(value: unknown, ...keys: string[]): unknown {
  let current = value
  for (const key of keys) {
    if (!isRecord(current)) return undefined
    current = current[key]
  }
  return current
}

/** `gh api`, with the body on standard input so nothing from the issue reaches the command line. */
function ghApi(args: string[], input: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const child = spawn('gh', ['api', ...args, '--input', '-'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 30_000,
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()))
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()))
    child.on('error', (error) => reject(new GhError(errorLine(error), null)))
    child.on('close', (code) => {
      if (code !== 0) {
        const status = /HTTP (\d{3})/.exec(stderr)
        reject(new GhError(errorLine({ stderr }), status ? Number(status[1]) : null))
        return
      }
      resolve(stdout.trim() ? (JSON.parse(stdout) as unknown) : null)
    })
    child.stdin.end(JSON.stringify(input ?? {}))
  })
}

/** The real thing: `gh api` with `GH_TOKEN` in the environment. */
export const defaultGh: Gh = {
  rest: (method, path, body) => ghApi(['--method', method, path], body),
  graphql: async (query, variables) => {
    const data = await ghApi(['graphql'], { query, variables })
    const errors = at(data, 'errors')
    if (Array.isArray(errors) && errors.length) {
      const first = at(errors[0], 'message')
      throw new GhError(typeof first === 'string' ? first : 'GraphQL error', null)
    }
    return at(data, 'data')
  },
}

const USAGE = `Usage:
  factory-tools issue-ready <owner/repo#n> --passed <true|false> --report <file>
    --project <owner/number> --author <login> --association <author_association> --state <open|closed>
    [--ready-status <name>] [--not-ready-status <name>]
`

/** The outcome of `issue-ready`, shaped like `lint-issue`'s. */
export interface ReadyResult {
  code: 0 | 2
  stdout: string
  stderr: string
}

/** What `runReady` needs from the outside world. */
export interface ReadyDeps {
  gh: Gh
  readText: (path: string) => Promise<string>
}

/**
 * Runs `factory-tools issue-ready` without touching the process.
 *
 * @param argv - The arguments after the program name, starting with `issue-ready`.
 */
export async function runReady(
  argv: string[],
  deps: ReadyDeps = { gh: defaultGh, readText: (path) => readFile(path, 'utf8') }
): Promise<ReadyResult> {
  const parsed = parseReadyArgs(argv.slice(1))
  if (typeof parsed === 'string')
    return { code: 2, stdout: '', stderr: `error: ${parsed}\n${USAGE}` }
  try {
    const report = await deps.readText(parsed.reportPath)
    const done = await applyReadiness(deps.gh, { ...parsed.params, report })
    return { code: 0, stdout: done.map((line) => `${line}\n`).join(''), stderr: '' }
  } catch (error) {
    return { code: 2, stdout: '', stderr: `error: ${errorLine(error)}\n` }
  }
}

function parseReadyArgs(
  args: string[]
): { params: Omit<ReadyParams, 'report'>; reportPath: string } | string {
  const values = new Map<string, string>()
  const positional: string[] = []
  const names = [
    '--passed',
    '--report',
    '--project',
    '--author',
    '--association',
    '--state',
    '--ready-status',
    '--not-ready-status',
  ]
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? ''
    if (names.includes(arg)) {
      const value = args[++i]
      if (value === undefined) return `${arg} needs a value`
      values.set(arg, value)
    } else {
      positional.push(arg)
    }
  }
  const ref = positional.length === 1 ? parseTarget(positional[0] ?? '') : null
  if (!ref) return 'give one target, owner/repo#n'
  const passed = values.get('--passed')
  if (passed !== 'true' && passed !== 'false') return '--passed must be true or false'
  const reportPath = values.get('--report')
  if (!reportPath) return '--report is required'
  const project = /^(\w[\w.-]*)\/(\d+)$/.exec(values.get('--project') ?? '')
  if (!project) return '--project must be owner/number'
  const author = values.get('--author')
  if (!author) return '--author is required'
  const association = values.get('--association')
  if (!association) return '--association is required'
  const state = values.get('--state')
  if (!state) return '--state is required'
  return {
    reportPath,
    params: {
      ref,
      passed: passed === 'true',
      project: { owner: project[1] ?? '', number: Number(project[2]) },
      readyStatus: values.get('--ready-status') ?? 'Ready',
      notReadyStatus: values.get('--not-ready-status') ?? 'Todo',
      author,
      association,
      state,
    },
  }
}
