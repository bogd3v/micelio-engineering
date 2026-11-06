import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/** One rule of `micelio-lint-ee`: a line that matches `pattern` fails with `message`. */
export interface EeRule {
  /** The text that marks the line as Strapi Enterprise code. */
  pattern: RegExp
  /** What the line does, as it appears in the report. */
  message: string
}

/**
 * The three rules of `micelio-cms`'s `scripts/check-no-ee.mjs`, none dropped or narrowed
 * (Strapi Enterprise code is not AGPL-compatible, bogd3v/micelio-cms#96).
 */
export const EE_RULES: readonly EeRule[] = [
  {
    pattern: /STRAPI_LICENSE/,
    message: 'sets or reads STRAPI_LICENSE (Strapi Enterprise license key)',
  },
  {
    pattern: /['"]@strapi\/(review-workflows|content-releases)['"/]/,
    message: 'imports a Strapi Enterprise package',
  },
  { pattern: /['"]@strapi\/[^'"]+\/ee(\/|['"])/, message: 'imports Strapi code under ee/' },
]

/** The tracked files that can hold code or configuration: the ones the script of `micelio-cms` reads. */
const SCANNED = /\.(m?[jt]sx?|json|ya?ml|sh|env\.example)$|(^|\/)(Dockerfile|\.env\.example)$/

/** What `lintEe` found. */
export interface EeResult {
  /** True when no scanned file matches a rule. */
  ok: boolean
  /** One `path:line message` per match. */
  failures: string[]
  /** How many files were scanned. */
  checked: number
  /** One line for the terminal. */
  message: string
}

/**
 * Scans the files git tracks in `root` for Strapi Enterprise code.
 *
 * @param root - The repository directory.
 * @param allow - The tracked paths, relative to `root`, that may name the patterns (a licence list, the lockfile).
 * @returns The matches, one per line and rule.
 */
export function lintEe(root: string, allow: readonly string[] = []): EeResult {
  const files = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' })
    .split('\n')
    .filter((file) => file && !allow.includes(file) && SCANNED.test(file))
  const failures: string[] = []
  for (const file of files) {
    readFileSync(join(root, file), 'utf8')
      .split('\n')
      .forEach((line, index) => {
        for (const rule of EE_RULES) {
          if (rule.pattern.test(line)) failures.push(`${file}:${index + 1} ${rule.message}`)
        }
      })
  }
  const ok = failures.length === 0
  return {
    ok,
    failures,
    checked: files.length,
    message: ok
      ? `No Strapi Enterprise code enabled (${files.length} files checked).`
      : 'Strapi Enterprise code must stay disabled: see THIRD-PARTY.md.',
  }
}
