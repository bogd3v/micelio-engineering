import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
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
    env: { ...process.env, HERDR_APP_DIR: app, FACTORY_MAINTAINER: 'someone' },
  })

/** `install.sh` with `FACTORY_MAINTAINER` out of the environment, or set to `maintainer`. */
const installFrom = (maintainer: string | undefined, ...args: string[]) => {
  const env: NodeJS.ProcessEnv = { ...process.env, HERDR_APP_DIR: app }
  delete env['FACTORY_MAINTAINER']
  if (maintainer !== undefined) env['FACTORY_MAINTAINER'] = maintainer
  return spawnSync('bash', [INSTALL, ...args], { encoding: 'utf8', env })
}

const NO_MAINTAINER =
  'install.sh: no maintainer: give --maintainer <login> or set FACTORY_MAINTAINER\n'

const layoutText = () => readFileSync(join(app, 'layouts/factory.json'), 'utf8')

const installedMaintainer = () => /"maintainer": "([^"]*)"/.exec(layoutText())?.[1]

/** Writes a layout and records its hash, as an earlier install of it would have. */
const recordedLayout = (text: string) => {
  mkdirSync(join(app, 'layouts'), { recursive: true })
  writeFileSync(join(app, 'layouts/factory.json'), text)
  writeFileSync(
    join(app, 'factory-mod-install.json'),
    JSON.stringify({
      files: { 'layouts/factory.json': createHash('sha256').update(text).digest('hex') },
    })
  )
}

