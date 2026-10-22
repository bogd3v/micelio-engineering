// Proves acceptance criterion 1 of the template as far as a machine can: creates a repository from
// `template/`, installs the three packages from tarballs packed here (the registry serves their other
// dependencies, as it will for a real repository), and runs the checks of that repository with no edit.
//
//   node scripts/verify-template.mjs
//
// The reusable workflows can only be run by GitHub; docs/template.md says how to prove them.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRepository } from './template.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const work = mkdtempSync(join(tmpdir(), 'micelio-template-'))
const tarballs = join(work, 'tarballs')
const project = join(work, 'micelio-example')
mkdirSync(tarballs)

/** Runs a command and streams its output; throws on a non-zero exit. */
function run(command, args, cwd) {
  console.log(`$ ${command} ${args.join(' ')}`)
  execFileSync(command, args, { cwd, stdio: 'inherit' })
}

run('npm', ['run', 'build'], root)
for (const name of ['eslint-config', 'prettier-config', 'tsconfig']) {
  run('npm', ['pack', '--pack-destination', tarballs, '-w', `@micelio/${name}`], root)
}

// The commit only has to look like one: nothing here calls the workflows.
const files = createRepository({
  target: project,
  description: 'A repository created from the template, to prove it passes its own checks.',
  ref: '0'.repeat(40),
  install: false,
})
console.log(`Created ${files.length} files in ${project}`)

const packed = readdirSync(tarballs).map((file) => join(tarballs, file))
run('npm', ['install', '--save-dev', ...packed], project)
run('npm', ['run', 'check'], project)
run('npm', ['run', 'build'], project)
// reuse reads .gitignore only inside a git repository, as in CI; without it node_modules is scanned.
run('git', ['init', '--quiet'], project)
run('reuse', ['lint'], project)
console.log('A repository created from the template passes npm run check, build and reuse lint.')
