import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/** Where every Micelio repository keeps its copy of the standard. */
export const STANDARD_PATH = 'docs/engineering-standard.md'

/** Where a repository keeps the file of each profile it pins: `docs/standard/<profile>.md`. */
const PROFILE_DIR = 'docs/standard'

/** The profile a repository with no `profile:` pin is read as (ADR-0001, point 3). */
const DEFAULT_PROFILE = 'typescript'

/**
 * The hashes of a version in the new form (ADR-0001, point 5): the core, at
 * `docs/engineering-standard.md`, and each profile file, at `docs/standard/<profile>.md`.
 */
export interface VersionHashes {
  /** The SHA-256 of `docs/engineering-standard.md`. */
  core: string
  /** The SHA-256 of `docs/standard/<profile>.md`, by profile name. */
  profiles: Record<string, string>
}

/**
 * The hashes of each released version of the standard, by `major.minor`: one string for a version
 * that is a single file (1.4 to 1.8), or {@link VersionHashes} for a version in the new form.
 */
export type StandardHashes = Record<string, string | VersionHashes>

/** The SHA-256 of each synced file (agent prompts, skills, pull request template), by path in the repository. */
export type FileHashes = Record<string, string>

/** What `lintStandard` found. */
export interface StandardResult {
  /** True when the local copy is the one published for the pinned version. */
  ok: boolean
  /** One line for the terminal, naming the pinned version. */
  message: string
}

/** The machine-readable pin in `AGENTS.md`: the version in backticks after `standard:`. */
const PIN = /(`standard:\s*)(\d+\.\d+)(`)/

/**
 * The profile pin in `AGENTS.md`: what follows `profile:` in backticks, on the line of the version
 * pin (ADR-0001, point 3). The names are taken as written, so a malformed one fails as a profile the
 * version does not have.
 */
const PROFILE_PIN = /`profile:([^`]*)`/

/**
 * The profiles a version in the old form has: its one file holds the rules that the split moves to
 * `typescript` and `site-engine` (ADR-0001, point 1).
 */
const SINGLE_FILE_PROFILES = [DEFAULT_PROFILE, 'site-engine']

/** A key of `standard-hashes.json` that names a version, as opposed to `files`. */
const VERSION_KEY = /^\d+\.\d+$/

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
 * Reads the profiles a repository pins in its `AGENTS.md`, in the order written: the names after
 * `profile:`, in backticks, comma-separated (`profile: typescript, site-engine`), on the line of the
 * version pin. A name is returned as written, malformed or not.
 *
 * @returns The profile names; `['typescript']` when the line of the version pin has no `profile:`
 *   pin, or there is no version pin (ADR-0001, point 3).
 */
export function readProfiles(agents: string): string[] {
  const line = agents.split('\n').find((text) => PIN.test(text)) ?? ''
  const pin = PROFILE_PIN.exec(line)?.[1]
  return pin === undefined ? [DEFAULT_PROFILE] : pin.split(',').map((name) => name.trim())
}

/**
 * Rewrites the pin of an `AGENTS.md`, and the sentence that repeats it, to `version`. A
 * `profile:` pin is left as it is.
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

/** Reads `standard-hashes.json`, bundled in this package. */
function readHashesFile(): Record<string, unknown> {
  const file = new URL('../standard-hashes.json', import.meta.url)
  return JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
}

/** True when `value` is a map of strings to strings. */
function isStringMap(value: unknown): value is Record<string, string> {
  return (
    typeof value === 'object' &&
    value !== null &&
    Object.values(value).every((hash) => typeof hash === 'string')
  )
}

/** True when `value` is the entry of a version in the new form. */
function isVersionHashes(value: unknown): value is VersionHashes {
  if (typeof value !== 'object' || value === null) return false
  const entry = value as Record<string, unknown>
  return typeof entry.core === 'string' && isStringMap(entry.profiles)
}

/**
 * Loads the hashes of each released version of the standard bundled in this package. An entry that
 * is neither one hash nor a version in the new form is left out.
 *
 * @param file - The parsed `standard-hashes.json`; the one bundled in this package by default.
 */
export function loadHashes(file: Record<string, unknown> = readHashesFile()): StandardHashes {
  const hashes: StandardHashes = {}
  for (const [key, value] of Object.entries(file)) {
    if (!VERSION_KEY.test(key)) continue
    if (typeof value === 'string' || isVersionHashes(value)) hashes[key] = value
  }
  return hashes
}

/** Loads the hash of each file the sync carries next to the standard, by path in the repository. */
export function loadFileHashes(): FileHashes {
  const files: FileHashes = {}
  for (const [path, value] of Object.entries(readHashesFile().files ?? {})) {
    if (typeof value === 'string') files[path] = value
  }
  return files
}

/** The newest version in `hashes`, compared as numbers. */
function latestVersion(hashes: StandardHashes): string | null {
  const order = (version: string): number[] => version.split('.').map(Number)
  const [latest] = Object.keys(hashes).sort((a, b) => {
    const [ax = 0, ay = 0] = order(a)
    const [bx = 0, by = 0] = order(b)
    return bx - ax || by - ay
  })
  return latest ?? null
}

/** The path of the file of `profile` in a repository. */
function profilePath(profile: string): string {
  return `${PROFILE_DIR}/${profile}.md`
}

/**
 * Checks that the copy of the standard in `root` is the one published for the version its
 * `AGENTS.md` pins (standard, section 16). A repository may pin an older version on purpose:
 * the pinned one is checked, not the latest. For a version in the new form it also checks the file
 * of each profile `AGENTS.md` pins (`typescript` when it pins none), and fails on a profile that
 * version does not have.
 *
 * @param root - The repository root.
 * It also checks the synced files the repository has (`.claude/agents/*.md`, the skills, the pull
 * request template) against `fileHashes`, but only when the pin is the newest version this package
 * knows: a repository that stays on an older version on purpose keeps the older files too.
 *
 * @param hashes - The published hashes; the ones bundled in this package by default.
 * @param fileHashes - The published hashes of the synced files; the bundled ones by default.
 */
