// The file of the agent cat for a role, a state, a size and a theme. The files are built by
// herdr/mod/build-cats.mjs under herdr/mod/factory/cats/.

/** The roles that have a cat. */
export const ROLES = ['planner', 'master', 'worker', 'reviewer', 'verifier', 'scribe']

/** The states a cat shows. */
export const STATES = ['working', 'needs', 'idle', 'held', 'red']

/** The themes of the mod. */
export const THEMES = ['dark', 'light']

/** Under this size (in px) the cat is its head and the object is a round badge. */
const HEAD_BELOW = 32

/**
 * The name of the cat file for a role, a state, a size in px and a theme:
 * `<role>-<state>-<crop>-<theme>.svg`, with the `head` crop under 32 px and the `full` crop from 32 px.
 * Returns `undefined` for a name without a role (an unknown role, or none), a state or a theme that does not exist.
 *
 * @param {string | undefined | null} role
 * @param {string} state
 * @param {number} size
 * @param {string} theme
 * @returns {string | undefined}
 */
export function catFile(role, state, size, theme) {
  if (typeof role !== 'string' || !ROLES.includes(role)) return undefined
  if (!STATES.includes(state) || !THEMES.includes(theme)) return undefined
  const crop = size < HEAD_BELOW ? 'head' : 'full'
  return `${role}-${state}-${crop}-${theme}.svg`
}
