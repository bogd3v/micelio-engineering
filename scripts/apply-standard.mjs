// Copies the canonical standard into a repository, moves the pin in its AGENTS.md to the standard's
// version (a `profile:` pin is left as it is), and copies the files of `.github/standard-sync.json`
// ("files": the agent prompts, the skills, the pull request template) from `template/` to the same
// path. A listed path that does not exist yet (a skill that has not landed) is skipped. Used by
// standard-sync.yml; prints `changed` or `unchanged`, and one `synced <path>` or `removed <path>`
// line per file written or deleted, on stderr.
//
// A version in the new form (ADR-0001, point 1) has a `standard/` folder next to the standard file
// (`docs/standard/<profile>.md` in this repository). For such a version it also copies the file of
// each profile the repository's AGENTS.md pins (`typescript` when it pins none) to
// `docs/standard/<profile>.md`, and removes the file of a profile of that version the repository no
// longer pins. It fails with 4 when a pinned profile has no file in that folder; 3 when AGENTS.md
// has no pin.
//
//   node scripts/apply-standard.mjs <repository directory> [standard file]
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  hashOf,
  readProfiles,
  setPin,
  standardVersion,
  STANDARD_PATH,
} from '../packages/eslint-config/dist/standard.js'
import { ROOT, syncedFiles } from './synced-files.mjs'

/** Where a repository keeps the file of each profile it pins. */
const PROFILE_DIR = 'docs/standard'

const [target, source = fileURLToPath(new URL(`../${STANDARD_PATH}`, import.meta.url))] =
  process.argv.slice(2)
if (!target) {
  console.error('usage: apply-standard.mjs <repository directory> [standard file]')
  process.exit(2)
}

const standard = readFileSync(source)
const version = standardVersion(standard.toString('utf8'))
if (!version) {
  console.error(`${source} has no "Version X.Y" header`)
  process.exit(2)
}

const agentsPath = join(target, 'AGENTS.md')
const agents = existsSync(agentsPath) ? readFileSync(agentsPath, 'utf8') : ''
const nextAgents = setPin(agents, version)
if (nextAgents === null) {
  console.error(`${agentsPath} has no \`standard: X.Y\` pin to move to ${version}`)
  process.exit(3)
}

/** The profile files of the version being carried, by profile name; empty for a single-file version. */
const profileSource = join(dirname(source), 'standard')
const versionProfiles = new Map(
  existsSync(profileSource) && statSync(profileSource).isDirectory()
    ? readdirSync(profileSource)
        .filter((name) => name.endsWith('.md'))
        .map((name) => [name.slice(0, -'.md'.length), join(profileSource, name)])
    : []
)
const pinned = versionProfiles.size > 0 ? readProfiles(agents) : []
const missing = pinned.filter((profile) => !versionProfiles.has(profile))
if (missing.length > 0) {
  console.error(
    `${agentsPath} pins profile ${missing.join(', ')}, which standard ${version} does not have (it has ${[...versionProfiles.keys()].join(', ')})`
  )
  process.exit(4)
}

/** Writes `from` to `path` in the repository unless it already holds the same bytes. */
function copyTo(path, from) {
  const to = join(target, path)
  if (existsSync(to) && hashOf(readFileSync(to)) === hashOf(readFileSync(from))) return false
  mkdirSync(dirname(to), { recursive: true })
  copyFileSync(from, to)
  return true
}

const copyChanged = copyTo(STANDARD_PATH, source)
const pinChanged = nextAgents !== agents
if (pinChanged) writeFileSync(agentsPath, nextAgents)

let profilesChanged = false
for (const [profile, from] of versionProfiles) {
  const path = `${PROFILE_DIR}/${profile}.md`
  if (pinned.includes(profile)) {
    if (!copyTo(path, from)) continue
    console.error(`synced ${path}`)
  } else {
    if (!existsSync(join(target, path))) continue
    rmSync(join(target, path))
    console.error(`removed ${path}`)
  }
  profilesChanged = true
}

let filesChanged = false
for (const path of syncedFiles()) {
  if (!copyTo(path, join(ROOT, 'template', path))) continue
  filesChanged = true
  console.error(`synced ${path}`)
}

console.log(copyChanged || pinChanged || profilesChanged || filesChanged ? 'changed' : 'unchanged')
