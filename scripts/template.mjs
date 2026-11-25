// Creates a repository directory from `template/`, the part of section 14 of the engineering standard
// that a file can tick (docs/template.md).
//
//   npm run template -- <target-dir> [--profile <typescript|rust>] [--name <repo>] [--title <text>]
//                       [--package <npm name>] [--description <text>] [--ref <commit SHA>]
//                       [--no-install] [--license <SPDX id>] [--copyright <holder>]
//
// With the `typescript` profile (the default) it copies `template/`, replaces its `{{placeholders}}`,
// adds the canonical copy of the standard (the core and the TypeScript profile) and the licence check
// from this repository, and (unless --no-install) writes the lockfile that `npm ci` and the reusable
// workflows need. With `rust` it copies `template-rust/`, takes the synced files and the files that
// are the same in every language from `template/`, adds the core and the Rust profile of the standard,
// and asks for the repository's own licence (--license and --copyright); there is no npm, so --package
// and --no-install are refused. It never touches git: initialising and pushing is the human's step.
import { execFileSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const PLACEHOLDER = /\{\{([a-z-]+)\}\}/g
const REPO_NAME = /^[a-z0-9][a-z0-9-]*$/
const PROFILES = ['typescript', 'rust']

/**
 * What `template-rust/` takes from `template/` instead of holding a second copy: the synced files of
 * `.github/standard-sync.json` and the files that say nothing about a language.
 */
const RUST_FROM_TEMPLATE = [
  '.claude',
  '.env.example',
  '.github/ISSUE_TEMPLATE',
  '.github/labels.json',
  '.github/pull_request_template.md',
  '.github/release.yml',
  '.github/workflows/issue-ready.yml',
  '.github/workflows/pr-labels.yml',
  'CLAUDE.md',
]

/** Every file below `directory`, as paths relative to it, dotfiles included. */
function listFiles(directory, prefix = '') {
  return readdirSync(join(directory, prefix), { withFileTypes: true }).flatMap((entry) => {
    const path = join(prefix, entry.name)
    return entry.isDirectory() ? listFiles(directory, path) : [path]
  })
}

/** `micelio-plugin-core` becomes `Micelio Plugin Core`. */
function titleOf(name) {
  return name
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

/**
 * Writes `files` of `source` into `target`, replacing the `{{placeholders}}` from `values`.
 *
 * @returns The paths written, relative to the target.
 */
function render(source, files, target, values, label) {
  const created = []
  for (const file of files) {
    const text = readFileSync(join(source, file), 'utf8').replace(PLACEHOLDER, (_, key) => {
      if (!(key in values))
        throw new Error(`${label}/${file} uses the unknown placeholder {{${key}}}`)
      return values[key]
    })
    const destination = join(target, file)
    mkdirSync(dirname(destination), { recursive: true })
    writeFileSync(destination, text)
    created.push(file)
  }
  return created
}

/** Copies files that live once in this repository, unchanged. */
function copyOnce(files, target) {
  for (const file of files) {
    const destination = join(target, file)
    mkdirSync(dirname(destination), { recursive: true })
    copyFileSync(join(ROOT, file), destination)
  }
  return files
}

/** The licence texts this repository holds, by SPDX id: `LICENSES/<id>.txt` here and in `template/`. */
function licenseTexts() {
  const texts = {}
  for (const directory of ['LICENSES', 'template/LICENSES']) {
    for (const file of readdirSync(join(ROOT, directory))) {
      if (file.endsWith('.txt')) texts[file.replace(/\.txt$/, '')] ??= join(ROOT, directory, file)
    }
  }
  return texts
}

/** The version a copy of the standard declares in its header (`Version 1.4 (2026-10-20)`). */
function standardVersionOf(markdown) {
  const match = /^Version (\d+\.\d+) /m.exec(markdown)
  if (!match) throw new Error('docs/engineering-standard.md has no "Version X.Y" header')
  return match[1]
}

/** The commit of this repository the workflows are pinned to: it must be on GitHub to be callable. */
function currentRef() {
  const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim()
  const sha = git('rev-parse', 'HEAD')
  let published = false
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', sha, 'origin/main'], { cwd: ROOT })
    published = true
  } catch {
    published = false
  }
  if (!published) {
    throw new Error(
      `HEAD (${sha.slice(0, 7)}) is not on origin/main, so the workflows cannot be called at that commit. ` +
        'Run it from an up-to-date main checkout or pass --ref <commit SHA> of a commit that is on GitHub.'
    )
  }
  return sha
}

/**
 * Creates the repository directory.
 *
 * @param {object} options
 * @param {string} options.target Directory to create; it must not exist or must be empty.
 * @param {string} [options.name] Repository name, kebab-case; defaults to the directory name.
 * @param {string} [options.title] Display name; defaults to the capitalised name.
 * @param {string} [options.packageName] npm name; defaults to the repository name.
 * @param {string} [options.description] One sentence for the README, `AGENTS.md` and `package.json`.
 * @param {string} [options.ref] Commit SHA of this repository that the workflows are pinned to.
 * @param {boolean} [options.install] Write `package-lock.json` with `npm install`; default true.
 * @param {string} [options.profile] `typescript` (default) or `rust`.
 * @param {string} [options.license] `rust` only, required: the SPDX id of the repository's licence.
 * @param {string} [options.copyright] `rust` only, required: the copyright holder of `REUSE.toml`.
 * @returns {string[]} The files created, relative to the target.
 */
export function createRepository(options) {
  const target = resolve(options.target)
  const profile = options.profile ?? 'typescript'
  if (!PROFILES.includes(profile)) {
    throw new Error(`"${profile}" is not a profile: ${PROFILES.join(' or ')}.`)
  }
  const rust = profile === 'rust'
  if (rust && options.packageName !== undefined) {
    throw new Error(
      '--package is for the typescript profile: a Rust repository has no npm package.'
    )
  }
  if (rust && options.install === false) {
    throw new Error(
      '--no-install is for the typescript profile: a Rust repository has no lockfile to skip.'
    )
  }
  if (!rust && (options.license !== undefined || options.copyright !== undefined)) {
    throw new Error(
      '--license and --copyright are for the rust profile: the typescript one is AGPL-3.0-only.'
    )
  }
  const name = options.name ?? basename(target)
  if (!REPO_NAME.test(name)) {
    throw new Error(`"${name}" is not a repository name: lowercase letters, digits and hyphens.`)
  }
  const description = options.description ?? 'A Micelio repository.'
  if (/["\\\n\r{}]/.test(description)) {
    throw new Error('The description may not contain quotes, backslashes, braces or line breaks.')
  }
  if (existsSync(target) && readdirSync(target).length > 0) {
    throw new Error(`${target} is not empty: the template only creates a new repository.`)
  }

  const standard = readFileSync(join(ROOT, 'docs/engineering-standard.md'), 'utf8')
  const standardVersion = standardVersionOf(standard)
  const hashes = JSON.parse(
    readFileSync(join(ROOT, 'packages/eslint-config/standard-hashes.json'), 'utf8')
  )
  if (!hashes[standardVersion]) {
    throw new Error(`The standard ${standardVersion} has no hash in standard-hashes.json.`)
  }
  const root = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  const versionOf = (pkg) =>
    JSON.parse(readFileSync(join(ROOT, `packages/${pkg}/package.json`), 'utf8')).version
  const values = {
    repo: name,
    title: options.title ?? titleOf(name),
    package: options.packageName ?? name,
    description,
    standard: standardVersion,
    'engineering-ref': options.ref ?? currentRef(),
    'eslint-config-version': versionOf('eslint-config'),
    'prettier-config-version': versionOf('prettier-config'),
    'tsconfig-version': versionOf('tsconfig'),
    'types-node': root.devDependencies['@types/node'],
    eslint: root.devDependencies.eslint,
    knip: root.devDependencies.knip,
    prettier: root.devDependencies.prettier,
    typescript: root.devDependencies.typescript,
    vitest: root.devDependencies.vitest,
  }

  if (rust) return createRust(target, values, options)

  const source = join(ROOT, 'template')
  const created = render(source, listFiles(source), target, values, 'template')

  // Single sources: copied from this repository so the template never holds a second copy.
  // The standard is the core and the TypeScript profile, the one `template/AGENTS.md` pins.
  created.push(
    ...copyOnce(
      ['docs/engineering-standard.md', 'docs/standard/typescript.md', 'scripts/check-licenses.mjs'],
      target
    )
  )

  if (options.install !== false) {
    execFileSync('npm', ['install', '--package-lock-only', '--ignore-scripts'], {
      cwd: target,
      stdio: 'inherit',
    })
    created.push('package-lock.json')
  }
  return created.sort()
}

/**
 * The `rust` profile: `template-rust/`, the files `template/` shares with it, the core and the Rust
 * profile of the standard, and the licence the repository chose.
 */
function createRust(target, values, options) {
  const texts = licenseTexts()
  const license = options.license
  if (license === undefined || options.copyright === undefined) {
    throw new Error(
      "The rust profile needs the repository's own licence: --license <SPDX id> (one of " +
        `${Object.keys(texts).sort().join(', ')}) and --copyright <holder>.`
    )
  }
  if (!(license in texts)) {
    throw new Error(
      `No text of the licence "${license}" here; the ones this repository holds are ` +
        `${Object.keys(texts).sort().join(', ')}.`
    )
  }
  if (/["\\\n\r{}]/.test(options.copyright)) {
    throw new Error(
      'The copyright holder may not contain quotes, backslashes, braces or line breaks.'
    )
  }
  const year = String(new Date().getFullYear())
  const toolchain = /^channel = "([^"]+)"$/m.exec(
    readFileSync(join(ROOT, 'fixtures/rust-basic/rust-toolchain.toml'), 'utf8')
  )?.[1]
  if (!toolchain) throw new Error('fixtures/rust-basic/rust-toolchain.toml has no channel.')
  const rustValues = {
    ...values,
    license,
    copyright: options.copyright,
    year,
    'rust-toolchain': toolchain,
    crate: values.repo.replaceAll('-', '_'),
  }

  const own = join(ROOT, 'template-rust')
  const shared = join(ROOT, 'template')
  const created = render(own, listFiles(own), target, rustValues, 'template-rust')
  const sharedFiles = RUST_FROM_TEMPLATE.flatMap((path) =>
    statSync(join(shared, path)).isDirectory() ? listFiles(shared, path) : [path]
  )
  created.push(...render(shared, sharedFiles, target, rustValues, 'template'))
  created.push(...copyOnce(['docs/engineering-standard.md', 'docs/standard/rust.md'], target))

  // The licence text: LICENSES/<id>.txt as REUSE wants it, and LICENSE with the year and the holder.
  const text = readFileSync(texts[license], 'utf8')
  mkdirSync(join(target, 'LICENSES'), { recursive: true })
  writeFileSync(join(target, 'LICENSES', `${license}.txt`), text)
  writeFileSync(
    join(target, 'LICENSE'),
    text.replace('<YEAR>', year).replace('<COPYRIGHT HOLDER>', options.copyright)
  )
  created.push(`LICENSES/${license}.txt`, 'LICENSE')
  return created.sort()
}

