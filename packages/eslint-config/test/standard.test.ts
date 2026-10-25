import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { syncedFiles } from '../../../scripts/synced-files.mjs'
import {
  STANDARD_PATH,
  hashOf,
  lintStandard,
  loadFileHashes,
  loadHashes,
  readPin,
  setPin,
  standardVersion,
} from '../src/standard.js'

const ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const LINT_BIN = `${ROOT}packages/eslint-config/dist/lint-standard.js`
const APPLY = `${ROOT}scripts/apply-standard.mjs`
/** The version of the canonical copy, so the tests that use the real file follow its bumps. */
const CURRENT = standardVersion(readFileSync(join(ROOT, STANDARD_PATH), 'utf8')) ?? ''

/** The sentence both repositories' AGENTS.md carry, where the pin lives. */
const AGENTS = (version: string): string =>
  `This repository follows standard version ${version} (\`standard: ${version}\`; the line \`lint:standard\` checks).\n`

/** A repository directory with an AGENTS.md pinning `pin` and a copy of the standard with `copy`. */
function repo(pin: string | null, copy: string | null): string {
  const dir = mkdtempSync(join(tmpdir(), 'micelio-standard-'))
  if (pin) writeFileSync(join(dir, 'AGENTS.md'), AGENTS(pin))
  if (copy !== null) {
    mkdirSync(join(dir, 'docs'))
    writeFileSync(join(dir, STANDARD_PATH), copy)
  }
  return dir
}

const STANDARD = '# Micelio engineering standard\n\nVersion 1.4 (2026-10-20). Rules.\n'
const HASHES = { '1.4': hashOf(STANDARD), '1.3': hashOf('older') }

