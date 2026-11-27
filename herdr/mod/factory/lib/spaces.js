// The check of the `spaces` the layout gives: a milestone that is closed or that its repository does not
// have, and an epic that is not an open epic. It only warns: no entry is left out or changed. Pure: the
// milestones and the epics are arguments, and the calls that fetch them are the mod's own.

import { pairsOf } from './panel.js'

/**
 * An issue as REST returns it, the fields the check of an epic reads.
 *
 * @typedef {object} EpicIssue
 * @property {string} state `open` or `closed`
 * @property {string} title
 * @property {{ name: string }[]} labels
 * @property {object | null} [pull_request] there when the number is a pull request's
 */

/**
 * The epic of each space as last read, by the space's name: `at` is the last try, milliseconds since the
 * epoch, and `issue` the last good answer, `null` before one.
 *
 * @typedef {Record<string, { at: number, issue: EpicIssue | null }>} EpicReads
 */

/**
 * Whether an issue is an open epic: not a pull request, open, and titled `Epic:` or labelled `épica`,
 * the title and the label of the epic template.
 *
 * @param {EpicIssue} issue
 * @returns {boolean}
 */
const isOpenEpic = (issue) =>
  issue.pull_request == null &&
  issue.state === 'open' &&
  (issue.title.startsWith('Epic:') || issue.labels.some((label) => label.name === 'épica'))

/**
 * One line for each problem of the spaces, in their order: each pair's milestone, then the epic of the
 * space's first pair (a tagged pair's epic is not checked). What was not read gives no line.
 *
 * @param {object} input
 * @param {import('./panel.js').SpaceConfig[]} input.spaces
 * @param {Record<string, import('./board.js').RepoMilestone[]> | null} input.milestones each
 *   repository's milestones, `null` before a good read
 * @param {EpicReads} input.epics
 * @returns {string[]}
 */
export function spaceProblems({ spaces, milestones, epics }) {
  return spaces.flatMap((space) => {
    const lines = pairsOf(space).flatMap(({ repo, milestone }) => {
      const list = milestones?.[repo]
      if (list === undefined) return []
      const found = list.find((m) => m.number === milestone)
      if (found === undefined) return [`${space.name}: ${repo} has no milestone ${milestone}`]
      return found.state === 'closed'
        ? [`${space.name}: milestone ${milestone} of ${repo} is closed`]
        : []
    })
    const epic = epics[space.name]?.issue
    if (space.epic != null && epic != null && !isOpenEpic(epic)) {
      lines.push(`${space.name}: #${space.epic} of ${space.repo} is not an open epic`)
    }
    return lines
  })
}
