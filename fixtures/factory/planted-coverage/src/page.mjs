/**
 * Reads a reading time in minutes out of a body of text, at 200 words a minute.
 *
 * @param {string} body - The text of a page.
 * @returns {number} Whole minutes, at least 1.
 */
export function readingMinutes(body) {
  const words = body.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) {
    return 1
  }
  const minutes = Math.ceil(words.length / 200)
  if (minutes < 1) {
    return 1
  }
  return minutes
}

/**
 * Cuts a text to `limit` characters at a word boundary, with an ellipsis when it was cut.
 *
 * @param {string} text - The text to cut.
 * @param {number} limit - The most characters to keep.
 * @returns {string} The excerpt.
 */
export function excerpt(text, limit) {
  if (text.length <= limit) {
    return text
  }
  const cut = text.slice(0, limit)
  const space = cut.lastIndexOf(' ')
  const kept = space > 0 ? cut.slice(0, space) : cut
  return `${kept}…`
}

/**
 * Builds the canonical path of a page from its section and title.
 *
 * @param {string} section - The section name.
 * @param {string} title - The page title.
 * @returns {string} The path, with no trailing slash.
 */
export function pagePath(section, title) {
  const clean = (value) => value.trim().toLowerCase().replace(/\s+/g, '-')
  if (section === '') {
    return `/${clean(title)}`
  }
  return `/${clean(section)}/${clean(title)}`
}
