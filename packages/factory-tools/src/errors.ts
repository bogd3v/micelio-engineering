/**
 * The first line that explains an error: the first non-empty line of a child process's `stderr`,
 * or of the message. The report has one line per rule, so a multi-line `gh` error must not break
 * it.
 */
export function errorLine(error: unknown): string {
  const stderr =
    error instanceof Error && 'stderr' in error && typeof error.stderr === 'string'
      ? error.stderr
      : ''
  const text = stderr.trim() || (error instanceof Error ? error.message : String(error))
  return text.split('\n').find((line) => line.trim() !== '') ?? text
}
