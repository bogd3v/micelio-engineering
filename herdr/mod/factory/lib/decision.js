// The open decision of an issue, as the master posts it (`herdr/master.md`, "A decision for the
// maintainer"): the question and one option per list item.

import { fromBody, saidOf } from './gates.js'
import { toMs } from './time.js'

/**
 * The open decision of an issue: its last `**Decision needed** · #N` comment of the maintainer's
 * login, unless a later comment of that login starts with `Maintainer's decision, relayed by the master` (the
 * form the master posts the maintainer's answer in, `herdr/master.md`, "Lines from the mod").
 * The question is the text before the first list item, and each option is `- A: <text>`.
 *
 * @param {import('./gates.js').Comment[]} comments
 * @param {string} maintainer
 * @returns {{ at: number, question: string, options: { letter: string, text: string }[] } | null}
 */
export function parseDecision(comments, maintainer) {
  const own = comments
    .filter((c) => c.user?.login === maintainer)
    .toSorted(
      (a, b) => (toMs(a.created_at) ?? 0) - (toMs(b.created_at) ?? 0) || (a.id ?? 0) - (b.id ?? 0)
    )
  /** @type {ReturnType<typeof parseDecision>} */
  let open = null
  for (const comment of own) {
    const line = fromBody(comment, saidOf)?.line ?? ''
    if (/^decision needed\b/i.test(line)) {
      const asked = fromBody(comment, askedOf)
      if (asked !== null) {
        open = {
          at: toMs(comment.created_at) ?? 0,
          question: asked.question,
          options: [...asked.options],
        }
      }
    } else if (open !== null && /^maintainer'?s decision, relayed by the master\b/i.test(line)) {
      open = null
    }
  }
  return open
}

/**
 * The question and the options of a `**Decision needed**` comment: what follows its first line.
 *
 * @param {string} body
 */
function askedOf(body) {
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
  return { question: question.join(' '), options }
}
