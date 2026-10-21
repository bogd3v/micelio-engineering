import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';
import micelio, { promiseChainRestriction } from '../src/index.js';

const FIXTURE = fileURLToPath(new URL('../../../fixtures/basic/', import.meta.url));

/** Lints `code` as if it were `src/<name>` of the fixture and returns the rule ids reported. */
async function ruleIdsFor(code: string, name = 'sample.ts'): Promise<string[]> {
  const eslint = new ESLint({ cwd: FIXTURE });
  const [result] = await eslint.lintText(code, { filePath: `${FIXTURE}src/${name}` });
  return (result?.messages ?? []).map((message) => message.ruleId ?? 'parse-error');
}

describe('@micelio/eslint-config against the fixture', () => {
  it('reports nothing on the fixture project', async () => {
    const eslint = new ESLint({ cwd: FIXTURE });
    const results = await eslint.lintFiles(['.']);
    const messages = results.flatMap((result) => result.messages);
    expect(results.length).toBeGreaterThan(0);
    expect(messages).toEqual([]);
  });

  it('requires a doc comment on a public export', async () => {
    expect(
      await ruleIdsFor('export function add(a: number, b: number): number {\n  return a + b;\n}\n')
    ).toContain('jsdoc/require-jsdoc');
    expect(await ruleIdsFor('export interface Box {\n  size: number;\n}\n')).toContain(
      'jsdoc/require-jsdoc'
    );
    expect(await ruleIdsFor('export const LIMIT = 3;\n')).toContain('jsdoc/require-jsdoc');
  });

  it('does not require a doc comment on private code, tests or declarations', async () => {
    expect(
      await ruleIdsFor(
        'function add(a: number, b: number): number {\n  return a + b;\n}\nadd(1, 2);\n'
      )
    ).toEqual([]);
    expect(await ruleIdsFor('export const LIMIT = 3;\n', 'limit.test.ts')).toEqual([]);
    expect(await ruleIdsFor('export declare const LIMIT: number;\n', 'limit.d.ts')).toEqual([]);
  });

  it('rejects a doc comment with invalid TSDoc', async () => {
    expect(await ruleIdsFor('/** The limit. @foo */\nexport const LIMIT = 3;\n')).toContain(
      'tsdoc/syntax'
    );
  });

  it('bans promise chains', async () => {
    const code = 'export {};\nfetch("https://example.test").then((response) => response.ok);\n';
    expect(await ruleIdsFor(code)).toContain('no-restricted-syntax');
  });

  it('bans any', async () => {
    expect(
      await ruleIdsFor(
        '/** Echoes a value. */\nexport function echo(value: any): unknown {\n  return value;\n}\n'
      )
    ).toContain('@typescript-eslint/no-explicit-any');
  });

  it('leaves formatting to Prettier', async () => {
    expect(await ruleIdsFor('const a = "double"\nconsole.warn(a)\nexport {}\n')).toEqual([]);
  });

  it('exports the promise-chain selector so repositories can add their own', () => {
    expect(promiseChainRestriction.selector).toContain('then|catch|finally');
    const entry = micelio.find((config) => config.rules?.['no-restricted-syntax']);
    expect(entry?.rules?.['no-restricted-syntax']).toEqual(['error', promiseChainRestriction]);
  });
});

describe('the licence allowlist', () => {
  const require = createRequire(import.meta.url);
  const list = require('@micelio/eslint-config/licenses.json') as Record<string, unknown>;

  it('resolves through the package exports', () => {
    expect(Object.keys(list)).toEqual(
      expect.arrayContaining(['allowed', 'allowedPrefixes', 'allowedGpl2'])
    );
  });

  it('holds only unique, non-empty SPDX identifiers', () => {
    for (const key of ['allowed', 'allowedPrefixes', 'allowedGpl2']) {
      const ids = list[key] as string[];
      expect(ids.length).toBeGreaterThan(0);
      expect(new Set(ids).size).toBe(ids.length);
      for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9.+-]+$/);
    }
  });

  it('allows what ADR 0007 allows and not GPL-2.0-only', () => {
    const allowed = list.allowed as string[];
    expect(allowed).toEqual(
      expect.arrayContaining(['MIT', 'ISC', 'Apache-2.0', 'MIT-0', 'CC0-1.0'])
    );
    expect(list.allowedPrefixes).toEqual(['LGPL-', 'GPL-3.0', 'AGPL-3.0']);
    expect(list.allowedGpl2).toEqual(['GPL-2.0-or-later', 'GPL-2.0+']);
    expect(JSON.stringify(list)).not.toContain('"GPL-2.0-only"');
    expect(allowed).not.toContain('EPL-2.0');
  });
});
