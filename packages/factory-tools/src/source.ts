import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'

/**
 * Where `metrics` reads GitHub from. Every method returns what `gh api` printed for that
 * endpoint, unchecked: `metrics` narrows it.
 */
export interface Source {
  /** `repos/{repo}/milestones?state=all`. */
  milestones: () => Promise<unknown[]>
  /** `repos/{repo}/issues?milestone={number}&state=all`: the issues and pull requests of one milestone. */
  milestoneIssues: (milestone: number) => Promise<unknown[]>
  /** `repos/{repo}/issues?state=all`, to find the `fix` issues that cite a pull request. */
  allIssues: () => Promise<unknown[]>
  /** `repos/{repo}/pulls?state=all`. */
  pulls: () => Promise<unknown[]>
  /** `repos/{repo}/pulls/{number}`, which has the changed lines the list lacks. */
  pull: (number: number) => Promise<unknown>
  /** `repos/{repo}/issues/{number}/comments`, of an issue or of a pull request's conversation. */
  comments: (number: number) => Promise<unknown[]>
  /**
   * The edit history of one comment, newest first, as GraphQL `IssueComment.userContentEdits`
   * returns its nodes (`editedAt` and `diff`, the text of that version); empty when it was never
   * edited.
   */
  commentEdits: (id: string) => Promise<unknown[]>
  /** `repos/{repo}/pulls/{number}/reviews`. */
  reviews: (number: number) => Promise<unknown[]>
  /** `repos/{repo}/pulls/{number}/comments`: the comments on the diff. */
  reviewComments: (number: number) => Promise<unknown[]>
  /** `repos/{repo}/pulls/{number}/commits`: the commits of a pull request, with their dates. */
  commits: (number: number) => Promise<unknown[]>
  /**
   * The names of the status checks `repos/{repo}/rules/branches/{branch}` requires (the contexts of
   * its `required_status_checks` rules); empty when the branch requires none.
   */
  requiredChecks: (branch: string) => Promise<string[]>
  /** `repos/{repo}/commits/{sha}/check-runs`, the `check_runs` array. */
  checkRuns: (sha: string) => Promise<unknown[]>
}

const exec = promisify(execFile)

/**
 * Reads a repository through `gh api` (read only). Paginated lists are joined into one array.
 *
 * @param repo - `owner/repo`.
 */
export function ghSource(repo: string): Source {
  const base = `repos/${repo}`
  const get = async (path: string, paginate: boolean): Promise<unknown> => {
    const args = ['api', ...(paginate ? ['--paginate', '--slurp'] : []), path]
    const { stdout } = await exec('gh', args, { maxBuffer: 256 * 1024 * 1024 })
    return JSON.parse(stdout) as unknown
  }
  const list = async (path: string): Promise<unknown[]> => {
    const pages = await get(path, true)
    return Array.isArray(pages) ? pages.flat() : []
  }
  return {
    commentEdits: async (id) => {
      const query =
        'query($id: ID!) { node(id: $id) { ... on IssueComment { userContentEdits(first: 100) { nodes { editedAt diff } } } } }'
      const { stdout } = await exec(
        'gh',
        ['api', 'graphql', '-f', `query=${query}`, '-f', `id=${id}`],
        {
          maxBuffer: 256 * 1024 * 1024,
        }
      )
      const nodes = (
        JSON.parse(stdout) as { data?: { node?: { userContentEdits?: { nodes?: unknown } } } }
      ).data?.node?.userContentEdits?.nodes
      return Array.isArray(nodes) ? nodes : []
    },
    milestones: () => list(`${base}/milestones?state=all&per_page=100`),
    milestoneIssues: (n) => list(`${base}/issues?milestone=${n}&state=all&per_page=100`),
    allIssues: () => list(`${base}/issues?state=all&per_page=100`),
    pulls: () => list(`${base}/pulls?state=all&per_page=100`),
    pull: (n) => get(`${base}/pulls/${n}`, false),
    comments: (n) => list(`${base}/issues/${n}/comments?per_page=100`),
    reviews: (n) => list(`${base}/pulls/${n}/reviews?per_page=100`),
    reviewComments: (n) => list(`${base}/pulls/${n}/comments?per_page=100`),
    commits: (n) => list(`${base}/pulls/${n}/commits?per_page=100`),
    requiredChecks: async (branch) =>
      requiredOf(await list(`${base}/rules/branches/${encodeURIComponent(branch)}?per_page=100`)),
    checkRuns: async (sha) => {
      const pages = await get(`${base}/commits/${sha}/check-runs?per_page=100`, true)
      return Array.isArray(pages) ? pages.flatMap(checkRunsOf) : []
    },
  }
}

/**
 * Reads the files `test/fixtures/metrics/record.sh` records: one JSON file per endpoint, named
 * after it (`milestones.json`, `milestone-issues.json`, `all-issues.json`, `pulls.json`,
 * `comments/<n>.json`, `comment-edits/<node id>.json`, `pulls/<n>.json`, `pulls/<n>.reviews.json`, `pulls/<n>.review-comments.json`,
 * `pulls/<n>.commits.json`, `rules/<branch>.json`, `check-runs/<sha>.json`). A missing file is an empty list, as an endpoint
 * with no items is.
 *
 * @param dir - The directory of the recording.
 */
export function fixtureSource(dir: string): Source {
  const read = async (file: string): Promise<unknown> => {
    try {
      return JSON.parse(await readFile(join(dir, file), 'utf8')) as unknown
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null
      throw new Error(
        `cannot read ${join(dir, file)}: ${error instanceof Error ? error.message : ''}`
      )
    }
  }
  const list = async (file: string): Promise<unknown[]> => {
    const json = await read(file)
    return Array.isArray(json) ? json : []
  }
  return {
    milestones: () => list('milestones.json'),
    milestoneIssues: () => list('milestone-issues.json'),
    allIssues: () => list('all-issues.json'),
    pulls: () => list('pulls.json'),
    pull: (n) => read(`pulls/${n}.json`),
    comments: (n) => list(`comments/${n}.json`),
    commentEdits: (id) => list(`comment-edits/${id}.json`),
    reviews: (n) => list(`pulls/${n}.reviews.json`),
    reviewComments: (n) => list(`pulls/${n}.review-comments.json`),
    commits: (n) => list(`pulls/${n}.commits.json`),
    requiredChecks: async (branch) => requiredOf(await list(`rules/${branch}.json`)),
    checkRuns: async (sha) => checkRunsOf(await read(`check-runs/${sha}.json`)),
  }
}

/** The contexts of the `required_status_checks` rules in the answer of the rules endpoint. */
function requiredOf(rules: unknown[]): string[] {
  const names: string[] = []
  for (const rule of rules) {
    if (typeof rule !== 'object' || rule === null) continue
    if (!('type' in rule) || rule.type !== 'required_status_checks') continue
    const parameters = 'parameters' in rule ? rule.parameters : null
    const checks =
      typeof parameters === 'object' &&
      parameters !== null &&
      'required_status_checks' in parameters
        ? parameters.required_status_checks
        : []
    if (!Array.isArray(checks)) continue
    for (const check of checks) {
      if (typeof check === 'object' && check !== null && 'context' in check) {
        if (typeof check.context === 'string') names.push(check.context)
      }
    }
  }
  return names
}

function checkRunsOf(json: unknown): unknown[] {
  const runs =
    typeof json === 'object' && json !== null && 'check_runs' in json ? json.check_runs : []
  return Array.isArray(runs) ? runs : []
}
