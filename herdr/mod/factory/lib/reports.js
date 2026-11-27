// The REPORTS button of a "Needs you" card: what its pane runs. Pure: no program is run here.

/** The issue's title and body: a `jq` program, kept raw so `\\(…)` and `\\n` reach `gh` as written. */
const ISSUE = String.raw`"\(.title)\n\n\(.body // "")"`

/** Each comment of a page, under a line with its author and date. */
const COMMENTS = String.raw`.[] | "\n--- \(.user.login) · \(.created_at)\n\n\(.body // "")"`

/**
 * The command of the REPORTS pane: the issue's title and body, then its comments in order, each with
 * its author and date, in `less`. Both reads are REST GETs of `gh api`, so the pane spends no GraphQL
 * point. The number and the repository are positional arguments of `sh -c`: nothing from the card is
 * in the script's text.
 *
 * @param {number} number the issue
 * @param {string} repo `owner/name`
 * @returns {string[]}
 */
export function reportsArgs(number, repo) {
  const script = `{
  gh api "repos/$2/issues/$1" --jq '${ISSUE}'
  gh api --paginate "repos/$2/issues/$1/comments" --jq '${COMMENTS}'
} | less -R`
  return ['sh', '-c', script, 'reports', String(number), repo]
}
