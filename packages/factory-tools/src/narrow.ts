/** Whether `value` is a plain object: not `null` and not an array. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Whether `value` is a plain object whose every value is a string. */
export function isStringMap(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((item) => typeof item === 'string')
}

/** `value` when it is an array, with its items as `unknown`; otherwise an empty array. */
export function arrayOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

/**
 * The `code` of a thrown value, as Node.js sets it on a system error (`ENOENT`, `EISDIR`), so a
 * `catch` can compare it without asserting the type of what it caught.
 *
 * @returns The `code` property when `error` is an object that has one; otherwise `undefined`.
 */
export function errorCode(error: unknown): unknown {
  return typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined
}
