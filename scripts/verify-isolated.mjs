// Proves the fixture needs "the three packages and nothing else": packs them, installs only
// the tarballs in an empty project (the registry serves their dependencies and peers, as it
// will for a consumer) and runs the fixture's lint, typecheck and format:check there.
import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const work = mkdtempSync(join(tmpdir(), 'micelio-isolated-'))
const tarballs = join(work, 'tarballs')
const project = join(work, 'project')
mkdirSync(tarballs)
mkdirSync(project)

/** Runs a command and streams its output; throws on a non-zero exit. */
function run(command, args, cwd) {
  console.log(`$ ${command} ${args.join(' ')}`)
  execFileSync(command, args, { cwd, stdio: 'inherit' })
}

run('npm', ['run', 'build'], root)
for (const name of ['eslint-config', 'prettier-config', 'tsconfig']) {
  run('npm', ['pack', '--pack-destination', tarballs, '-w', `@micelio/${name}`], root)
}

cpSync(join(root, 'fixtures/basic'), project, {
  recursive: true,
  filter: (source) => !source.includes('node_modules'),
})
const packed = readdirSync(tarballs).map((file) => join(tarballs, file))
writeFileSync(
  join(project, 'package.json'),
  JSON.stringify(
    {
      name: 'isolated-fixture',
      private: true,
      type: 'module',
      scripts: {
        lint: 'eslint .',
        typecheck: 'tsc --noEmit',
        'format:check': 'prettier --check .',
      },
      prettier: '@micelio/prettier-config',
    },
    null,
    2
  )
)
run('npm', ['install', '--save-dev', ...packed], project)
const dependencies = Object.keys(
  JSON.parse(
    execFileSync('npm', ['pkg', 'get', 'devDependencies'], { cwd: project, encoding: 'utf8' })
  )
)
console.log(`devDependencies of the isolated project: ${dependencies.join(', ')}`)
if (dependencies.length !== 3)
  throw new Error('the isolated project must depend on exactly the three packages')
for (const script of ['lint', 'typecheck', 'format:check']) run('npm', ['run', script], project)
console.log('Isolated fixture passes lint, typecheck and format:check.')