describe('pins', () => {
  it('reads the pin and the version of a copy', () => {
    expect(readPin(AGENTS('1.4'))).toBe('1.4')
    expect(readPin('no pin here')).toBeNull()
    expect(standardVersion(STANDARD)).toBe('1.4')
    expect(standardVersion('# no header')).toBeNull()
  })

  it('moves the pin and the sentence that repeats it, and nothing else', () => {
    const agents = `# Title\n\n${AGENTS('1.4')}\nOther text with standard 1.4 in prose.\n`
    expect(setPin(agents, '1.5')).toBe(
      `# Title\n\n${AGENTS('1.5')}\nOther text with standard 1.4 in prose.\n`
    )
    expect(setPin('no pin', '1.5')).toBeNull()
  })

  it('hashes bytes', () => {
    expect(hashOf('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })
})

describe('lintStandard', () => {
  it('accepts the published copy of the pinned version', () => {
    const result = lintStandard(repo('1.4', STANDARD), HASHES)
    expect(result.ok).toBe(true)
    expect(result.message).toContain('1.4')
  })

  it('fails when one character of the copy changed, naming the pinned version', () => {
    const result = lintStandard(repo('1.4', STANDARD.replace('Rules', 'Rulez')), HASHES)
    expect(result.ok).toBe(false)
    expect(result.message).toContain('does not match standard 1.4')
    expect(result.message).toContain('AGENTS.md pins')
  })

  it('checks the pinned version, not the latest', () => {
    expect(lintStandard(repo('1.3', 'older'), HASHES).ok).toBe(true)
    expect(lintStandard(repo('1.3', STANDARD), HASHES).ok).toBe(false)
  })

  it('says so when the package does not know the pinned version', () => {
    const result = lintStandard(repo('9.9', STANDARD), HASHES)
    expect(result.ok).toBe(false)
    expect(result.message).toContain('Standard 9.9')
    expect(result.message).toContain('upgrade the package')
  })

  it('fails without AGENTS.md, without a pin and without the copy', () => {
    expect(lintStandard(repo(null, STANDARD), HASHES).message).toContain('AGENTS.md is missing')
    const noPin = repo('1.4', STANDARD)
    writeFileSync(join(noPin, 'AGENTS.md'), 'nothing\n')
    expect(lintStandard(noPin, HASHES).message).toContain('pins no standard version')
    expect(lintStandard(repo('1.4', null), HASHES).message).toContain(`${STANDARD_PATH} is missing`)
  })
})

describe('the canonical copy of this repository', () => {
  const copy = readFileSync(join(ROOT, STANDARD_PATH))
  const version = standardVersion(copy.toString('utf8'))

  it('has the hash published for its own version', () => {
    expect(version).not.toBeNull()
    expect(
      loadHashes()[version ?? ''],
      `${STANDARD_PATH} is not the published copy of standard ${version}: restore it, or raise the version and add its hash`
    ).toBe(hashOf(copy))
  })

  it('is what AGENTS.md pins', () => {
    expect(readPin(readFileSync(join(ROOT, 'AGENTS.md'), 'utf8'))).toBe(version)
    const result = lintStandard(ROOT)
    expect(result.ok, result.message).toBe(true)
  })
})

describe('the synced files', () => {
  it('are the ones whose hashes are published, byte for byte', () => {
    const published = loadFileHashes()
    expect(Object.keys(published).length).toBeGreaterThan(0)
    for (const [path, hash] of Object.entries(published)) {
      expect(
        hashOf(readFileSync(join(ROOT, 'template', path))),
        `template/${path} changed: run node scripts/synced-hashes.mjs`
      ).toBe(hash)
    }
    for (const path of ['.claude/agents/worker.md', '.github/pull_request_template.md']) {
      expect(published, path).toHaveProperty([path])
    }
  })

  it('have exactly one hash each: no file under a listed path is left without one', () => {
    expect(Object.keys(loadFileHashes()).sort()).toEqual(syncedFiles().sort())
  })

  it('refuse a listed path that is empty, absolute or leaves template/', () => {
    for (const bad of ['', '.', '/etc', '../micelio', 'a/../b', './a'])
      expect(() => syncedFiles([bad]), bad).toThrow('must be a path inside template/')
  })

  it('keeps versions and files apart in the hashes file', () => {
    expect(Object.keys(loadHashes()).every((key) => /^\d+\.\d+$/.test(key))).toBe(true)
  })

  it('fails lint:standard when a synced file the repository has was edited, on the newest version', () => {
    const copy = readFileSync(join(ROOT, STANDARD_PATH), 'utf8')
    const hashes = { [CURRENT]: hashOf(copy) }
    const files = { 'a/b.md': hashOf('canonical') }
    const dir = repo(CURRENT, copy)
    expect(lintStandard(dir, hashes, files).ok).toBe(true) // the file is absent: not checked
    mkdirSync(join(dir, 'a'))
    writeFileSync(join(dir, 'a/b.md'), 'canonical')
    expect(lintStandard(dir, hashes, files).ok).toBe(true)
    writeFileSync(join(dir, 'a/b.md'), 'edited')
    const result = lintStandard(dir, hashes, files)
    expect(result.ok).toBe(false)
    expect(result.message).toContain('a/b.md does not match')
    expect(result.message).toContain('upgrade @micelio/eslint-config')
    // a repository on an older version on purpose keeps the older files
    const older = { '0.9': hashOf(copy), [CURRENT]: 'x' }
    writeFileSync(join(dir, 'AGENTS.md'), AGENTS('0.9'))
    expect(lintStandard(dir, older, files).ok).toBe(true)
  })
})

describe('micelio-lint-standard', () => {
  it('exits 0 on a matching copy and 1 with the pinned version when it was edited', () => {
    const dir = repo(CURRENT, readFileSync(join(ROOT, STANDARD_PATH), 'utf8'))
    writeFileSync(join(dir, 'AGENTS.md'), AGENTS(CURRENT))
    expect(spawnSync('node', [LINT_BIN, dir], { encoding: 'utf8' }).status).toBe(0)
    const edited = readFileSync(join(dir, STANDARD_PATH), 'utf8').replace('Micelio', 'Micelia')
    writeFileSync(join(dir, STANDARD_PATH), edited)
    const result = spawnSync('node', [LINT_BIN, dir], { encoding: 'utf8' })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain(`standard ${CURRENT}`)
  })
})

describe('apply-standard', () => {
  const source = join(ROOT, STANDARD_PATH)

  it('copies the standard and moves the pin of an older repository', () => {
    const dir = repo('1.3', 'older')
    const result = spawnSync('node', [APPLY, dir, source], { encoding: 'utf8' })
    expect(result.stdout.trim()).toBe('changed')
    expect(readPin(readFileSync(join(dir, 'AGENTS.md'), 'utf8'))).toBe(CURRENT)
    expect(readFileSync(join(dir, STANDARD_PATH), 'utf8')).toBe(readFileSync(source, 'utf8'))
  })

  it('changes nothing in a repository that is already in sync', () => {
    const dir = mkdtempSync(join(tmpdir(), 'micelio-standard-'))
    mkdirSync(join(dir, 'docs'))
    cpSync(source, join(dir, STANDARD_PATH))
    writeFileSync(join(dir, 'AGENTS.md'), AGENTS(CURRENT))
    for (const path of Object.keys(loadFileHashes())) {
      mkdirSync(dirname(join(dir, path)), { recursive: true })
      cpSync(join(ROOT, 'template', path), join(dir, path))
    }
    expect(spawnSync('node', [APPLY, dir, source], { encoding: 'utf8' }).stdout.trim()).toBe(
      'unchanged'
    )
  })

  it('copies the synced files to the same path, and then is in sync', () => {
    const dir = repo('1.3', 'older')
    const first = spawnSync('node', [APPLY, dir, source], { encoding: 'utf8' })
    expect(first.stderr).toContain('synced .claude/agents/worker.md')
    for (const path of Object.keys(loadFileHashes())) {
      expect(readFileSync(join(dir, path), 'utf8'), path).toBe(
        readFileSync(join(ROOT, 'template', path), 'utf8')
      )
    }
    expect(existsSync(join(dir, '.claude/skills/blind-review/SKILL.md'))).toBe(true)
    expect(spawnSync('node', [APPLY, dir, source], { encoding: 'utf8' }).stdout.trim()).toBe(
      'unchanged'
    )
    writeFileSync(join(dir, '.claude/agents/worker.md'), 'edited by hand')
    const again = spawnSync('node', [APPLY, dir, source], { encoding: 'utf8' })
    expect(again.stdout.trim()).toBe('changed')
    expect(readFileSync(join(dir, '.claude/agents/worker.md'), 'utf8')).not.toBe('edited by hand')
  })

  it('skips a listed path that does not exist in template/', () => {
    const present = syncedFiles(['.claude/agents'])
    expect(present.length).toBeGreaterThan(0)
    expect(syncedFiles(['.claude/skills/not-landed-yet', '.claude/agents'])).toEqual(present)
    expect(syncedFiles(['.claude/skills/not-landed-yet'])).toEqual([])
  })

  it('refuses a repository whose AGENTS.md has no pin', () => {
    const dir = repo(null, 'older')
    writeFileSync(join(dir, 'AGENTS.md'), 'nothing\n')
    const result = spawnSync('node', [APPLY, dir, source], { encoding: 'utf8' })
    expect(result.status).toBe(3)
  })
})
