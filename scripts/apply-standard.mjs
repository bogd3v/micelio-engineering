// Copies the canonical standard into a repository, moves the pin in its AGENTS.md to the standard's
// version, and copies the files of `.github/standard-sync.json` ("files": the agent prompts, the
// skills, the pull request template) from `template/` to the same path. A listed path that does not
// exist yet (a skill that has not landed) is skipped. Used by standard-sync.yml; prints `changed`
// or `unchanged`, and one `synced <path>` line per file written, on stderr.
//
//   node scripts/apply-standard.mjs <repository directory> [standard file]
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  hashOf,
  setPin,
  standardVersion,
  STANDARD_PATH,
} from '../packages/eslint-config/dist/standard.js'
import { ROOT, syncedFiles } from './synced-files.mjs'

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

const copyPath = join(target, STANDARD_PATH)
const copyChanged = !existsSync(copyPath) || hashOf(readFileSync(copyPath)) !== hashOf(standard)
if (copyChanged) {
  mkdirSync(dirname(copyPath), { recursive: true })
  copyFileSync(source, copyPath)
}
const pinChanged = nextAgents !== agents
if (pinChanged) writeFileSync(agentsPath, nextAgents)

let filesChanged = false
for (const path of syncedFiles()) {
  const from = join(ROOT, 'template', path)
  const to = join(target, path)
  if (existsSync(to) && hashOf(readFileSync(to)) === hashOf(readFileSync(from))) continue
  mkdirSync(dirname(to), { recursive: true })
  copyFileSync(from, to)
  filesChanged = true
  console.error(`synced ${path}`)
}

console.log(copyChanged || pinChanged || filesChanged ? 'changed' : 'unchanged')
