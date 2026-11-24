import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const INSTALL = join(ROOT, 'herdr/mod/install.sh')

let app: string

beforeEach(() => {
  app = mkdtempSync(join(tmpdir(), 'herdr-app-'))
})

afterEach(() => {
  rmSync(app, { recursive: true, force: true })
})

const install = (...args: string[]) =>
  spawnSync('bash', [INSTALL, ...args], {
    encoding: 'utf8',
    env: { ...process.env, HERDR_APP_DIR: app },
  })

/** The files under `dir`, relative, sorted. */
const walk = (dir: string, base = ''): string[] =>
  readdirSync(join(dir, base), { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? walk(dir, join(base, e.name)) : [join(base, e.name)]))
    .toSorted()

describe('install.sh', () => {
  it('install.sh copies the mod and the layout into HERDR_APP_DIR and builds the 120 cats', () => {
    const run = install('--maintainer', 'someone')
    expect(run.status).toBe(0)
    const mod = join(app, 'mods/factory')
    expect(walk(join(mod, 'cats'))).toHaveLength(120)
    for (const file of [
      'main.js',
      'adapters.js',
      'mod.json',
      'lib/panel.js',
      'views/milestones.js',
    ]) {
      expect(readFileSync(join(mod, file), 'utf8')).toBe(
        readFileSync(join(ROOT, 'herdr/mod/factory', file), 'utf8')
      )
    }
    expect(walk(join(mod, 'fonts'))).toHaveLength(8)
    expect(walk(mod).filter((f) => f.endsWith('.d.ts') || f.endsWith('jsconfig.json'))).toEqual([])
    const layout = JSON.parse(readFileSync(join(app, 'layouts/factory.json'), 'utf8')) as {
      children: unknown[]
    }
    const text = JSON.stringify(layout)
    expect(text).toContain(`"checkout":"${ROOT.replace(/\/$/, '')}"`)
    expect(text).toContain('"maintainer":"someone"')
    expect(text).not.toContain('"theme"')
    expect(text).toContain('"mod":"factory"')
    expect(text).toContain('"size":{"px":380}')
    // It records what it wrote, and a second run replaces it.
    const manifest = JSON.parse(readFileSync(join(app, 'factory-mod-install.json'), 'utf8')) as {
      files: Record<string, string>
    }
    expect(Object.keys(manifest.files)).toContain('layouts/factory.json')
    expect(Object.keys(manifest.files)).toHaveLength(walk(app).length - 1)
    expect(install().status).toBe(0)
  })

  it('install.sh leaves a layout or a mod it did not write untouched and exits 1', () => {
    mkdirSync(join(app, 'layouts'), { recursive: true })
    writeFileSync(join(app, 'layouts/factory.json'), '{"mine":true}\n')
    const first = install()
    expect(first.status).toBe(1)
    expect(first.stderr).toContain(join(app, 'layouts/factory.json'))
    expect(readFileSync(join(app, 'layouts/factory.json'), 'utf8')).toBe('{"mine":true}\n')
    // Nothing else was written, not even the mod that was free.
    expect(existsSync(join(app, 'mods'))).toBe(false)
    expect(existsSync(join(app, 'factory-mod-install.json'))).toBe(false)

    rmSync(join(app, 'layouts'), { recursive: true })
    mkdirSync(join(app, 'mods/factory'), { recursive: true })
    writeFileSync(join(app, 'mods/factory/main.js'), '// my own panel\n')
    const second = install()
    expect(second.status).toBe(1)
    expect(second.stderr).toContain(join(app, 'mods/factory/main.js'))
    expect(readFileSync(join(app, 'mods/factory/main.js'), 'utf8')).toBe('// my own panel\n')
    expect(walk(app)).toEqual(['mods/factory/main.js'])

    // A file it wrote and the maintainer then edited is also left alone.
    rmSync(join(app, 'mods'), { recursive: true })
    expect(install().status).toBe(0)
    writeFileSync(join(app, 'layouts/factory.json'), '{"edited":true}\n')
    const third = install()
    expect(third.status).toBe(1)
    expect(readFileSync(join(app, 'layouts/factory.json'), 'utf8')).toBe('{"edited":true}\n')
  })

  it("install.sh writes the Podman socket of XDG_RUNTIME_DIR as the layout's dockerHost", () => {
    const dockerHost = (env: NodeJS.ProcessEnv) => {
      const dir = mkdtempSync(join(tmpdir(), 'herdr-app-'))
      try {
        const run = spawnSync('bash', [INSTALL], {
          encoding: 'utf8',
          env: { ...env, HERDR_APP_DIR: dir },
        })
        expect(run.status).toBe(0)
        const text = readFileSync(join(dir, 'layouts/factory.json'), 'utf8')
        return /"dockerHost": "([^"]*)"/.exec(text)?.[1]
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    }
    const withRuntime = { ...process.env, XDG_RUNTIME_DIR: '/run/user/4242' }
    expect(dockerHost(withRuntime)).toBe('unix:///run/user/4242/podman/podman.sock')
    const without = { ...process.env }
    delete without['XDG_RUNTIME_DIR']
    const uid = spawnSync('id', ['-u'], { encoding: 'utf8' }).stdout.trim()
    expect(dockerHost(without)).toBe(`unix:///run/user/${uid}/podman/podman.sock`)
  })

  it('install.sh refuses an option it does not know', () => {
    const run = install('--theme', 'sepia')
    expect(run.status).toBe(2)
    expect(walk(app)).toEqual([])
  })
})
