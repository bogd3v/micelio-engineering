import type { Gh } from './ready.js'
import { errorLine } from './errors.js'

/** The project field that holds the release line of an issue's milestone. */
export const RELEASE_LINE_FIELD = 'Release line'

/** The project field that holds the front of an issue's milestone. */
export const FRONT_FIELD = 'Front'

/** What a milestone sets on its issues, as one entry of `.github/project-fields.json`. */
export interface FieldsEntry {
  /** The Release line option, by name. */
  releaseLine: string
  /** The Front option, by name, for every repository not in `frontByRepository`. */
  front: string
  /** The Front option for a repository, by its name without the owner; it wins over `front`. */
  frontByRepository?: Record<string, string>
}

/** `.github/project-fields.json`: one entry per milestone title, compared exactly. */
export type ProjectFields = Record<string, FieldsEntry>

/** The project as `issue-ready` reads it: its id and its single-select fields. */
export interface ProjectRead {
  /** `owner/number`, for messages. */
  label: string
  projectId: string
  nodes: unknown[]
}

/** A single-select field found by name, with its options by name. */
export interface SingleSelect {
  fieldId: string
  options: Map<string, string>
}

/** What to set on one issue: each field with the option the milestone's entry names. */
export interface FieldsPlan {
  projectId: string
  fields: { name: string; fieldId: string; option: string; optionId: string }[]
}

/**
 * Parses `.github/project-fields.json`; throws, naming the entry, when its shape is wrong.
 *
 * @param text - The file's content.
 */
export function parseProjectFields(text: string): ProjectFields {
  const data: unknown = JSON.parse(text)
  if (!isRecord(data)) throw new Error('project fields: the file must be an object of milestones')
  const fields: ProjectFields = {}
  for (const [title, entry] of Object.entries(data)) {
    const releaseLine = at(entry, 'releaseLine')
    const front = at(entry, 'front')
    const byRepository = at(entry, 'frontByRepository')
    if (typeof releaseLine !== 'string' || typeof front !== 'string')
      throw new Error(`project fields: "${title}" needs releaseLine and front as strings`)
    if (
      byRepository !== undefined &&
      !(isRecord(byRepository) && Object.values(byRepository).every((v) => typeof v === 'string'))
    )
      throw new Error(`project fields: frontByRepository of "${title}" must map names to strings`)
    fields[title] = { releaseLine, front }
    if (byRepository) fields[title].frontByRepository = byRepository as Record<string, string>
  }
  return fields
}

/** Reads the organisation project's id and fields; throws if it cannot be read. */
export async function readProject(
  gh: Gh,
  project: { owner: string; number: number }
): Promise<ProjectRead> {
  const { owner, number } = project
  const label = `${owner}/${number}`
  const data = await gh.graphql(PROJECT_QUERY, { owner, number })
  const found = at(data, 'organization', 'projectV2')
  if (!isRecord(found)) throw new Error(`project ${label} not found or not readable`)
  const projectId = at(found, 'id')
  const nodes = at(found, 'fields', 'nodes')
  if (typeof projectId !== 'string' || !Array.isArray(nodes))
    throw new Error(`project ${label}: unexpected response`)
  return { label, projectId, nodes }
}

/**
 * The single-select field `name` and its options; throws if the field or one of `required` is
 * missing, naming what it looked for and the options the project has.
 */
export function singleSelect(project: ProjectRead, name: string, required: string[]): SingleSelect {
  const field = project.nodes.find((node) => isRecord(node) && node.name === name)
  const fieldId = at(field, 'id')
  const options = at(field, 'options')
  if (typeof fieldId !== 'string' || !Array.isArray(options))
    throw new Error(`project ${project.label} has no single-select field named "${name}"`)
  const byName = new Map<string, string>()
  for (const option of options) {
    const id = at(option, 'id')
    const optionName = at(option, 'name')
    if (typeof id === 'string' && typeof optionName === 'string') byName.set(optionName, id)
  }
  for (const wanted of required) {
    if (!byName.has(wanted)) {
      const known = [...byName.keys()].join(', ')
      throw new Error(
        `the ${name} of project ${project.label} has no option "${wanted}" (it has: ${known}); add it in the project settings`
      )
    }
  }
  return { fieldId, options: byName }
}

/**
 * What the milestone's entry sets on an issue of `repository` (its name without the owner), or the
 * one line that says why nothing is set. Throws when a field or an option is missing, so that the
 * caller fails before it writes anything. The milestone title is only compared, as data.
 */
