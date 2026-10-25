/** The longest slug `slugify` returns, in characters. */
export const MAX_SLUG_LENGTH = 60

/**
 * Turns a title into a URL slug: accents are stripped, runs of other characters become one
 * hyphen and the result is cut at `MAX_SLUG_LENGTH`. An empty title answers an empty slug.
 *
 * @param {string} title - The title as an editor typed it.
 * @returns {string} The slug.
 */
export function slugify(title) {
  return title
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH)
}