const layoutWith = (maintainer: string) =>
  JSON.stringify({
    id: 'root',
    children: [{ id: 'factory', content: { props: { maintainer } } }],
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
          env: { ...env, HERDR_APP_DIR: dir, FACTORY_MAINTAINER: 'someone' },
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

  it('install.sh writes a spaces file whose entries share a name into the layout as it is', () => {
    const spaces = [
      { name: 'micelio', repo: 'bogd3v/micelio', milestone: 18, epic: 872 },
      { name: 'micelio', repo: 'bogd3v/micelio-cms', milestone: 12, tag: 'c' },
      { name: 'micelio', repo: 'bogd3v/micelio-plugin-core', milestone: 8, tag: 'pc' },
      { name: 'micelio-engineering', repo: 'bogd3v/micelio-engineering', milestone: 12 },
    ]
    const dir = mkdtempSync(join(tmpdir(), 'spaces-'))
    try {
      const file = join(dir, 'spaces.json')
      writeFileSync(file, JSON.stringify(spaces))
      expect(install('--maintainer', 'someone', '--spaces', file).status).toBe(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
    type Node = { id?: string; content?: { props?: { spaces?: unknown } }; children?: Node[] }
    const find = (n: Node): Node | undefined =>
      n.id === 'factory' ? n : (n.children ?? []).map(find).find(Boolean)
    const layout = JSON.parse(readFileSync(join(app, 'layouts/factory.json'), 'utf8')) as Node
    expect(find(layout)?.content?.props?.spaces).toEqual(spaces)
  })

  it('install.sh with no --maintainer and no FACTORY_MAINTAINER keeps the maintainer of the layout it installed, and says so', () => {
    expect(installFrom(undefined, '--maintainer', 'ale9420').status).toBe(0)
    const run = installFrom(undefined)
    expect(run.status).toBe(0)
    expect(run.stderr).toBe('install.sh: maintainer ale9420, kept from the installed layout\n')
    expect(installedMaintainer()).toBe('ale9420')
    // An empty FACTORY_MAINTAINER is no source either.
    expect(installFrom('').status).toBe(0)
    expect(installedMaintainer()).toBe('ale9420')
  })

  it('install.sh with no maintainer from any source writes nothing and exits 2', () => {
    for (const run of [installFrom(undefined), installFrom('')]) {
      expect(run.status).toBe(2)
      expect(run.stderr).toBe(NO_MAINTAINER)
      expect(walk(app)).toEqual([])
    }
    // A layout it did not write is not read, even with a login in it; nor is one it wrote that was
    // edited since, nor one it wrote with no login.
    const mine = layoutWith('ale9420')
    mkdirSync(join(app, 'layouts'), { recursive: true })
    writeFileSync(join(app, 'layouts/factory.json'), mine)
    const unrecorded = installFrom(undefined)
    expect(unrecorded.status).toBe(2)
    expect(unrecorded.stderr).toBe(NO_MAINTAINER)
    expect(walk(app)).toEqual(['layouts/factory.json'])

    recordedLayout(mine)
    writeFileSync(join(app, 'layouts/factory.json'), layoutWith('other'))
    const edited = installFrom(undefined)
    expect(edited.status).toBe(2)
    expect(edited.stderr).toBe(NO_MAINTAINER)
    expect(layoutText()).toBe(layoutWith('other'))

    // No `maintainer` key at all is no login either, not the word `undefined`.
    const noKey = JSON.stringify({ id: 'factory', content: { props: {} } })
    for (const text of [layoutWith(''), layoutWith('{{maintainer}}'), noKey]) {
      recordedLayout(text)
      const run = installFrom(undefined)
      expect(run.status).toBe(2)
      expect(run.stderr).toBe(NO_MAINTAINER)
      expect(layoutText()).toBe(text)
      expect(walk(app)).toEqual(['factory-mod-install.json', 'layouts/factory.json'])
    }
  })

  it('install.sh --maintainer takes precedence over FACTORY_MAINTAINER, and FACTORY_MAINTAINER over the installed layout', () => {
    expect(installFrom(undefined, '--maintainer', 'first').status).toBe(0)
    // With no other source, the installed layout is the one.
    const fromLayout = installFrom(undefined)
    expect(fromLayout.status).toBe(0)
    expect(fromLayout.stderr).toBe('install.sh: maintainer first, kept from the installed layout\n')
    expect(installedMaintainer()).toBe('first')
    // FACTORY_MAINTAINER wins over the layout, which still says `first`.
    const fromEnv = installFrom('second')
    expect(fromEnv.status).toBe(0)
    expect(fromEnv.stderr).toBe('')
    expect(installedMaintainer()).toBe('second')
    const fromOption = installFrom('second', '--maintainer', 'third')
    expect(fromOption.status).toBe(0)
    expect(fromOption.stderr).toBe('')
    expect(installedMaintainer()).toBe('third')
    // The option wins over a value of the environment that is no login.
    expect(installFrom('not a login', '--maintainer', 'fourth').status).toBe(0)
    expect(installedMaintainer()).toBe('fourth')
  })

  it('install.sh refuses a --maintainer that is not a GitHub login and writes nothing', () => {
    const refused = () => {
      for (const value of ['', '{{maintainer}}', '-dash', 'under_score', 'a b', 'a'.repeat(40)]) {
        const run = installFrom('someone', '--maintainer', value)
        expect(run.status, value).toBe(2)
        expect(run.stderr, value).toContain('--maintainer')
      }
      const bare = installFrom('someone', '--maintainer')
      expect(bare.status).toBe(2)
      expect(bare.stderr).toContain('--maintainer')
      const fromEnv = installFrom('under_score')
      expect(fromEnv.status).toBe(2)
      expect(fromEnv.stderr).toContain('--maintainer')
    }
    refused()
    expect(walk(app)).toEqual([])
    // Over an install, with a login to keep: still nothing is written.
    expect(installFrom(undefined, '--maintainer', 'a'.repeat(39)).status).toBe(0)
    const before = layoutText()
    refused()
    expect(layoutText()).toBe(before)
  })

  it('install.sh refuses an option it does not know', () => {
    const run = install('--theme', 'sepia')
    expect(run.status).toBe(2)
    expect(walk(app)).toEqual([])
  })

  /** The ids of the children of `work-body` in the installed layout, and the side prop of the factory block. */
  const sideOf = () => {
    interface Node {
      id: string
      children?: Node[]
      content?: { props: { side: string } }
    }
    const find = (n: Node, id: string): Node | undefined =>
      n.id === id ? n : (n.children ?? []).map((c) => find(c, id)).find(Boolean)
    const layout = JSON.parse(readFileSync(join(app, 'layouts/factory.json'), 'utf8')) as Node
    return {
      ids: (find(layout, 'work-body')?.children ?? []).map((c) => c.id),
      side: find(layout, 'factory')?.content?.props.side,
    }
  }

  it('install.sh --side left puts the factory block first in work-body, and right last', () => {
    expect(install('--side', 'left').status).toBe(0)
    expect(sideOf()).toEqual({ ids: ['factory', 'main', 'panel'], side: 'left' })
    // Run again: it replaces what it wrote, and the default is the right.
    expect(install('--side', 'right').status).toBe(0)
    expect(sideOf()).toEqual({ ids: ['main', 'panel', 'factory'], side: 'right' })
    expect(install('--side', 'left').status).toBe(0)
    expect(install().status).toBe(0)
    expect(sideOf()).toEqual({ ids: ['main', 'panel', 'factory'], side: 'right' })
    // Any other side writes nothing.
    const bad = install('--side', 'top')
    expect(bad.status).toBe(2)
    expect(bad.stderr).toContain('--side')
  })

  it('install.sh writes no keys.json and nothing outside mods/factory, layouts/factory.json and its record', () => {
    // A keys.json that is the person's stays as it is, byte for byte, and none is made when there is none.
    expect(install('--side', 'left', '--fixture', 'test/fixtures/herdr-mod/normal').status).toBe(0)
    expect(existsSync(join(app, 'keys.json'))).toBe(false)
    const mine = '{ "mod:factory": { "alt-n": "factory.next" } }\n'
    writeFileSync(join(app, 'keys.json'), mine)
    writeFileSync(join(app, 'shared.json'), '{"factory.settings":{"panel":false}}\n')
    expect(install().status).toBe(0)
    expect(readFileSync(join(app, 'keys.json'), 'utf8')).toBe(mine)
    expect(readFileSync(join(app, 'shared.json'), 'utf8')).toBe(
      '{"factory.settings":{"panel":false}}\n'
    )
    const written = walk(app).filter((f) => f !== 'keys.json' && f !== 'shared.json')
    expect(
      written.filter(
        (f) =>
          !f.startsWith('mods/factory/') &&
          f !== 'layouts/factory.json' &&
          f !== 'factory-mod-install.json'
      )
    ).toEqual([])
  })
})