export function planFields(
  project: ProjectRead,
  config: ProjectFields,
  repository: string,
  milestone: string | null
): FieldsPlan | string {
  if (milestone === null) return 'fields left alone: the issue has no milestone'
  const entry = Object.hasOwn(config, milestone) ? config[milestone] : undefined
  if (!entry)
    return `fields left alone: the milestone "${milestone}" has no entry in .github/project-fields.json`
  const byRepository = entry.frontByRepository ?? {}
  const front = Object.hasOwn(byRepository, repository) ? byRepository[repository] : entry.front
  const fields = [
    { name: RELEASE_LINE_FIELD, option: entry.releaseLine },
    { name: FRONT_FIELD, option: front },
  ].map(({ name, option }) => {
    const field = singleSelect(project, name, [option])
    return { name, fieldId: field.fieldId, option, optionId: field.options.get(option) ?? '' }
  })
  return { projectId: project.projectId, fields }
}

/** The issue's milestone title, or `null`, and its item in the project with the current values. */
export async function readIssueFields(
  gh: Gh,
  repo: string,
  number: number,
  projectId: string
): Promise<{ milestone: string | null; item: Record<string, unknown> | null }> {
  const [owner, name] = repo.split('/')
  const data = await gh.graphql(ISSUE_FIELDS_QUERY, { owner, name, number })
  const issue = at(data, 'repository', 'issue')
  if (!isRecord(issue)) throw new Error(`issue ${repo}#${number} not found`)
  const title = at(issue, 'milestone', 'title')
  const items = at(issue, 'projectItems', 'nodes')
  const item = Array.isArray(items)
    ? items.find((node) => at(node, 'project', 'id') === projectId)
    : undefined
  return { milestone: typeof title === 'string' ? title : null, item: isRecord(item) ? item : null }
}

/**
 * Sets each field of the plan on the issue's project item when the field has no value, and returns
 * one line per field. A value already set, by hand or by an earlier run, is never changed; an issue
 * that is not an item of the project changes nothing.
 */
export async function applyFields(
  gh: Gh,
  repo: string,
  number: number,
  plan: FieldsPlan
): Promise<string[]> {
  const { item } = await readIssueFields(gh, repo, number, plan.projectId)
  const itemId = at(item, 'id')
  if (typeof itemId !== 'string') return ['fields left alone: not in the project']
  const done: string[] = []
  for (const field of plan.fields) {
    const current = at(item, field.name === RELEASE_LINE_FIELD ? 'releaseLine' : 'front')
    const name = at(current, 'name')
    if (typeof at(current, 'optionId') === 'string') {
      done.push(`${field.name} left as it is (${String(name)})`)
      continue
    }
    await gh.graphql(SET_OPTION, {
      project: plan.projectId,
      item: itemId,
      field: field.fieldId,
      option: field.optionId,
    })
    done.push(`${field.name} set to ${field.option}`)
  }
  return done
}

/** What the backfill needs. */
export interface BackfillParams {
  /** The organisation project, as its owner and number; the repositories belong to its owner. */
  project: { owner: string; number: number }
  /** The milestone title, compared exactly with each repository's milestones. */
  milestone: string
  config: ProjectFields
  /** The repositories to look in, by name without the owner. */
  repositories: string[]
}

/**
 * Sets Release line and Front on every open issue of a milestone, in each repository, with the
 * rules of `issue-ready`: a field with a value is kept, an issue not in the project is left alone.
 * Every field, option and issue is read before the first write, so a missing option changes
 * nothing. Returns one line per issue and field.
 */
export async function backfillFields(gh: Gh, params: BackfillParams): Promise<string[]> {
  const { owner } = params.project
  if (!Object.hasOwn(params.config, params.milestone))
    return [
      `nothing changed: the milestone "${params.milestone}" has no entry in .github/project-fields.json`,
    ]
  const project = await readProject(gh, params.project)
  const work: { repo: string; number: number; plan: FieldsPlan }[] = []
  const done: string[] = []
  for (const name of params.repositories) {
    const repo = `${owner}/${name}`
    const plan = planFields(project, params.config, name, params.milestone)
    if (typeof plan === 'string') throw new Error(plan)
    const milestone = (await pages(gh, `/repos/${repo}/milestones?state=all`)).find(
      (m) => at(m, 'title') === params.milestone
    )
    const milestoneNumber = at(milestone, 'number')
    if (typeof milestoneNumber !== 'number') {
      done.push(`${repo}: no milestone "${params.milestone}"`)
      continue
    }
    const issues = await pages(gh, `/repos/${repo}/issues?milestone=${milestoneNumber}&state=open`)
    for (const issue of issues) {
      const number = at(issue, 'number')
      if (typeof number === 'number' && at(issue, 'pull_request') === undefined)
        work.push({ repo, number, plan })
    }
  }
  for (const { repo, number, plan } of work) {
    for (const line of await applyFields(gh, repo, number, plan))
      done.push(`${repo}#${number}: ${line}`)
  }
  return done
}

