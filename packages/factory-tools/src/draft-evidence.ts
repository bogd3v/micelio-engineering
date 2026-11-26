import type { DraftProblem } from './lint-draft.js'
import { EXIT, LOG, WITHOUT_CHANGE, figures, numbersBefore, testsEntries } from './verify-draft.js'

// The rules of `lint-draft` on the evidence of a draft's "Tests" section: the log of each command,
// a log or image older than the diff, and a figure its log does not hold
// (`packages/factory-tools/README.md`, `lint-draft`).

/** The fenced blocks of the "Tests" section whose first line starts `$ `, with the line above the fence. */
function testsBlocks(draft: string): { lines: string[]; intro: string }[] {
  const lines = draft.split('\n')
  const start = lines.findIndex((line) => /^#{1,6}\s+Tests\s*$/.test(line))
  if (start === -1) return []
  const depth = (line: string): number => /^(#{1,6})\s/.exec(line)?.[1]?.length ?? 7
  const level = depth(lines[start] ?? '')
  const blocks: { lines: string[]; intro: string }[] = []
  let current: string[] | null = null
  let intro = ''
  let last = ''
  for (const line of lines.slice(start + 1)) {
    if (/^\s*(?:```|~~~)/.test(line)) {
      if (current === null) {
        current = []
        intro = last
      } else {
        const body = current.map((l) => l.trim()).filter((l) => l !== '')
        if (body[0]?.startsWith('$ ')) blocks.push({ lines: body, intro })
        current = null
        last = ''
      }
    } else if (current !== null) current.push(line)
    else if (depth(line) <= level) break
    else if (line.trim() !== '') last = line.trim()
  }
  return blocks
}

/** A problem for a log the packet lacks: `name` is what the draft writes after `logs/`. */
function missingLog(files: string[], name: string | undefined): string | null {
  if (name === undefined)
    return 'names no log file: add `log: logs/<name>.log` or `logs/<name>.log`'
  const clean = name.replace(/^\.?\/+/, '')
  return files.includes(clean)
    ? null
    : `its log \`logs/${clean}\` is not a file in the packet's logs directory`
}

/**
 * One problem for each command of the "Tests" section with no log in the packet (`G2`): a fenced
 * block whose first line starts `$ ` and an item that starts with a command in backticks. A run shown
 * failing (`without the change`, not exit 0) needs none.
 */
export function logProblems(draft: string, files: string[] | undefined): DraftProblem[] {
  if (files === undefined) return []
  const problems: DraftProblem[] = []
  for (const block of testsBlocks(draft)) {
    if (WITHOUT_CHANGE.test(block.intro)) continue
    const command = (block.lines[0] ?? '').replace(/^\$\s+/, '')
    const named = block.lines.map((l) => /^log:\s*(\S+)/.exec(l)?.[1]).find((n) => n !== undefined)
    const problem = missingLog(files, named?.replace(/^logs\//, ''))
    if (problem !== null) problems.push({ line: command, problem: `the block ${problem}` })
  }
  for (const entry of testsEntries(draft) ?? []) {
    const parsed = /^`([^`]+)`(.*)$/.exec(entry.text)
    if (parsed === null) continue
    const summary = parsed[2] ?? ''
    if (
      (WITHOUT_CHANGE.test(entry.text) || WITHOUT_CHANGE.test(entry.intro)) &&
      EXIT.exec(summary)?.[1] !== '0'
    )
      continue
    const problem = missingLog(files, LOG.exec(summary)?.[1])
    if (problem !== null)
      problems.push({ line: (parsed[1] ?? '').trim(), problem: `the item ${problem}` })
  }
  return problems
}

/** A round named in a Tests entry or in the line above a fenced block: `round 2`. */
const ROUND = /\brounds?\s+\d+/i

/** The files an entry or block names: each `logs/<file>` and each path that ends `.png`. */
function namedFiles(text: string): string[] {
  const names = [
    ...(text.match(/\blogs\/[^\s`),;]+/g) ?? []),
    ...(text.match(/[^\s`(),;"']+\.png\b/g) ?? []),
  ].map((name) => name.replace(/[.:]+$/, '').replace(/^\.?\/+/, ''))
  return [...new Set(names)]
}

/**
 * What the "Tests" section names as evidence, with the line to blame and whether the entry is
 * exempt: a run shown failing without the change, or an entry (or the line above its block) that
 * names its round.
 */
function evidenceItems(draft: string): { line: string; names: string[]; exempt: boolean }[] {
  const items: { line: string; names: string[]; exempt: boolean }[] = []
  for (const block of testsBlocks(draft)) {
    const failing = WITHOUT_CHANGE.test(block.intro)
    const named = block.lines.join(' ')
    items.push({
      line: (block.lines[0] ?? '').replace(/^\$\s+/, ''),
      names: namedFiles(named),
      exempt: failing || ROUND.test(block.intro),
    })
  }
  for (const entry of testsEntries(draft) ?? []) {
    const parsed = /^`([^`]+)`(.*)$/.exec(entry.text)
    const failing =
      (WITHOUT_CHANGE.test(entry.text) || WITHOUT_CHANGE.test(entry.intro)) &&
      EXIT.exec(parsed?.[2] ?? '')?.[1] !== '0'
    items.push({
      line: (parsed?.[1] ?? entry.text).trim(),
      names: namedFiles(entry.text),
      exempt: failing || ROUND.test(entry.text),
    })
  }
  return items
}

/** The files the "Tests" section names whose times the rule needs (`runLintDraft` reads them). */
export function evidenceNames(draft: string): string[] {
  return [
    ...new Set(
      evidenceItems(draft)
        .filter((item) => !item.exempt)
        .flatMap((item) => item.names)
    ),
  ]
}

const iso = (ms: number): string => new Date(ms).toISOString()

/**
 * One problem for each log or image a "Tests" entry names that is older than the newest file the
 * diff changes, unless the entry names its round (`G2.6`). Skipped without both sets of times.
 */
export function staleEvidenceProblems(
  draft: string,
  evidence: Record<string, number> | undefined,
  changed: Record<string, number> | undefined
): DraftProblem[] {
  if (evidence === undefined || changed === undefined) return []
  const newest = Object.entries(changed).reduce<[string, number] | null>(
    (best, entry) => (best === null || entry[1] > best[1] ? entry : best),
    null
  )
  if (newest === null) return []
  const problems: DraftProblem[] = []
  for (const item of evidenceItems(draft)) {
    if (item.exempt) continue
    for (const name of item.names) {
      const time = evidence[name]
      if (time === undefined || time >= newest[1]) continue
      problems.push({
        line: item.line,
        problem: `\`${name}\` (${iso(time)}) is older than \`${newest[0]}\` (${iso(newest[1])}), a file the diff changes (G2.6): run the command again, or name its round as "round <k>" in the entry`,
      })
    }
  }
  return problems
}

/** The log an entry names, as the file after `logs/` (`npm-test.log`); `undefined` when it names none. */
function namedLog(summary: string): string | undefined {
  return LOG.exec(summary)?.[1]
    ?.replace(/[.:]+$/, '')
    .replace(/^\.?\/+/, '')
}

/** The logs the figures rule needs (`runLintDraft` reads them): those named by an entry that is not a run shown failing. */
export function figureLogNames(draft: string): string[] {
  const names: string[] = []
  for (const entry of testsEntries(draft) ?? []) {
    const parsed = /^`([^`]+)`(.*)$/.exec(entry.text)
    if (parsed === null) continue
    const summary = parsed[2] ?? ''
    if (
      (WITHOUT_CHANGE.test(entry.text) || WITHOUT_CHANGE.test(entry.intro)) &&
      EXIT.exec(summary)?.[1] !== '0'
    )
      continue
    const name = namedLog(summary)
    if (name !== undefined) names.push(name)
  }
  return [...new Set(names)]
}

/**
 * One problem for each figure of a "Tests" entry that the log the entry names does not hold, with
 * `verify-draft`'s rules (`figures` and `numbersBefore`): a word the log never counts is prose,
 * unless no figure of the line is counted at all. A run shown failing and a log that is not there
 * (`logProblems` reports it) are skipped, as is the whole rule without `logs`.
 */
export function figureProblems(
  draft: string,
  logs: Record<string, string> | undefined
): DraftProblem[] {
  if (logs === undefined) return []
  const problems: DraftProblem[] = []
  for (const entry of testsEntries(draft) ?? []) {
    const parsed = /^`([^`]+)`(.*)$/.exec(entry.text)
    if (parsed === null) continue
    const summary = parsed[2] ?? ''
    if (
      (WITHOUT_CHANGE.test(entry.text) || WITHOUT_CHANGE.test(entry.intro)) &&
      EXIT.exec(summary)?.[1] !== '0'
    )
      continue
    const name = namedLog(summary)
    const text = name === undefined ? undefined : logs[name]
    if (name === undefined || text === undefined) continue
    const counted = figures(summary).map(
      ([number, word]) => [number, word, numbersBefore(text, word)] as const
    )
    const compared = counted.some(([, , got]) => got.length > 0)
      ? counted.filter(([, , got]) => got.length > 0)
      : counted
    for (const [number, word, got] of compared) {
      if (got.includes(number)) continue
      problems.push({
        line: (parsed[1] ?? '').trim(),
        problem:
          got.length === 0
            ? `the figure "${number} ${word}" is not in \`logs/${name}\`: it has no "<n> ${word}"`
            : `the figure "${number} ${word}" is not in \`logs/${name}\`: it has ${[...new Set(got)].join(' or ')}`,
      })
    }
  }
  return problems
}
