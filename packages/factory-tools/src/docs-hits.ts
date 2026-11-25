import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { dirname, posix, resolve } from 'node:path'
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

/** One hunk of a file in the new version: `count` lines from `start`; 0 lines is a deletion after `start`. */
interface Hunk {
  start: number
  count: number
}

/** The hunks of each path of a `git diff -U0 --no-renames`, as the new file has them. */
function hunksByPath(diff: string): Map<string, Hunk[]> {
  const byPath = new Map<string, Hunk[]>()
  let hunks: Hunk[] | undefined
  for (const line of diff.split('\n')) {
    const path = /^diff --git a\/(.+) b\/\1$/.exec(line)?.[1]
    if (path !== undefined) {
      hunks = []
      byPath.set(path, hunks)
      continue
    }
    const match = /^@@ -\S+ \+(\d+)(?:,(\d+))? @@/.exec(line)
    if (match !== null && hunks !== undefined)
      hunks.push({ start: Number(match[1]), count: match[2] === undefined ? 1 : Number(match[2]) })
  }
  return byPath
}

/** The paths of the diff that are neither Markdown nor tests, in order. */
function changedSources(diff: string): string[] {
  return [...touchedPaths(diff)].filter((path) => !isMarkdown(path) && !isTestFile(path))
}

/**
 * The lines of the leading comment block of a source file: the first and the last line of the
 * comment lines before its first line of code (`//`, `/* … *\/` and `#` comments; blank lines and a
 * `#!` line do not end it), or `undefined` when the first line of code comes first.
 */
function headerComment(text: string): { first: number; last: number } | undefined {
  let first = 0
  let last = 0
  let inBlock = false
  const lines = text.split('\n')
  for (const [index, raw] of lines.entries()) {
    const line = raw.trim()
    const number = index + 1
    if (inBlock) {
      last = number
      if (line.includes('*/')) inBlock = false
    } else if (line === '' || (number === 1 && line.startsWith('#!'))) continue
    else if (line.startsWith('/*')) {
      if (first === 0) first = number
      last = number
      inBlock = !line.includes('*/')
    } else if (line.startsWith('//') || line.startsWith('#')) {
      if (first === 0) first = number
      last = number
    } else break
  }
  return first === 0 ? undefined : { first, last }
}

/** Whether a hunk of the new file lies in lines `first` to `last`, a deletion after `last` included. */
function touchesLines(hunks: Hunk[], first: number, last: number): boolean {
  return hunks.some(({ start, count }) =>
    count === 0 ? start >= first && start <= last : start <= last && start + count - 1 >= first
  )
}

/** Whether `text` names `path` as a path: no word character, `-` or `/` before it (a `./` is fine), no word character after. */
function namesPath(text: string, path: string): boolean {
  for (let at = text.indexOf(path); at !== -1; at = text.indexOf(path, at + 1)) {
    const before = text[at - 1] ?? ''
    const after = text[at + path.length] ?? ''
    const dotSlash = before === '/' && text[at - 2] === '.' && !/[\w.-]/.test(text[at - 3] ?? '')
    if ((dotSlash || !/[\w/-]/.test(before)) && !/\w/.test(after)) return true
  }
  return false
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

/**
 * Each line of `documents` that names a changed file by its path from the root or from the
 * document's directory, once per file: `path`, `line` and the `changed` file, in the order of the
 * documents, their lines, then the changed files.
 */
function findNamed(
  changed: string[],
  documents: { path: string; text: string }[]
): { path: string; line: number; changed: string }[] {
  return documents.flatMap(({ path, text }) => {
    const directory = dirname(path)
    const forms = changed.map((file) => ({
      file,
      names: new Set([file, posix.relative(directory, file)]),
    }))
    return text
      .split('\n')
      .flatMap((content, index) =>
        forms
          .filter(({ names }) => [...names].some((form) => namesPath(content, form)))
          .map(({ file }) => ({ path, line: index + 1, changed: file }))
      )
  })
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
 * Markdown file that the diff does not touch names a term the diff removed from code
 * (`<path>:<line>: <term>`); each line of a tracked Markdown file, touched or not, that names a
 * changed file that is neither Markdown nor a test (`<path>:<line>: names <changed file>`); and the
 * leading comment block of each such file that the diff does not touch
 * (`<changed file>:<line>: header comment`); then a verdict line. With `--draft`, a path answered
 * in "For review" is not listed: a document's for its lines, a changed file's for its header
 * comment. It only reads.
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
    const changed = changedSources(diff)
    const documents: { path: string; text: string }[] = []
    if (terms.length > 0 || changed.length > 0) {
      for (const path of await real.markdownFiles()) {
        if (answered.has(path)) continue
        try {
          documents.push({ path, text: await real.readText(path) })
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        }
      }
    }
    const unchanged = documents.filter(({ path }) => !touched.has(path))
    const termHits = findHits(terms, unchanged)
    const namedHits = findNamed(changed, documents)
    const hunks = hunksByPath(diff)
    const headers: string[] = []
    for (const file of changed) {
      if (answered.has(file)) continue
      let text: string
      try {
        text = await real.readText(file)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
        throw error
      }
      const header = headerComment(text)
      if (header !== undefined && !touchesLines(hunks.get(file) ?? [], header.first, header.last))
        headers.push(`${file}:${header.first}: header comment\n`)
    }
    const lines = [
      ...termHits.map((hit) => `${hit.path}:${hit.line}: ${hit.term}\n`),
      ...namedHits.map((hit) => `${hit.path}:${hit.line}: names ${hit.changed}\n`),
      ...headers,
    ]
    const body = lines.join('')
    const hits = lines
    const verdict =
      hits.length === 0
        ? `docs-hits · base ${base} · no hit\n`
        : `docs-hits · base ${base} · ${hits.length} hit(s): answer each in "For review" with "docs-hits: <path> - <why it is still true>"\n`
    return { code: hits.length === 0 ? 0 : 1, stdout: body + verdict, stderr: '' }
  } catch (error) {
    return { code: 2, stdout: '', stderr: `error: ${errorLine(error)}\n` }
  }
}