/** Every page of a REST list. */
async function pages(gh: Gh, path: string): Promise<unknown[]> {
  const all: unknown[] = []
  for (let page = 1; ; page++) {
    const data = await gh.rest('GET', `${path}&per_page=100&page=${page}`)
    if (!Array.isArray(data)) throw new Error(`unexpected response for ${path}`)
    all.push(...(data as unknown[]))
    if (data.length < 100) return all
  }
}

const BACKFILL_USAGE = `Usage:
  factory-tools project-fields-backfill --milestone <title> --project <owner/number>
    --project-fields <file> --repositories <name,name,…>
`

/** What `runBackfill` needs from the outside world. */
export interface BackfillDeps {
  gh: Gh
  readText: (path: string) => Promise<string>
}

/**
 * Runs `factory-tools project-fields-backfill` without touching the process: exit 0 with one line
 * per issue and field, or 2 with the reason.
 *
 * @param argv - The arguments after the program name, starting with `project-fields-backfill`.
 */
export async function runBackfill(
  argv: string[],
  deps: BackfillDeps
): Promise<{ code: 0 | 2; stdout: string; stderr: string }> {
  const values = new Map<string, string>()
  const args = argv.slice(1)
  for (let i = 0; i < args.length; i += 2) {
    const name = args[i] ?? ''
    const value = args[i + 1]
    if (!['--milestone', '--project', '--project-fields', '--repositories'].includes(name))
      return { code: 2, stdout: '', stderr: `error: unknown argument "${name}"\n${BACKFILL_USAGE}` }
    if (value === undefined)
      return { code: 2, stdout: '', stderr: `error: ${name} needs a value\n${BACKFILL_USAGE}` }
    values.set(name, value)
  }
  const milestone = values.get('--milestone')
  const project = /^(\w[\w.-]*)\/(\d+)$/.exec(values.get('--project') ?? '')
  const file = values.get('--project-fields')
  const repositories = (values.get('--repositories') ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean)
  if (!milestone || !project || !file || !repositories.length)
    return {
      code: 2,
      stdout: '',
      stderr: `error: --milestone, --project owner/number, --project-fields and --repositories are required\n${BACKFILL_USAGE}`,
    }
  try {
    const config = parseProjectFields(await deps.readText(file))
    const done = await backfillFields(deps.gh, {
      project: { owner: project[1] ?? '', number: Number(project[2]) },
      milestone,
      config,
      repositories,
    })
    return { code: 0, stdout: done.map((line) => `${line}\n`).join(''), stderr: '' }
  } catch (error) {
    return { code: 2, stdout: '', stderr: `error: ${errorLine(error)}\n` }
  }
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

const ISSUE_FIELDS_QUERY = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    issue(number: $number) {
      id
      milestone { title }
      projectItems(first: 20) {
        nodes {
          id
          project { id }
          releaseLine: fieldValueByName(name: "${RELEASE_LINE_FIELD}") {
            ... on ProjectV2ItemFieldSingleSelectValue { optionId name }
          }
          front: fieldValueByName(name: "${FRONT_FIELD}") {
            ... on ProjectV2ItemFieldSingleSelectValue { optionId name }
          }
        }
      }
    }
  }
}`

/** Sets a single-select field of a project item to one option. */
export const SET_OPTION = `mutation($project: ID!, $item: ID!, $field: ID!, $option: String!) {
  updateProjectV2ItemFieldValue(input: {
    projectId: $project, itemId: $item, fieldId: $field,
    value: { singleSelectOptionId: $option }
  }) { projectV2Item { id } }
}`

/** Whether `value` is a plain object. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** `value.a.b…` when every step is an object, otherwise `undefined`. */
export function at(value: unknown, ...keys: string[]): unknown {
  let current = value
  for (const key of keys) {
    if (!isRecord(current)) return undefined
    current = current[key]
  }
  return current
}
