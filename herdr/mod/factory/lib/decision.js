// The open decision of an issue, as the master posts it (`herdr/master.md`, "A decision for the
// maintainer"): the question and one option per list item.

import { toMs } from './time.js'

/**
 * The first line of a comment without its markup.
 *
 * @param {string} body
 * @returns {string}
 */
function firstLine(body) {
  return (body.split(/\r?\n/, 1)[0] ?? '')
    .replaceAll(/<[^>]*>/g, '')
    .replaceAll('*', '')
    .replace(/^\s*#+\s*/, '')
    .trim()
}

/**
 * The open decision of an issue: its last `**Decision needed** · #N` comment of the maintainer's
 * login, unless a later comment of that login starts with `Maintainer's decision, relayed by the master` (the
 * form the master posts the maintainer's answer in, `herdr/master.md`, "Lines from the mod").
 * The question is the text before the first list item, and each option is `- A: <text>`.
 *
 * @param {{ user?: { login?: string }, body?: string, created_at?: string, id?: number }[]} comments
 * @param {string} maintainer
 * @returns {{ at: number, question: string, options: { letter: string, text: string }[] } | null}
 */
export function parseDecision(comments, maintainer) {
  const own = comments
    .filter((c) => c.user?.login === maintainer && typeof c.body === 'string')
    .toSorted(
      (a, b) => (toMs(a.created_at) ?? 0) - (toMs(b.created_at) ?? 0) || (a.id ?? 0) - (b.id ?? 0)
    )
  /** @type {ReturnType<typeof parseDecision>} */
  let open = null
  for (const comment of own) {
    const body = comment.body ?? ''
    const line = firstLine(body)
    if (/^decision needed\b/i.test(line)) {
      const lines = body.split(/\r?\n/).slice(1)
      /** @type {string[]} */
      const question = []
      /** @type {{ letter: string, text: string }[]} */
      const options = []
      for (const text of lines) {
        const item = /^\s*[-*]\s+([A-Z])\s*[:.)]\s*(.+?)\s*$/.exec(text)
        if (item !== null) options.push({ letter: item[1] ?? '', text: item[2] ?? '' })
        else if (options.length === 0 && text.trim() !== '') question.push(text.trim())
      }
      open = { at: toMs(comment.created_at) ?? 0, question: question.join(' '), options }
    } else if (open !== null && /^maintainer'?s decision, relayed by the master\b/i.test(line)) {
      open = null
    }
  }
  return open
}
