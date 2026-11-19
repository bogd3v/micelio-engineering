import { execFile, spawn } from 'node:child_process'
import {
  chmod,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readdir,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import { errorLine } from './errors.js'

const execFileAsync = promisify(execFile)

/** The outcome of `runRevertProof`: 0 when proven, 1 when not proven, 2 on a usage error or a command that did not run to an exit. */
export interface RevertProofResult {
  code: 0 | 1 | 2
  stdout: string
  stderr: string
}

/** The globs that make a path a test, besides the ones `--test` adds. */
export const TEST_GLOBS = [
  'test/**',
  'tests/**',
  '**/__tests__/**',
  'e2e/**',
  '**/fixtures/**',
  '**/*.test.*',
  '**/*.spec.*',
]

/** The folder `--link` links when none is given. */
export const DEFAULT_LINK = 'node_modules'

const USAGE =
  'usage: revert-proof --base <rev> --cwd <worktree> --log <file> [--test <glob>]… [--link <path>]… -- <command…>\n'

/** A glob as a regular expression: a double star crosses folders (and a double star plus a slash may match none), a single star and `?` stay in one name. */
export function globToRegExp(glob: string): RegExp {
  let source = ''
  for (let i = 0; i < glob.length; i++) {
    const char = glob.charAt(i)
    if (char === '*') {
      if (glob.charAt(i + 1) === '*') {
        if (glob.charAt(i + 2) === '/') {
          source += '(?:.*/)?'
          i += 2
        } else {
          source += '.*'
          i += 1
        }
      } else {
        source += '[^/]*'
      }
    } else if (char === '?') {
      source += '[^/]'
    } else {
      source += char.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    }
  }
  return new RegExp(`^${source}$`)
}

/** Whether `path` (relative to the repository, with `/`) is a test: it matches one of `TEST_GLOBS` or of `extra`. */
export function isTestPath(path: string, extra: string[] = []): boolean {
  return [...TEST_GLOBS, ...extra].some((glob) => globToRegExp(glob).test(path))
}

async function git(cwd: string, args: string[]): Promise<Buffer> {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    encoding: 'buffer',
    maxBuffer: 256 * 1024 * 1024,
  })
  return stdout
}

/** Whether `path` exists (a dangling symlink counts), without following it. */
async function exists(path: string, follow: boolean): Promise<boolean> {
  try {
    await (follow ? stat(path) : lstat(path))
    return true
  } catch {
    return false
  }
}

const names = (buffer: Buffer): string[] => buffer.toString('utf8').split('\0').filter(Boolean)

interface Options {
  base: string
  cwd: string
  log: string
  tests: string[]
  links: string[]
  command: string[]
}

function parse(argv: string[]): Options | string {
  const options: Options = { base: '', cwd: '', log: '', tests: [], links: [], command: [] }
  const args = argv.slice(1)
  for (let i = 0; i < args.length; i++) {
    const name = args[i] ?? ''
    if (name === '--') {
      options.command = args.slice(i + 1)
      break
    }
    const value = args[i + 1]
    if (value === undefined || !['--base', '--cwd', '--log', '--test', '--link'].includes(name)) {
      return `bad argument "${name}"`
    }
    if (name === '--base') options.base = value
    else if (name === '--cwd') options.cwd = value
    else if (name === '--log') options.log = value
    else if (name === '--test') options.tests.push(value)
    else options.links.push(value)
    i++
  }
  if (options.base === '') return 'revert-proof needs --base'
  if (options.log === '') return 'revert-proof needs --log'
  if (options.command.length === 0) return 'revert-proof needs a command after --'
  return options
}

/**
 * Links `from`, a folder of the worktree, at `target` in the scratch copy. A folder with symlinks that
 * resolve inside the repository (the workspace packages of `node_modules`, one level deep and under an
 * `@scope`) is built as a real folder whose such entries point into the scratch copy, so that a workspace
 * package loads the base's code and not the worktree's.
 */
async function linkFolder(
  from: string,
  target: string,
  root: string,
  scratch: string,
  scoped = true
): Promise<void> {
  const entries = await readdir(from)
  const inside: string[] = []
  for (const name of entries) {
    const info = await lstat(join(from, name))
    if (info.isSymbolicLink()) {
      try {
        if ((await realpath(join(from, name))).startsWith(`${root}${sep}`)) inside.push(name)
      } catch {
        // a dangling link points nowhere in the repository
      }
    } else if (scoped && info.isDirectory() && name.startsWith('@')) {
      inside.push(name)
    }
  }
  if (inside.length === 0) {
    await mkdir(dirname(target), { recursive: true })
    await symlink(from, target)
    return
  }
  await mkdir(target, { recursive: true })
  for (const name of entries) {
    const entry = join(from, name)
    if (!inside.includes(name)) {
      await symlink(entry, join(target, name))
    } else if ((await lstat(entry)).isSymbolicLink()) {
      await symlink(join(scratch, relative(root, await realpath(entry))), join(target, name))
    } else {
      await linkFolder(entry, join(target, name), root, scratch, false)
    }
  }
}

type Ended = { code: number } | { signal: string } | { error: string }