export function lintStandard(
  root: string,
  hashes: StandardHashes = loadHashes(),
  fileHashes: FileHashes = loadFileHashes()
): StandardResult {
  const agentsPath = join(root, 'AGENTS.md')
  if (!existsSync(agentsPath)) {
    return {
      ok: false,
      message: 'AGENTS.md is missing: it pins the standard version (`standard: X.Y`).',
    }
  }
  const agents = readFileSync(agentsPath, 'utf8')
  const pin = readPin(agents)
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
  const core = typeof expected === 'string' ? expected : expected.core
  const profiles = readProfiles(agents)
  const known = typeof expected === 'string' ? SINGLE_FILE_PROFILES : Object.keys(expected.profiles)
  const unknown = profiles.filter((profile) => !known.includes(profile))
  if (unknown.length > 0) {
    return {
      ok: false,
      message: `AGENTS.md pins profile ${unknown.join(', ')}, which standard ${pin} does not have (it has ${known.join(', ')}): fix the profile pin.`,
    }
  }
  const actual = hashOf(readFileSync(copyPath))
  if (actual !== core) {
    return {
      ok: false,
      message: `${STANDARD_PATH} does not match standard ${pin}, the version AGENTS.md pins (sha256 ${actual}, published ${core}). Restore it, or sync it from bogd3v/micelio-engineering.`,
    }
  }
  const checked = [STANDARD_PATH]
  if (typeof expected !== 'string') {
    for (const profile of profiles) {
      const path = profilePath(profile)
      const file = join(root, path)
      if (!existsSync(file)) {
        return {
          ok: false,
          message: `${path} is missing; AGENTS.md pins standard ${pin} with profile ${profile}.`,
        }
      }
      const published = expected.profiles[profile]
      const hash = hashOf(readFileSync(file))
      if (hash !== published) {
        return {
          ok: false,
          message: `${path} does not match profile ${profile} of standard ${pin}, the version AGENTS.md pins (sha256 ${hash}, published ${published}). Restore it, or sync it from bogd3v/micelio-engineering.`,
        }
      }
      checked.push(path)
    }
  }
  const stale =
    pin === latestVersion(hashes)
      ? Object.entries(fileHashes)
          .filter(([path, hash]) => {
            const file = join(root, path)
            return existsSync(file) && hashOf(readFileSync(file)) !== hash
          })
          .map(([path]) => path)
      : []
  if (stale.length > 0) {
    return {
      ok: false,
      message: `${stale.join(', ')} ${stale.length === 1 ? 'does' : 'do'} not match the published copy of standard ${pin}. Restore ${stale.length === 1 ? 'it' : 'them'} if edited by hand, or, in a sync pull request, upgrade @micelio/eslint-config to the release that publishes the new hashes.`,
    }
  }
  if (checked.length === 1) {
    return { ok: true, message: `Standard ${pin}: ${STANDARD_PATH} matches the published copy.` }
  }
  return {
    ok: true,
    message: `Standard ${pin} (${profiles.join(', ')}): ${checked.join(', ')} match the published copy.`,
  }
}
