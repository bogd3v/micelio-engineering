import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { errorLine } from './errors.js'
import { isTestFile, sectionLines } from './lint-draft.js'

/** One place a tracked Markdown file names a term the diff removed. */
export interface DocsHit {
  path: string
  /** The 1-based line of the file. */
  line: number
  term: string
}

/** The shortest token that is a term. */
const MIN_TERM = 6

/** Words joined by `.`, `:`, `/` or `-`, each joiner between word characters. */
const JOINED = /[A-Za-z0-9_]+(?:[.:/-][A-Za-z0-9_]+)+/g

/** Capitals with `_`: `DRAFT_PAGE_POPULATE`. */
const CAPITALS = /(?<![A-Za-z0-9_])[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+/g

const isMarkdown = (path: string): boolean => /\.md$/i.test(path)

/**
 * The terms of the lines `git diff -U0` removes from files that are neither Markdown, tests nor
 * generated: the tokens of 6 or more characters that hold a letter and a joiner between word
 * characters, or are written in capitals with `_` that start at a word boundary. A removed line
 * that the diff adds back to the same file, whitespace at its ends aside, was reindented or moved
 * and gives no term; any other added line is not subtracted. In order of appearance, once each.
 *
 * @param diff - The output of `git diff -U0 --no-renames <base>`.
 * @param generated - The paths git marks generated: they give no term.
 */
export function removedTerms(diff: string, generated: ReadonlySet<string> = new Set()): string[] {
  const removed: { path: string; text: string }[] = []
  const added = new Set<string>()
  let path = ''
  let inHunk = false
  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git ')) {
      path = /^diff --git a\/(.+) b\/\1$/.exec(line)?.[1] ?? ''
      inHunk = false
    } else if (line.startsWith('@@')) inHunk = true
    else if (inHunk && path !== '') {
      if (line.startsWith('+')) added.add(`${path}\0${line.slice(1).trim()}`)
      else if (
        line.startsWith('-') &&
        !isMarkdown(path) &&
        !isTestFile(path) &&
        !generated.has(path)
      )
        removed.push({ path, text: line.slice(1) })
    }
  }
  const terms = new Set<string>()
  for (const { path: file, text } of removed) {
    if (added.has(`${file}\0${text.trim()}`)) continue
    for (const [token] of [...text.matchAll(JOINED), ...text.matchAll(CAPITALS)])
      if (token.length >= MIN_TERM && /[A-Za-z]/.test(token)) terms.add(token)
  }
  return [...terms]
}

/** The paths the diff touches (`diff --git` headers of a diff made with `--no-renames`). */
export function touchedPaths(diff: string): Set<string> {
  const paths = new Set<string>()
  for (const line of diff.split('\n')) {
    const path = /^diff --git a\/(.+) b\/\1$/.exec(line)?.[1]
    if (path !== undefined) paths.add(path)
  }
  return paths
}

/** The paths a draft's "For review" section answers: `docs-hits: <path> - <why it is still true>`, a `:<line>` after the path ignored. */
export function answeredPaths(draft: string): Set<string> {
  const answered = new Set<string>()
  for (const line of sectionLines(draft, 'For review') ?? []) {
    const path = /^docs-hits: (.+?) - \S.*$/.exec(line)?.[1]
    if (path !== undefined)
      answered.add(
        path
          .trim()
          .replace(/^`|`$/g, '')
          .replace(/:\d+(?:-\d+)?$/, '')
      )
  }
  return answered
}

/** Whether `term` is in `text` and no word character touches it on either side. */
function names(text: string, term: string): boolean {
  for (let at = text.indexOf(term); at !== -1; at = text.indexOf(term, at + 1)) {
    const before = text[at - 1] ?? ''
    const after = text[at + term.length] ?? ''
    if (!/\w/.test(before) && !/\w/.test(after)) return true
  }
  return false
}

/**
 * Each place a Markdown file in `documents` names one of `terms`, in the order of the paths, then
 * their lines, then the terms.
 *
 * @param documents - The tracked Markdown files the diff does not touch: path and text.
 */
export function findHits(terms: string[], documents: { path: string; text: string }[]): DocsHit[] {
  return documents.flatMap(({ path, text }) =>
    text
      .split('\n')
      .flatMap((content, index) =>
        terms
          .filter((term) => names(content, term))
          .map((term) => ({ path, line: index + 1, term }))
      )
  )
}

/** What `runDocsHits` needs from the outside world, so that tests can replace git and the disk. */
export interface DocsHitsDeps {
  /** The output of `git diff -U0 --no-renames <base>`, the new files in it. */
  diff: (base: string) => Promise<string>
  /** The tracked Markdown files, sorted. */
  markdownFiles: () => Promise<string[]>
  readText: (path: string) => Promise<string>
  /** Of `paths`, those `git check-attr linguist-generated` prints `set` or `true` for. */
  generatedFiles: (paths: string[]) => Promise<Set<string>>
}