/** Parses the command line; the first argument that is not an option is the target. */
function parseArguments(argv) {
  const options = { install: true }
  const flags = {
    '--name': 'name',
    '--title': 'title',
    '--package': 'packageName',
    '--description': 'description',
    '--ref': 'ref',
    '--profile': 'profile',
    '--license': 'license',
    '--copyright': 'copyright',
  }
  for (let i = 0; i < argv.length; i++) {
    const argument = argv[i]
    if (argument === '--no-install') options.install = false
    else if (argument in flags) {
      const value = argv[++i]
      if (value === undefined) throw new Error(`${argument} needs a value`)
      options[flags[argument]] = value
    } else if (argument.startsWith('--')) throw new Error(`Unknown option ${argument}`)
    else if (options.target === undefined) options.target = argument
    else throw new Error(`Unexpected argument ${argument}`)
  }
  if (options.target === undefined) {
    throw new Error(
      'Usage: npm run template -- <target-dir> [--profile <typescript|rust>] [--name <repo>] [--description <text>]'
    )
  }
  return options
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const options = parseArguments(process.argv.slice(2))
    const created = createRepository(options)
    console.log(`Created ${created.length} files in ${resolve(options.target)}.`)
    console.log(
      'Next: git init, commit with -s, create the repository, then follow docs/template.md.'
    )
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  }
}
