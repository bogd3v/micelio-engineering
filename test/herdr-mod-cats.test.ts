import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
// @ts-expect-error a plain JavaScript module of the mod, with no declarations
import { ROLES, STATES, catFile } from '../herdr/mod/factory/lib/cat.js'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const BUILD = join(ROOT, 'herdr/mod/build-cats.mjs')
const TOKENS = JSON.parse(readFileSync(join(ROOT, 'herdr/mod/design/tokens.json'), 'utf8')) as {
  themes: Record<string, Record<string, string>>
}

let dir: string
let again: string

const build = (out: string): string =>
  execFileSync('node', [BUILD, '--out', out], { encoding: 'utf8' })
const svg = (role: string, state: string, crop: string, theme: string): string =>
  readFileSync(join(dir, `${role}-${state}-${crop}-${theme}.svg`), 'utf8')
/** The `<path>` and `<circle>` elements of a file, in draw order. */
const elements = (text: string): string[] => text.match(/<(?:path|circle|rect)\b[^>]*>/g) ?? []

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'cats-'))
  again = mkdtempSync(join(tmpdir(), 'cats-'))
  build(dir)
  build(again)
})

afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
  rmSync(again, { recursive: true, force: true })
})

describe('build-cats', () => {
  it('build-cats writes 120 files, each well-formed and under 20 kB, and a second run writes the same bytes', () => {
    const names = readdirSync(dir).sort()
    expect(names).toHaveLength(120)
    expect(readdirSync(again).sort()).toEqual(names)
    for (const name of names) {
      const text = readFileSync(join(dir, name), 'utf8')
      expect(statSync(join(dir, name)).size, name).toBeLessThan(20_000)
      expect(text.startsWith('<svg '), name).toBe(true)
      expect(text.trimEnd().endsWith('</svg>'), name).toBe(true)
      expect(text, name).toContain('viewBox="0 0 100 100"')
      // Every tag that opens closes, and no placeholder of the source is left.
      expect(text, name).not.toContain('{{')
      const open = text.match(/<g[ >]/g)?.length ?? 0
      expect(text.match(/<\/g>/g)?.length ?? 0, name).toBe(open)
      expect(text, name).not.toMatch(/\d{4}-\d{2}-\d{2}|random|Math/)
      expect(text, name).toBe(readFileSync(join(again, name), 'utf8'))
    }
  })

  it("the reviewer's ink and collar are #e8f0ff and every other role's are #0b0c10", () => {
    for (const role of ROLES) {
      const want = role === 'reviewer' ? '#e8f0ff' : '#0b0c10'
      for (const theme of ['dark', 'light']) {
        const [, collar, , , ink] = elements(svg(role, 'working', 'full', theme))
        expect(collar, `${role} collar`).toContain(`fill="${want}"`)
        expect(ink, `${role} ink`).toContain(`fill="${want}"`)
        expect(ink).toContain('fill-rule="evenodd"')
      }
    }
  })

  it('working has the wave marks, needs the magenta bell, idle the closed eyes at 0.55 opacity, held the pause mark, red an outline 30 wide in the red token', () => {
    for (const theme of ['dark', 'light']) {
      const t = TOKENS.themes[theme]
      const wave = 'M226 296q-24 36 0 72M198 280q-38 52 0 104'
      const closed = 'M426 320Q458 350 490 320M561 320Q593 350 625 320'
      const bell = (s: string): string => elements(s)[2] ?? ''
      const working = svg('worker', 'working', 'full', theme)
      expect(working).toContain(wave)
      expect(working).toContain(`stroke="${t.fg}" stroke-width="12"`)
      expect(bell(working)).toContain('fill="#ffd23f"')

      const needs = svg('worker', 'needs', 'full', theme)
      expect(bell(needs)).toContain(`fill="${t.magenta}"`)
      expect(needs).not.toContain(wave)
      expect(needs).not.toMatch(/filter|drop-shadow|blur/)

      const idle = svg('worker', 'idle', 'full', theme)
      expect(idle).toContain(closed)
      expect(idle).toMatch(/^<svg [^>]*opacity="0\.55"/)
      expect(working).not.toContain('opacity=')

      const held = svg('worker', 'held', 'full', theme)
      expect(held).toContain('M52 40v70M98 40v70')
      expect(held).toContain(`fill="${t['warn-fill']}" stroke="${t.fg}"`)
      expect(bell(held)).toContain(`fill="${t['warn-fill']}"`)
      expect(held).toContain('M428 328h60M563 328h60')

      const red = svg('worker', 'red', 'full', theme)
      expect(elements(red)[0]).toContain(`stroke="${t.red}" stroke-width="30"`)
      expect(bell(red)).toContain(`fill="${t.red}"`)
      expect(elements(svg('worker', 'working', 'full', theme))[0]).toContain('stroke-width="10"')
    }
  })

  it('the head crop carries the badge of its role and the full crop does not', () => {
    for (const role of ROLES) {
      for (const state of STATES) {
        const head = svg(role, state, 'head', 'dark')
        const full = svg(role, state, 'full', 'dark')
        expect(head, `${role} ${state}`).toContain('translate(598 504) scale(1.15)')
        expect(head).toContain('r="100"')
        expect(full, `${role} ${state}`).not.toContain('translate(598 504)')
        expect(full).not.toContain('r="100"')
        expect(head).toContain('translate(-235 -140)')
        expect(full).toContain('translate(-120 -132)')
      }
    }
    // The badge of each role is its own icon.
    expect(svg('planner', 'working', 'head', 'dark')).toContain('width="112" height="144"')
    expect(svg('master', 'working', 'head', 'dark')).toContain('rx="54" ry="78"')
    expect(svg('worker', 'working', 'head', 'dark')).toContain('rotate(40)')
    expect(svg('reviewer', 'working', 'head', 'dark')).toContain('fill="#bfe9ff"')
    expect(svg('verifier', 'working', 'head', 'dark')).toContain('width="128" height="128"')
    expect(svg('scribe', 'working', 'head', 'dark')).toContain('rotate(35)')
  })
})

describe('catFile', () => {
  it('catFile gives worker-needs-head-dark.svg for worker, needs, 24 and dark, and nothing for an unknown role', () => {
    expect(catFile('worker', 'needs', 24, 'dark')).toBe('worker-needs-head-dark.svg')
    expect(catFile('worker', 'needs', 31, 'dark')).toBe('worker-needs-head-dark.svg')
    expect(catFile('worker', 'idle', 32, 'light')).toBe('worker-idle-full-light.svg')
    expect(catFile('robot', 'needs', 24, 'dark')).toBeUndefined()
    expect(catFile(undefined, 'needs', 24, 'dark')).toBeUndefined()
    expect(catFile('', 'needs', 24, 'dark')).toBeUndefined()
  })

  it('names every file the build writes', () => {
    const names = new Set(readdirSync(dir))
    for (const role of ROLES)
      for (const state of STATES)
        for (const [size, theme] of [
          [24, 'dark'],
          [48, 'light'],
        ] as const)
          expect(names.has(catFile(role, state, size, theme) as string)).toBe(true)
  })
})
