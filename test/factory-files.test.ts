import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const SYNCED = (
  JSON.parse(readFileSync(join(ROOT, '.github/standard-sync.json'), 'utf8')) as { files: string[] }
).files

/** Every file at `path` (a file or a directory) relative to `base`, or none when it does not exist. */
function filesAt(base: string, path: string): string[] {
  const full = join(base, path)
  let stats
  try {
    stats = statSync(full)
  } catch {
    return []
  }
  if (!stats.isDirectory()) return [path]
  return readdirSync(full)
    .sort()
    .flatMap((name) => filesAt(base, join(path, name)))
}

/** Listed in `standard-sync.json` before #39 adds them to `template/`; remove each one when its source lands. */
const PENDING = ['.claude/skills/blind-review', '.claude/skills/verify-pr']

describe("this repository's own factory files", () => {
  const template = join(ROOT, 'template')

  it('holds a byte-identical copy of every synced file that template/ has', () => {
    for (const path of SYNCED.filter((p) => !PENDING.includes(p))) {
      expect(filesAt(template, path).length, `${path} is missing from template/`).toBeGreaterThan(0)
    }
    for (const path of PENDING) {
      expect(filesAt(template, path), `${path} landed: remove it from PENDING`).toEqual([])
    }
    expect(SYNCED).toContain('.claude/skills/ship-pr')
    expect(SYNCED).not.toContain('.claude/skills')
    const expected = SYNCED.flatMap((path) => filesAt(template, path))
    expect(expected.length).toBeGreaterThan(0)
    for (const file of expected) {
      expect(readFileSync(join(ROOT, file)).equals(readFileSync(join(template, file))), file).toBe(
        true
      )
    }
  })

  it('holds no synced file that template/ lacks', () => {
    for (const path of SYNCED) {
      const own = filesAt(ROOT, path)
      const source = filesAt(template, path)
      expect(own, path).toEqual(source)
    }
  })
})
