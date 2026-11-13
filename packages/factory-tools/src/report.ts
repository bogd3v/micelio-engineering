import { RULE_IDS } from './rules.js'
import type { Lane } from './lane.js'
import type { RuleResult } from './rules.js'

/**
 * The Markdown report of a run: the line `lane: <lane>`, a header line with the target, the date
 * and the count, then one line per failed rule. It is written to be posted as an issue comment.
 *
 * @param target - What was checked, `owner/repo#n` or a file path.
 * @param date - The day of the run, `YYYY-MM-DD`.
 * @param lane - The lane of the issue, which the `lane` rule used.
 */
export function report(target: string, date: string, results: RuleResult[], lane: Lane): string {
  const failed = results.filter((item) => !item.ok)
  const count = failed.length
    ? `${failed.length} of ${RULE_IDS.length} rules fail`
    : `all ${RULE_IDS.length} rules pass`
  const header = `**lint-issue** · \`${target}\` · ${date} · ${count}`
  const lines = failed.map((item) => `- \`${item.rule}\`: ${item.detail}.`)
  return [`lane: ${lane}`, header, ...(lines.length ? ['', ...lines] : [])].join('\n') + '\n'
}
