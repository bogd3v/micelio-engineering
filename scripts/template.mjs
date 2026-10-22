// Creates a repository directory from `template/`, the part of section 14 of the engineering standard
// that a file can tick (docs/template.md).
//
//   npm run template -- <target-dir> [--name <repo>] [--title <text>] [--package <npm name>]
//                       [--description <text>] [--ref <commit SHA>] [--no-install]
//
// Copies `template/`, replaces its `{{placeholders}}`, adds the canonical copy of the standard and the
// licence check from this repository, and (unless --no-install) writes the lockfile that `npm ci` and the
// reusable workflows need. It never touches git: initialising and pushing is the human's step.
import { execFileSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const PLACEHOLDER = /\{\{([a-z-]+)\}\}/g
const REPO_NAME = /^[a-z0-9][a-z0-9-]*$/

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
 * @returns {string[]} The files created, relative to the target.
 */
export function createRepository(options) {
  const target = resolve(options.target)
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
  const eslintConfig = JSON.parse(
    readFileSync(join(ROOT, 'packages/eslint-config/package.json'), 'utf8')
  )
  const values = {
    repo: name,
    title: options.title ?? titleOf(name),
    package: options.packageName ?? name,
    description,
    standard: standardVersion,
    'engineering-ref': options.ref ?? currentRef(),
    'micelio-version': eslintConfig.version,
    'types-node': root.devDependencies['@types/node'],
    eslint: root.devDependencies.eslint,
    prettier: root.devDependencies.prettier,
    typescript: root.devDependencies.typescript,
    vitest: root.devDependencies.vitest,
  }

  const source = join(ROOT, 'template')
  const created = []
  for (const file of listFiles(source)) {
    const text = readFileSync(join(source, file), 'utf8').replace(PLACEHOLDER, (_, key) => {
      if (!(key in values))
        throw new Error(`template/${file} uses the unknown placeholder {{${key}}}`)
      return values[key]
    })
    const destination = join(target, file)
    mkdirSync(dirname(destination), { recursive: true })
    writeFileSync(destination, text)
    created.push(file)
  }

  // Single sources: copied from this repository so the template never holds a second copy.
  for (const file of ['docs/engineering-standard.md', 'scripts/check-licenses.mjs']) {
    const destination = join(target, file)
    mkdirSync(dirname(destination), { recursive: true })
    copyFileSync(join(ROOT, file), destination)
    created.push(file)
  }

  if (options.install !== false) {
    execFileSync('npm', ['install', '--package-lock-only', '--ignore-scripts'], {
      cwd: target,
      stdio: 'inherit',
    })
    created.push('package-lock.json')
  }
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
      'Usage: npm run template -- <target-dir> [--name <repo>] [--description <text>]'
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
