import { spawnSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
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
  readProfiles,
  setPin,
  standardVersion,
} from '../src/standard.js'

const ROOT = fileURLToPath(new URL('../../../', import.meta.url))
/** Where the canonical copy keeps its profile files. */
const PROFILE_DIR = 'docs/standard'
/** The published standard 1.8, the last version in one file, byte for byte. */
const STANDARD_1_8 = fileURLToPath(new URL('./fixtures/standard-1.8.md', import.meta.url))
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

/** The pin line of ADR-0001, point 3: the version and the profiles on one line. */
const AGENTS_WITH_PROFILE = (version: string, profiles: string): string =>
  `This repository follows standard version ${version} (\`standard: ${version}\`, \`profile: ${profiles}\`; the line \`lint:standard\` checks).\n`

const CORE = '# Micelio engineering standard\n\nVersion 2.0 (2026-12-01). Core.\n'
const PROFILES = { typescript: '# TypeScript profile\n', 'site-engine': '# Site engine profile\n' }
/** A version in the new form next to one in the old form, as `standard-hashes.json` may hold them. */
const SPLIT_HASHES = {
  ...HASHES,
  '2.0': {
    core: hashOf(CORE),
    profiles: {
      typescript: hashOf(PROFILES.typescript),
      'site-engine': hashOf(PROFILES['site-engine']),
    },
  },
}

