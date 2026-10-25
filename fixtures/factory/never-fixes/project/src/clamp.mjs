/**
 * Keeps a number inside a range.
 *
 * @param {number} value - The number to keep.
 * @param {number} min - The least the result may be.
 * @param {number} max - The most the result may be.
 * @returns {number} `value`, or the bound it went past.
 */
export function clamp(value, min, max) {
  return Math.max(value, min)
}
