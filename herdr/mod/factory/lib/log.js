// The correction form ("Log a correction", `herdr/mod/design/screens/LogForm.png`): the line it sends to a
// master, `log #N | <what> | <category>`, and the line the master posts on the issue from it
// (`factory-log | <date> | #N | <what> | <category> | -`, `herdr/master.md`, "Lines from the mod" and
// `docs/factory.md`, `C.1`). A function of its arguments: nothing here reads the clock or sends.

/** The categories of a correction (`C.1`), in the order of the form. */
export const CATEGORIES = Object.freeze(['lint', 'test', 'skill', 'standard', 'issue', 'docs'])

/**
 * @typedef {object} LogForm
 * @property {string} issue `#792` (a number, with or without the `#`)
 * @property {string} what what was wrong, not how it was fixed
 * @property {string | null} category one of `CATEGORIES`
 */

/** @returns {LogForm} */
export const emptyLogForm = (/** @type {number | null} */ number = null) => ({
  issue: number === null ? '' : `#${number}`,
  what: '',
  category: null,
})

/**
 * The text of a correction as one line a `|`-separated line can hold: line breaks and runs of spaces
 * become one space and a `|` is sent as `\|`.
 *
 * @param {string} what
 * @returns {string}
 */
export const escapeWhat = (what) => what.replaceAll(/\s+/g, ' ').trim().replaceAll('|', '\\|')

/**
 * The line to send, the line the master will post, and what is wrong with the form, if anything.
 *
 * @param {LogForm} form
 * @param {number} now milliseconds since the epoch (for the date of the posted line)
 * @returns {{ number: number | null, send: string | null, posted: string, error: string | null }}
 */
export function correctionLine(form, now) {
  const match = /^#?(\d+)$/.exec(form.issue.trim())
  const number = match === null ? null : Number(match[1])
  const what = escapeWhat(form.what)
  const category = form.category
  const date = new Date(now).toISOString().slice(0, 10)
  const shown = number === null ? form.issue.trim() || '#…' : `#${number}`
  const posted = `factory-log | ${date} | ${shown} | ${what === '' ? '…' : what} | ${category ?? '…'} | -`
  /** @type {string | null} */
  let error = null
  if (number === null) error = 'Issue: #n.'
  else if (what === '') error = 'Say what was wrong, in one line.'
  else if (category === null || !CATEGORIES.includes(category)) error = 'Pick a category.'
  return {
    number,
    send: error === null ? `log #${number} | ${what} | ${category}` : null,
    posted,
    error,
  }
}
