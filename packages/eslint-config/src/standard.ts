import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/** Where every Micelio repository keeps its copy of the standard. */
export const STANDARD_PATH = 'docs/engineering-standard.md'

/** The SHA-256 of each released version of the standard, by `major.minor`. */
export type StandardHashes = Record<string, string>

/** What `lintStandard` found. */
export interface StandardResult {
  /** True when the local copy is the one published for the pinned version. */
  ok: boolean
  /** One line for the terminal, naming the pinned version. */
  message: string
}

/** The machine-readable pin in `AGENTS.md`: the version in backticks after `standard:`. */
const PIN = /(`standard:\s*)(\d+\.\d+)(`)/

/** The sentence of `AGENTS.md` that says the same in words, kept in step with the pin. */
const PIN_IN_WORDS = /(follows standard version )(\d+\.\d+)/

/** The version line of the standard itself: `Version 1.4 (2026-10-20).` */
const HEADER = /^Version (\d+\.\d+) /m

/** Hex SHA-256 of the bytes of a file. */
export function hashOf(content: Buffer | string): string {
  return createHash('sha256').update(content).digest('hex')
}

/** Reads the version a repository pins in its `AGENTS.md`, or `null` when there is no pin. */
export function readPin(agents: string): string | null {
  return PIN.exec(agents)?.[2] ?? null
}

/**
 * Rewrites the pin of an `AGENTS.md`, and the sentence that repeats it, to `version`.
 *
 * @returns The new text, or `null` when `agents` has no pin to rewrite.
 */
export function setPin(agents: string, version: string): string | null {
  if (!PIN.test(agents)) return null
  return agents.replace(PIN, `$1${version}$3`).replace(PIN_IN_WORDS, `$1${version}`)
}

/** Reads the version a copy of the standard says it is, or `null` when its header is missing. */
export function standardVersion(standard: string): string | null {
  return HEADER.exec(standard)?.[1] ?? null
}

/** Loads the hashes bundled in this package. */
export function loadHashes(): StandardHashes {
  const file = new URL('../standard-hashes.json', import.meta.url)
  return JSON.parse(readFileSync(file, 'utf8')) as StandardHashes
}

/**
 * Checks that the copy of the standard in `root` is the one published for the version its
 * `AGENTS.md` pins (standard, section 16). A repository may pin an older version on purpose:
 * the pinned one is checked, not the latest.
 *
 * @param root - The repository root.
 * @param hashes - The published hashes; the ones bundled in this package by default.
 */
export function lintStandard(root: string, hashes: StandardHashes = loadHashes()): StandardResult {
  const agentsPath = join(root, 'AGENTS.md')
  if (!existsSync(agentsPath)) {
    return {
      ok: false,
      message: 'AGENTS.md is missing: it pins the standard version (`standard: X.Y`).',
    }
  }
  const pin = readPin(readFileSync(agentsPath, 'utf8'))
  if (!pin) {
    return {
      ok: false,
      message: 'AGENTS.md pins no standard version: add `standard: X.Y` (section 16).',
    }
  }
  const copyPath = join(root, STANDARD_PATH)
  if (!existsSync(copyPath)) {
    return { ok: false, message: `${STANDARD_PATH} is missing; AGENTS.md pins standard ${pin}.` }
  }
  const expected = hashes[pin]
  if (!expected) {
    const known = Object.keys(hashes).join(', ')
    return {
      ok: false,
      message: `Standard ${pin}, pinned in AGENTS.md, is unknown to this version of @micelio/eslint-config (it knows ${known}): upgrade the package or fix the pin.`,
    }
  }
  const actual = hashOf(readFileSync(copyPath))
  if (actual !== expected) {
    return {
      ok: false,
      message: `${STANDARD_PATH} does not match standard ${pin}, the version AGENTS.md pins (sha256 ${actual}, published ${expected}). Restore it, or sync it from bogd3v/micelio-engineering.`,
    }
  }
  return { ok: true, message: `Standard ${pin}: ${STANDARD_PATH} matches the published copy.` }
}