/** The outcome of `runDocsHits`: 0 when nothing is listed, 1 when a hit is, 2 on a usage or read error. */
export interface DocsHitsResult {
  code: 0 | 1 | 2
  stdout: string
  stderr: string
}

const exec = promisify(execFile)

/**
 * The real dependencies: git in `cwd`, the files of its worktree.
 *
 * @param cwd - The worktree the diff is read in; a relative path (the draft) is read from it.
 */
export function createDocsHitsDeps(cwd: string): DocsHitsDeps {
  return {
    diff: async (base) => {
      const { stdout } = await exec(
        'git',
        [
          '-c',
          'core.quotePath=false',
          'diff',
          '-U0',
          '--no-renames',
          '--no-color',
          '--end-of-options',
          base,
        ],
        { cwd, maxBuffer: 1 << 28 }
      )
      return stdout
    },
    markdownFiles: async () => {
      const { stdout } = await exec('git', ['-c', 'core.quotePath=false', 'ls-files', '-z'], {
        cwd,
        maxBuffer: 1 << 28,
      })
      return stdout.split('\0').filter((path) => isMarkdown(path))
    },
    readText: (path) => readFile(resolve(cwd, path), 'utf8'),
    generatedFiles: async (paths) => {
      if (paths.length === 0) return new Set()
      const { stdout } = await exec(
        'git',
        ['check-attr', '-z', 'linguist-generated', '--', ...paths],
        { cwd, maxBuffer: 1 << 28 }
      )
      const fields = stdout.split('\0')
      const generated = new Set<string>()
      // Each record is <path> NUL <attribute> NUL <value> NUL.
      for (let i = 0; i + 2 < fields.length; i += 3) {
        if (['set', 'true'].includes(fields[i + 2] ?? '')) generated.add(fields[i] ?? '')
      }
      return generated
    },
  }
}

const USAGE = 'Usage:\n  factory-tools docs-hits --base <rev> [--cwd <worktree>] [--draft <file>]\n'

/**
 * `factory-tools docs-hits --base <rev> [--cwd <worktree>] [--draft <file>]`: the places a tracked
 * Markdown file that the diff does not touch names a term the diff removed from code, one line
 * `<path>:<line>: <term>` each and a verdict line. With `--draft`, a path answered in "For review"
 * is not listed. It only reads.
 *
 * @param argv - The arguments after the program name, starting with `docs-hits`.
 * @param deps - Replaces git and the disk; by default git in `--cwd` (else the current directory).
 */
export async function runDocsHits(argv: string[], deps?: DocsHitsDeps): Promise<DocsHitsResult> {
  const values = new Map<string, string>()
  const args = argv.slice(1)
  for (let i = 0; i < args.length; i++) {
    const name = args[i] ?? ''
    const value = args[i + 1]
    if (!['--base', '--cwd', '--draft'].includes(name) || value === undefined) {
      return { code: 2, stdout: '', stderr: `error: bad argument "${name}"\n${USAGE}` }
    }
    values.set(name, value)
    i++
  }
  const base = values.get('--base')
  if (base === undefined) {
    return { code: 2, stdout: '', stderr: `error: docs-hits needs --base\n${USAGE}` }
  }
  const real = deps ?? createDocsHitsDeps(values.get('--cwd') ?? process.cwd())
  try {
    const draft = values.get('--draft')
    const answered =
      draft === undefined ? new Set<string>() : answeredPaths(await real.readText(draft))
    const diff = await real.diff(base)
    const touched = touchedPaths(diff)
    const terms = removedTerms(diff, await real.generatedFiles([...touched]))
    const documents: { path: string; text: string }[] = []
    if (terms.length > 0) {
      for (const path of await real.markdownFiles()) {
        if (touched.has(path) || answered.has(path)) continue
        try {
          documents.push({ path, text: await real.readText(path) })
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        }
      }
    }
    const hits = findHits(terms, documents)
    const body = hits.map((hit) => `${hit.path}:${hit.line}: ${hit.term}\n`).join('')
    const verdict =
      hits.length === 0
        ? `docs-hits · base ${base} · no hit\n`
        : `docs-hits · base ${base} · ${hits.length} hit(s): answer each in "For review" with "docs-hits: <path> - <why it is still true>"\n`
    return { code: hits.length === 0 ? 0 : 1, stdout: body + verdict, stderr: '' }
  } catch (error) {
    return { code: 2, stdout: '', stderr: `error: ${errorLine(error)}\n` }
  }
}
