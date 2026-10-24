/** An issue as `lint-issue` reads it: from `gh issue view --json` or from a Markdown file. */
export interface Issue {
  /** The title, with its conventional prefix. */
  title: string
  /** The Markdown body. */
  body: string
  /**
   * The repository the issue belongs to, as `owner/repo`, so that a bare `#n` in the body can be
   * resolved. `null` for a file read without `--repo`.
   */
  repo: string | null
}

/** One heading of a body and the text under it. */
export interface Section {
  /** The heading text, lower-cased, without Markdown emphasis or a trailing colon. */
  name: string
  /**
   * The text under the heading and under its deeper subheadings, without the subheading lines,
   * HTML comments or empty list items.
   */
  content: string
}

/** An issue named by its repository and number. */
export interface IssueRef {
  /** `owner/repo`. */
  repo: string
  number: number
}

const HEADING_START = /^(#{1,6})\s/
const LINE_BREAK = /[\n\r\u2028\u2029]/
const FENCE = /^\s{0,3}(`{3,}|~{3,})/

/**
 * `owner/repo` as a regular expression source. The owner starts with a word character, so a
 * reference never reaches `gh` looking like an option.
 */
export const OWNER_REPO = '\\w[\\w.-]*\\/[\\w.-]+'

const TARGET = new RegExp(`^(${OWNER_REPO})#(\\d+)$`)

/** The body without HTML comments: GitHub does not render them, so they say nothing. */
export function stripComments(body: string): string {
  return body.replace(/<!--[\s\S]*?-->/g, '')
}

/**
 * The body without HTML comments and with every line of a fenced code block blanked, for the
 * rules that read prose: a `BREAKING CHANGE:` or "Depends on" inside an example is not one.
 */
export function proseOnly(body: string): string {
  let fence: string | null = null
  return stripComments(body)
    .split(/\r?\n/)
    .map((line) => {
      const marker = FENCE.exec(line)?.[1]
      if (fence === null) {
        if (marker === undefined) return line
        fence = marker
        return ''
      }
      if (marker !== undefined && marker[0] === fence[0] && marker.length >= fence.length) {
        if (line.trim() === marker) fence = null
      }
      return ''
    })
    .join('\n')
}

/**
 * Whether a heading name is `part` or starts with it as a whole word: "out of scope (see #40)"
 * and "why this matters" match "out of scope" and "why".
 */
export function nameMatches(name: string, part: string): boolean {
  return name === part || (name.startsWith(part) && /^[\s(:—–-]/.test(name.slice(part.length)))
}

/**
 * Splits a Markdown body into its sections, in order.
 *
 * @remarks
 * A section's content takes in its deeper subheadings (`## Acceptance criteria` / `### Unit`)
 * until a heading of the same or a higher level, or one that matches a name of `parts`, which
 * always starts its own section (`### Progress` under `## Delivery`). Every heading is still a
 * section of its own. Headings inside fenced code blocks are text, HTML comments are dropped, and
 * setext headings (`Why` over `===`) are not recognised. The text before the first heading is not
 * a section.
 *
 * @param parts - The names, as `nameMatches` reads them, that never nest under another heading.
 */
export function sections(body: string, parts: readonly string[] = []): Section[] {
  const flat: { name: string; level: number; lines: string[] }[] = []
  const text = stripComments(body).split(/\r?\n/)
  const prose = proseOnly(body).split(/\r?\n/)
  text.forEach((line, i) => {
    const level = prose[i] === line ? HEADING_START.exec(line)?.[1]?.length : undefined
    const text = level === undefined ? undefined : headingText(line.slice(level), true)
    if (level !== undefined && text !== undefined) {
      flat.push({ name: headingName(text), level, lines: [] })
    } else {
      flat.at(-1)?.lines.push(line)
    }
  })
  const isPart = (name: string): boolean => parts.some((part) => nameMatches(name, part))
  return flat.map((section, i) => {
    const lines = [...section.lines]
    for (const next of flat.slice(i + 1)) {
      if (next.level <= section.level || isPart(next.name)) break
      lines.push(...next.lines)
    }
    return { name: section.name, content: clean(lines.join('\n')) }
  })
}

/**
 * Parses a `lint-issue` target, `owner/repo#n`.
 *
 * @returns `null` when the text is not one.
 */
export function parseTarget(text: string): IssueRef | null {
  const match = TARGET.exec(text.trim())
  if (match?.[1] === undefined || match[2] === undefined) return null
  return { repo: match[1], number: Number(match[2]) }
}

/**
 * Reads an issue from a Markdown file's text: the first line is `# <title>`, the rest is the body.
 *
 * @throws `Error` when the first line is not a level-one heading.
 */
export function issueFromMarkdown(text: string, repo: string | null): Issue {
  const [first = '', ...rest] = text.split(/\r?\n/)
  const title = first.startsWith('#') ? headingText(first.slice(1), false) : undefined
  if (title === undefined) throw new Error('the first line of the file must be "# <title>"')
  return { title, body: rest.join('\n'), repo }
}

/**
 * Narrows the JSON printed by `gh issue view --json title,body` to an `Issue`.
 *
 * @throws `Error` when `title` or `body` is missing or not a string.
 */
export function issueFromGh(json: unknown, repo: string): Issue {
  if (typeof json !== 'object' || json === null) throw new Error('gh did not print an object')
  const { title, body } = json as Record<string, unknown>
  if (typeof title !== 'string' || typeof body !== 'string') {
    throw new Error('gh printed no title or body')
  }
  return { title, body, repo }
}

/**
 * What `\s+(.+?)\s*$` captures in `rest`, or `\s+(.+?)\s*#*\s*$` when `closing` is set, found
 * with string operations: the regular expression backtracks in cubic time on a long run of spaces,
 * and a body is written by anyone who can open an issue.
 */
function headingText(rest: string, closing: boolean): string | undefined {
  if (!/^\s/.test(rest)) return undefined
  let end = rest.trimEnd().length
  if (closing) while (end > 0 && rest.charAt(end - 1) === '#') end--
  const text = rest.slice(0, end).trim()
  if (text !== '') return LINE_BREAK.test(text) ? undefined : text
  // Only a closing `#` run: `.+?` takes its first `#`.
  if (rest.trim() !== '') return '#'
  // Only spaces: `.+?` takes the last one after the first that is not a line break.
  for (let i = rest.length - 1; i >= 1; i--) {
    if (!LINE_BREAK.test(rest.charAt(i))) return rest.charAt(i)
  }
  return undefined
}

function headingName(text: string): string {
  return text.replace(/[*_`]/g, '').replace(/:\s*$/, '').trim().toLowerCase()
}

/** Drops what a template leaves behind when nobody filled it in: empty bullets. */
function clean(text: string): string {
  return text
    .split('\n')
    .filter((line) => !/^(?:[-*]|\d+\.)\s*(?:\[[ xX]\])?$/.test(line.trim()))
    .join('\n')
    .trim()
}
