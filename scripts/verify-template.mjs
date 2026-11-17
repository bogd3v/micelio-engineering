// Proves acceptance criterion 1 of the template as far as a machine can: creates a repository from
// `template/`, installs the three packages from tarballs packed here (the registry serves their other
// dependencies, as it will for a real repository), and runs the checks of that repository with no edit.
//
//   node scripts/verify-template.mjs [--profile <typescript|rust>]
//
// With `--profile rust` it creates a Rust repository, runs the `check:` line of its `AGENTS.md` (which
// needs `cargo`, with `rustfmt` and `clippy`, and `cargo-deny`) and `reuse lint`, with no edit.
//
// The reusable workflows can only be run by GitHub; docs/template.md says how to prove them.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRepository } from './template.mjs'

const profileIndex = process.argv.indexOf('--profile')
const profile = profileIndex === -1 ? 'typescript' : process.argv[profileIndex + 1]
if (profile !== 'typescript' && profile !== 'rust') {
  console.error('--profile must be typescript or rust')
  process.exit(1)
}

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

/** The `check:` line of the first `## Commands` block of an `AGENTS.md`, without its comment. */
function checkLine(agents) {
  const block = /```bash\n([\s\S]*?)```/.exec(agents.split('## Commands')[1] ?? '')?.[1] ?? ''
  const line = block.split('\n').find((text) => text.startsWith('check:'))
  if (!line) throw new Error('AGENTS.md has no check: line in its first Commands block')
  return line.slice('check:'.length).trim()
}

/** A Rust repository passes its own check command and `reuse lint`; nothing is installed. */
function verifyRust() {
  const files = createRepository({
    target: project,
    profile: 'rust',
    license: 'MIT-0',
    copyright: 'The template verification',
    description: 'A repository created from the template, to prove it passes its own checks.',
    ref: '0'.repeat(40),
  })
  console.log(`Created ${files.length} files in ${project}`)
  run('git', ['init', '--quiet'], project)
  run('git', ['add', '--all'], project)
  run('bash', ['-ec', checkLine(readFileSync(join(project, 'AGENTS.md'), 'utf8'))], project)
  run('reuse', ['lint'], project)
  console.log(
    'A Rust repository created from the template passes its check command and reuse lint.'
  )
}

try {
  if (profile === 'rust') {
    verifyRust()
  } else {
    verifyTypescript()
  }
} finally {
  // The work directory (node_modules or target included) goes whether the run passes or fails.
  rmSync(work, { recursive: true, force: true })
}

function verifyTypescript() {
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
  // lint:ee scans the files git tracks, as in a real repository, and reuse reads .gitignore only inside
  // one; without it node_modules is scanned.
  run('git', ['init', '--quiet'], project)
  run('git', ['add', '--all'], project)
  run('npm', ['run', 'check'], project)
  run('npm', ['run', 'build'], project)
  run('reuse', ['lint'], project)
  console.log('A repository created from the template passes npm run check, build and reuse lint.')
}
