import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const WORKFLOW = readFileSync(join(ROOT, '.github/workflows/release.yml'), 'utf8')

/** The shell of one step of `release.yml`, by its name, without the YAML indentation. */
function stepScript(name: string): string {
  const step = WORKFLOW.split(`- name: ${name}\n`)[1]?.split(/\n {6}- name: /)[0] ?? ''
  const body = step.split('run: |\n')[1] ?? ''
  return body.replace(/^ {10}/gm, '')
}

const CHECK = stepScript('Check the release can be published')

/** Runs the check step as Actions does (`bash -e`) where the root package is `pkg`, `gh` stubbed out. */
function check(
  pkg: object,
  env: Record<string, string>
): { status: number | null; output: string } {
  const base = mkdtempSync(join(tmpdir(), 'micelio-release-'))
  const bin = join(base, 'bin')
  mkdirSync(bin)
  // No tag exists: the stub answers every `gh api` call with a failure.
  writeFileSync(join(bin, 'gh'), '#!/usr/bin/env bash\nexit 1\n')
  chmodSync(join(bin, 'gh'), 0o755)
  writeFileSync(join(base, 'package.json'), JSON.stringify(pkg))
  const result = spawnSync('bash', ['-e', '-c', CHECK], {
    cwd: base,
    env: {
      PATH: `${bin}:${process.env.PATH ?? ''}`,
      GITHUB_STEP_SUMMARY: join(base, 'summary.md'),
      GITHUB_SHA: 'a'.repeat(40),
      REPO: 'example/none',
      TAG: 'v0.1.0',
      VERSION: '0.1.0',
      BREAKING: '0',
      COMPATIBILITY: '- Node: 22',
      CHECK_PACKAGE_VERSION: 'true',
      DRY_RUN: 'false',
      ...env,
    },
    encoding: 'utf8',
  })
  return { status: result.status, output: result.stdout + result.stderr }
}

const PLUGIN = { name: '@micelio/strapi-plugin-core', version: '0.1.0' }

describe('release.yml', () => {
  it('lists the root package as what a dry run would publish', () => {
    const result = check(PLUGIN, { NPM_ROOT: 'true', NPM_TOKEN: 'x', DRY_RUN: 'true' })
    expect(result.status, result.output).toBe(0)
    expect(result.output).toContain('npm: would publish @micelio/strapi-plugin-core')
    expect(result.output).not.toContain('::warning::')
  })

  it('lists what a dry run would publish without NPM_TOKEN', () => {
    const result = check(PLUGIN, { NPM_ROOT: 'true', DRY_RUN: 'true' })
    expect(result.status, result.output).toBe(0)
    expect(result.output).toContain('npm: would publish @micelio/strapi-plugin-core')
    expect(result.output).not.toContain('::warning::')
  })

  it('does not read NPM_TOKEN in the plan job', () => {
    const plan = WORKFLOW.split(/\n {2}plan:\n/)[1]?.split(/\n {2}publish:\n/)[0] ?? ''
    expect(plan).toContain('Check the release can be published')
    expect(plan).not.toContain('NPM_TOKEN')
    const result = check(PLUGIN, { NPM_ROOT: 'true' })
    expect(result.status, result.output).toBe(0)
    expect(result.output).not.toContain('NPM_TOKEN')
  })

  it('fails the publish job without NPM_TOKEN, in the release environment', () => {
    const publish = WORKFLOW.split(/\n {2}publish:\n/)[1] ?? ''
    expect(publish).toContain('environment: ${{ inputs.environment }}')
    const name = 'Check the npm token is set'
    // The check runs before anything is published or tagged
    expect(publish.indexOf(`- name: ${name}`)).toBeGreaterThan(-1)
    expect(publish.indexOf(`- name: ${name}`)).toBeLessThan(publish.indexOf('- name: Checkout'))
    const step = publish.split(`- name: ${name}\n`)[1]?.split(/\n {6}- name: /)[0] ?? ''
    expect(step).toContain("if: ${{ inputs.npm-root || inputs.npm-workspaces != '' }}")
    expect(step).toContain('NPM_TOKEN: ${{ secrets.NPM_TOKEN }}')
    const script = stepScript(name)
    for (const [token, status] of [
      ['', 1],
      ['x', 0],
    ] as const) {
      const result = spawnSync('bash', ['-e', '-c', script], {
        env: { PATH: process.env.PATH ?? '', NPM_TOKEN: token },
        encoding: 'utf8',
      })
      expect(result.status, result.stdout + result.stderr).toBe(status)
      if (status === 1) {
        expect(result.stdout).toContain(
          '::error::npm-root or npm-workspaces is set but the NPM_TOKEN secret is not passed.'
        )
      }
    }
  })

  it('refuses to publish a private root package', () => {
    const result = check({ ...PLUGIN, private: true }, { NPM_ROOT: 'true', NPM_TOKEN: 'x' })
    expect(result.status).toBe(1)
    expect(result.output).toContain(
      '::error::npm-root is set but the package at the root is private'
    )
  })

  it('publishes nothing from the root unless asked', () => {
    expect(WORKFLOW).toMatch(/npm-root:\n(?:\s+.+\n)*?\s+default: false\n/)
    const result = check({ ...PLUGIN, private: true }, { NPM_ROOT: 'false' })
    expect(result.status, result.output).toBe(0)
    expect(result.output).not.toContain('npm:')
  })

  it('publishes the root package with the flags of the workspaces', () => {
    const publish = stepScript('Publish the npm packages with provenance')
    expect(publish).toContain('flags=(--provenance --access public)')
    expect(publish).toContain('if [ "$PRERELEASE" = true ]; then flags+=(--tag next); fi')
    expect(publish).toContain('if [ "$ROOT" = true ]; then npm publish "${flags[@]}"; fi')
    expect(publish).toContain('npm publish -w "$workspace" "${flags[@]}"')
  })
})