/** A repository on 2.0 whose `AGENTS.md` pins `profiles` (none when `null`), with every profile file. */
function splitRepo(profiles: string | null): string {
  const dir = repo('2.0', CORE)
  if (profiles) writeFileSync(join(dir, 'AGENTS.md'), AGENTS_WITH_PROFILE('2.0', profiles))
  mkdirSync(join(dir, 'docs/standard'))
  for (const [name, text] of Object.entries(PROFILES)) {
    writeFileSync(join(dir, `docs/standard/${name}.md`), text)
  }
  return dir
}

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

  it('reads the profile pin, and no profile pin as typescript', () => {
    expect(readProfiles(AGENTS_WITH_PROFILE('2.0', 'rust'))).toEqual(['rust'])
    expect(readProfiles(AGENTS_WITH_PROFILE('2.0', 'typescript, site-engine'))).toEqual([
      'typescript',
      'site-engine',
    ])
    expect(readProfiles(AGENTS_WITH_PROFILE('2.0', 'typescript,site-engine'))).toEqual([
      'typescript',
      'site-engine',
    ])
    expect(readPin(AGENTS_WITH_PROFILE('2.0', 'rust'))).toBe('2.0')
    expect(readProfiles(AGENTS('1.8'))).toEqual(['typescript'])
    expect(readProfiles('profile: rust, outside backticks')).toEqual(['typescript'])
    // only the line of the version pin is read
    expect(readProfiles(`${AGENTS('1.8')}Later: \`profile: rust\`.\n`)).toEqual(['typescript'])
  })

  it('moves the version pin and leaves the profile pin', () => {
    const agents = `# Title\n\n${AGENTS_WITH_PROFILE('2.0', 'typescript, site-engine')}`
    expect(setPin(agents, '2.1')).toBe(
      `# Title\n\n${AGENTS_WITH_PROFILE('2.1', 'typescript, site-engine')}`
    )
    const dir = repo('1.3', 'older')
    writeFileSync(join(dir, 'AGENTS.md'), AGENTS_WITH_PROFILE('1.3', 'typescript, site-engine'))
    const source = join(ROOT, STANDARD_PATH)
    expect(spawnSync('node', [APPLY, dir, source], { encoding: 'utf8' }).stdout.trim()).toBe(
      'changed'
    )
    expect(readFileSync(join(dir, 'AGENTS.md'), 'utf8')).toBe(
      AGENTS_WITH_PROFILE(CURRENT, 'typescript, site-engine')
    )
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

  it('checks the core and each pinned profile of a version in the new form', () => {
    const both = lintStandard(splitRepo('typescript, site-engine'), SPLIT_HASHES)
    expect(both).toEqual({
      ok: true,
      message:
        'Standard 2.0 (typescript, site-engine): docs/engineering-standard.md, docs/standard/typescript.md, docs/standard/site-engine.md match the published copy.',
    })
    // no profile pin is read as typescript: the site engine file is not checked
    const noPin = splitRepo(null)
    writeFileSync(join(noPin, 'docs/standard/site-engine.md'), 'edited')
    expect(lintStandard(noPin, SPLIT_HASHES)).toMatchObject({ ok: true })
    expect(lintStandard(noPin, SPLIT_HASHES).message).toContain('(typescript)')
    // the core is still checked
    const core = splitRepo('typescript')
    writeFileSync(join(core, STANDARD_PATH), CORE.replace('Core', 'Corr'))
    expect(lintStandard(core, SPLIT_HASHES).message).toContain(
      `${STANDARD_PATH} does not match standard 2.0`
    )
    // a pinned profile whose file is missing
    const missing = splitRepo('typescript')
    rmSync(join(missing, 'docs/standard/typescript.md'))
    expect(lintStandard(missing, SPLIT_HASHES)).toEqual({
      ok: false,
      message:
        'docs/standard/typescript.md is missing; AGENTS.md pins standard 2.0 with profile typescript.',
    })
  })

  it('a repository that pins 2.0 is still checked against 2.0', () => {
    // the published hashes now hold 2.1 as well, with a rust profile that 2.0 does not have
    const hashes = {
      ...SPLIT_HASHES,
      '2.1': {
        core: hashOf('# Micelio engineering standard\n\nVersion 2.1 (2026-12-02). Core.\n'),
        profiles: { ...SPLIT_HASHES['2.0'].profiles, rust: hashOf('# Rust profile\n') },
      },
    }
    expect(lintStandard(splitRepo('typescript, site-engine'), hashes)).toEqual({
      ok: true,
      message:
        'Standard 2.0 (typescript, site-engine): docs/engineering-standard.md, docs/standard/typescript.md, docs/standard/site-engine.md match the published copy.',
    })
    // 2.0 has no rust profile, whatever 2.1 adds
    expect(lintStandard(splitRepo('rust'), hashes).message).toBe(
      'AGENTS.md pins profile rust, which standard 2.0 does not have (it has typescript, site-engine): fix the profile pin.'
    )
    // and the core of 2.1 is not accepted for a pin of 2.0
    const dir = splitRepo('typescript')
    writeFileSync(
      join(dir, STANDARD_PATH),
      '# Micelio engineering standard\n\nVersion 2.1 (2026-12-02). Core.\n'
    )
    expect(lintStandard(dir, hashes).message).toContain(
      `${STANDARD_PATH} does not match standard 2.0`
    )
  })

  it('fails and names the profile file when it was edited', () => {
    const dir = splitRepo('typescript, site-engine')
    writeFileSync(join(dir, 'docs/standard/site-engine.md'), '# Site engine profile, edited\n')
    const result = lintStandard(dir, SPLIT_HASHES)
    expect(result.ok).toBe(false)
    expect(result.message).toContain(
      'docs/standard/site-engine.md does not match profile site-engine of standard 2.0'
    )
    expect(result.message).not.toContain('typescript.md')
  })

  it('fails on a profile the pinned version does not have, naming the ones it has', () => {
    const result = lintStandard(splitRepo('rust'), SPLIT_HASHES)
    expect(result).toEqual({
      ok: false,
      message:
        'AGENTS.md pins profile rust, which standard 2.0 does not have (it has typescript, site-engine): fix the profile pin.',
    })
    const old = repo('1.4', STANDARD)
    writeFileSync(join(old, 'AGENTS.md'), AGENTS_WITH_PROFILE('1.4', 'typescript, rust'))
    expect(lintStandard(old, SPLIT_HASHES).message).toBe(
      'AGENTS.md pins profile rust, which standard 1.4 does not have (it has typescript, site-engine): fix the profile pin.'
    )
    // a malformed name is not read as no pin
    writeFileSync(join(old, 'AGENTS.md'), AGENTS_WITH_PROFILE('1.4', 'Rust, rust_x'))
    expect(lintStandard(old, SPLIT_HASHES).message).toBe(
      'AGENTS.md pins profile Rust, rust_x, which standard 1.4 does not have (it has typescript, site-engine): fix the profile pin.'
    )
    writeFileSync(join(old, 'AGENTS.md'), AGENTS_WITH_PROFILE('1.4', 'typescript, site-engine'))
    expect(lintStandard(old, SPLIT_HASHES)).toEqual({
      ok: true,
      message: `Standard 1.4: ${STANDARD_PATH} matches the published copy.`,
    })
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
    const published = loadHashes()[version ?? '']
    const message = `is not the published copy of standard ${version}: restore it, or raise the version and add its hash`
    if (typeof published !== 'object') {
      expect(published, `${STANDARD_PATH} ${message}`).toBe(hashOf(copy))
      return
    }
    // a version in the new form: the core, and every profile file of docs/standard/, each with its hash
    expect(published.core, `${STANDARD_PATH} ${message}`).toBe(hashOf(copy))
    const files = readdirSync(join(ROOT, PROFILE_DIR)).filter((name) => name.endsWith('.md'))
    expect(Object.keys(published.profiles).sort()).toEqual(
      files.map((name) => name.slice(0, -'.md'.length)).sort()
    )
    for (const [profile, hash] of Object.entries(published.profiles)) {
      const path = `${PROFILE_DIR}/${profile}.md`
      expect(hash, `${path} ${message}`).toBe(hashOf(readFileSync(join(ROOT, path))))
    }
  })

  it('every profile of a language has the same headings', () => {
    /** The `## ` headings of a profile: the sections of the core it follows. */
    const sections = (profile: string): string[] =>
      readFileSync(join(ROOT, PROFILE_DIR, `${profile}.md`), 'utf8')
        .split('\n')
        .filter((line) => line.startsWith('## '))
    const reference = sections('typescript')
    expect(reference.length).toBeGreaterThan(0)
    for (const language of ['rust']) {
      expect(sections(language), language).toEqual(reference)
    }
  })

  it('every must and should of 1.8 is in the core or in exactly one profile of 2.0', () => {
    const old = readFileSync(STANDARD_1_8)
    // the fixture is the published 1.8, byte for byte
    expect(hashOf(old)).toBe(loadHashes()['1.8'])
    const files = [STANDARD_PATH, `${PROFILE_DIR}/typescript.md`, `${PROFILE_DIR}/site-engine.md`]
    const texts = files.map((path) => readFileSync(join(ROOT, path), 'utf8'))
    const lines = old.toString('utf8').split('\n')
    const rules = lines.filter((line) => /\*\*(must|should)\b/i.test(line))
    expect(rules.length).toBeGreaterThan(0)
    for (const rule of rules) {
      const found = texts.reduce(
        (count, text) => count + text.split('\n').filter((line) => line === rule).length,
        0
      )
      expect(found, rule).toBe(1)
    }
    // every other line of 1.8 (headings, table separators and short code lines aside) is kept word
    // for word in one file, except the three lines 2.0 rewrites and the rule of section 13 that 2.2
    // rewords (the verifier re-creates the repository's stack, on any engine)
    const rewritten = [
      /^Version 1\.8 /,
      /^These are the rules shared/,
      /^\| `AGENTS\.md` \|/,
      /^- \*\*Review and verify by others\.\*\*/,
    ]
    const kept = lines.filter(
      (line) =>
        line.trim().length >= 12 &&
        !line.startsWith('#') &&
        !/^\|(?:\s*-+\s*\|)+$/.test(line) &&
        !rewritten.some((pattern) => pattern.test(line))
    )
    for (const line of kept) {
      const holders = files.filter((_, index) => texts[index]?.split('\n').includes(line))
      expect(holders, line).toHaveLength(1)
    }
  })

  it('the core names no npm script, TSDoc or .nvmrc outside the Micelio only section', () => {
    const [core = '', micelioOnly] = copy.toString('utf8').split('\n## Micelio only\n')
    expect(micelioOnly, 'the core has a "## Micelio only" section').toBeDefined()
    expect(micelioOnly).not.toMatch(/^## /m)
    const tools = /\bnpm (?:run|ci|test|install|audit|exec)\b|TSDoc|\.nvmrc/g
    expect(core.match(tools) ?? []).toEqual([])
  })

  it('the core names no container engine outside the Micelio only section', () => {
    const [core = ''] = copy.toString('utf8').split('\n## Micelio only\n')
    expect(core.match(/\b(?:Docker|Podman)\b/gi) ?? []).toEqual([])
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

  it('reads a version in the new form, and leaves out an entry in neither form', () => {
    const file = {
      ...SPLIT_HASHES,
      '2.1': { core: 'x' },
      '2.2': { core: 'x', profiles: { typescript: 1 } },
      files: { 'a/b.md': 'x' },
    }
    expect(loadHashes(file)).toEqual(SPLIT_HASHES)
  })

  it('keeps the 1.x entries as one hash each', () => {
    const hashes = loadHashes()
    for (const version of ['1.4', '1.5', '1.6', '1.7', '1.8']) {
      expect(typeof hashes[version], version).toBe('string')
    }
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
    // a version in the new form: the profile it reads with no pin, typescript, is part of the copy
    mkdirSync(join(dir, PROFILE_DIR))
    cpSync(join(ROOT, PROFILE_DIR, 'typescript.md'), join(dir, PROFILE_DIR, 'typescript.md'))
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
    // a version in the new form: the profile it reads with no pin, typescript, is part of the copy
    mkdirSync(join(dir, PROFILE_DIR))
    cpSync(join(ROOT, PROFILE_DIR, 'typescript.md'), join(dir, PROFILE_DIR, 'typescript.md'))
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
