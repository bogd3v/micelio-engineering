// The files `.github/standard-sync.json` syncs next to the standard: the agent prompts, the skills and
// the pull request template. They live under `template/` and land at the same path in a repository.
// A listed path that does not exist yet (a skill that has not landed) is skipped, not an error.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { isAbsolute, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = fileURLToPath(new URL('../', import.meta.url))

/** Every file below `path` (or `path` itself), relative to `base`, in a stable order. */
function filesUnder(base, path) {
  const full = join(base, path)
  if (!existsSync(full)) return []
  if (!statSync(full).isDirectory()) return [path]
  return readdirSync(full)
    .sort()
    .flatMap((name) => filesUnder(base, join(path, name)))
}

/** The synced files that exist, as paths relative to `template/` and to the target repository. */
export function syncedFiles(
  files = JSON.parse(readFileSync(join(ROOT, '.github/standard-sync.json'), 'utf8')).files ?? []
) {
  for (const entry of files) {
    if (
      entry === '' ||
      entry === '.' ||
      isAbsolute(entry) ||
      normalize(entry) !== entry ||
      entry.split('/').includes('..')
    ) {
      throw new Error(`.github/standard-sync.json: "${entry}" must be a path inside template/`)
    }
  }
  return files.flatMap((entry) => filesUnder(join(ROOT, 'template'), entry))
}