/** Runs `command` in `cwd` with its output in `log`; resolves to its exit code, or the signal that ended it. */
async function runLogged(command: string[], cwd: string, log: string): Promise<Ended> {
  const handle = await open(log, 'w')
  try {
    const [file = '', ...rest] = command
    const child = spawn(file, rest, { cwd, stdio: ['ignore', handle.fd, handle.fd] })
    let spawned = false
    return await new Promise<Ended>((done) => {
      child.on('error', (error) => {
        done({ error: errorLine(error) })
      })
      child.on('spawn', () => {
        spawned = true
      })
      child.on('close', (code, signal) => {
        if (spawned) done(code === null ? { signal: signal ?? 'unknown' } : { code })
      })
    })
  } finally {
    await handle.close()
  }
}

/**
 * `revert-proof --base <rev> --cwd <worktree> --log <file> [--test <glob>]… [--link <path>]… -- <command…>`:
 * runs `command` in a scratch copy of the worktree (under `$FACTORY_TMP`) whose production files are as
 * they are at `<rev>` and whose test files are as the worktree has them; the worktree is never written to.
 * Proven (0) when the command fails there, not proven (1) when it passes or when nothing but tests changed.
 */
export async function runRevertProof(
  argv: string[],
  env: Record<string, string | undefined> = process.env,
  defaultCwd: string = process.cwd()
): Promise<RevertProofResult> {
  const options = parse(argv)
  if (typeof options === 'string') {
    return { code: 2, stdout: '', stderr: `error: ${options}\n${USAGE}` }
  }
  const fail = (message: string): RevertProofResult => ({
    code: 2,
    stdout: '',
    stderr: `error: ${message}\n`,
  })
  let root: string
  try {
    const top = await git(resolve(defaultCwd, options.cwd === '' ? '.' : options.cwd), [
      'rev-parse',
      '--show-toplevel',
    ])
    root = top.toString('utf8').trim()
    await git(root, ['rev-parse', '--verify', `${options.base}^{commit}`])
  } catch (error) {
    return fail(`${options.cwd === '' ? defaultCwd : options.cwd}: ${errorLine(error)}`)
  }

  const inBase = new Map<string, { mode: string; sha: string }>()
  const tree = await git(root, ['ls-tree', '-r', '-z', '--full-tree', options.base])
  for (const entry of names(tree)) {
    const match = /^(\d+) \w+ ([0-9a-f]+)\t(.*)$/s.exec(entry)
    if (match?.[1] !== undefined && match[2] !== undefined && match[3] !== undefined) {
      inBase.set(match[3], { mode: match[1], sha: match[2] })
    }
  }
  const changed = new Set([
    ...names(await git(root, ['diff', '--name-only', '-z', '--no-renames', options.base])),
    ...names(await git(root, ['ls-files', '-o', '--exclude-standard', '-z'])),
  ])
  const production = [...changed].filter((path) => !isTestPath(path, options.tests)).sort()
  if (production.length === 0) {
    return {
      code: 1,
      stdout: 'restored: none\ndeleted: none\nnot proven: no production file changed\n',
      stderr: '',
    }
  }

  const links = options.links.length === 0 ? [DEFAULT_LINK] : options.links
  for (const path of links) {
    if (relative(root, resolve(root, path)).startsWith('..')) {
      return fail(`--link ${path} is outside the repository`)
    }
  }
  const log = resolve(defaultCwd, options.log)
  const tmpRoot = env.FACTORY_TMP ?? join(env.HOME ?? homedir(), 'Git', 'factory', 'tmp')
  await mkdir(tmpRoot, { recursive: true })
  const scratch = await mkdtemp(join(tmpRoot, 'revert-proof-'))
  try {
    for (const path of names(await git(root, ['ls-files', '-co', '--exclude-standard', '-z']))) {
      const from = join(root, path)
      if (!(await exists(from, false)) || (await lstat(from)).isDirectory()) continue
      await mkdir(dirname(join(scratch, path)), { recursive: true })
      await cp(from, join(scratch, path), { verbatimSymlinks: true })
    }
    const restored: string[] = []
    const deleted: string[] = []
    for (const path of production) {
      const target = join(scratch, path)
      const was = inBase.get(path)
      await rm(target, { force: true })
      if (was === undefined) {
        deleted.push(path)
      } else if (was.mode === '160000') {
        continue
      } else {
        await mkdir(dirname(target), { recursive: true })
        const content = await git(root, ['cat-file', 'blob', was.sha])
        if (was.mode === '120000') await symlink(content.toString('utf8'), target)
        else await writeFile(target, content)
        if (was.mode === '100755') await chmod(target, 0o755)
        restored.push(path)
      }
    }
    for (const path of links) {
      const from = isAbsolute(path) ? path : join(root, path)
      if (!(await exists(from, true))) continue
      await rm(join(scratch, relative(root, from)), { force: true, recursive: true })
      await linkFolder(from, join(scratch, relative(root, from)), root, scratch)
    }
    const listing = `restored: ${restored.join(', ') || 'none'}\ndeleted: ${deleted.join(', ') || 'none'}\n`
    const result = await runLogged(options.command, scratch, log)
    if ('error' in result) return fail(`cannot run "${options.command.join(' ')}": ${result.error}`)
    if ('signal' in result) {
      return {
        code: 2,
        stdout: listing,
        stderr: `error: the command was ended by ${result.signal}; that proves nothing\n`,
      }
    }
    const exit = `exit code: ${String(result.code)}\n`
    return result.code === 0
      ? {
          code: 1,
          stdout: `${listing}${exit}not proven: the command passes on the merge base's code\n`,
          stderr: '',
        }
      : { code: 0, stdout: `${listing}${exit}proven\n`, stderr: '' }
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
}
