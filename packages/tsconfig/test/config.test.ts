import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const FIXTURE = `${ROOT}fixtures/basic/`;

/** The `target` and `lib` entry a Node major supports in full; a new major is added with its bump. */
const LANGUAGE_LEVEL_OF_NODE: Record<number, string> = { 22: 'ES2023' };

/** Reads the fixture's `tsconfig.json` the way `tsc` does, following `extends` through node_modules. */
function parseFixtureConfig(): ts.ParsedCommandLine {
  const file = ts.readConfigFile(`${FIXTURE}tsconfig.json`, ts.sys.readFile);
  return ts.parseJsonConfigFileContent(file.config, ts.sys, FIXTURE);
}

/** Type-checks `code` with the fixture's compiler options and returns the diagnostic codes. */
function diagnosticsFor(code: string): number[] {
  const dir = mkdtempSync(`${tmpdir()}/micelio-tsconfig-`);
  const file = `${dir}/sample.ts`;
  writeFileSync(file, code);
  const { options } = parseFixtureConfig();
  const program = ts.createProgram([file], { ...options, noEmit: true, types: [] });
  return ts.getPreEmitDiagnostics(program).map((diagnostic) => diagnostic.code);
}

describe('@micelio/tsconfig against the fixture', () => {
  it('is resolved by the fixture through "extends"', () => {
    const parsed = parseFixtureConfig();
    expect(parsed.errors).toEqual([]);
    expect(parsed.options.strict).toBe(true);
    expect(parsed.fileNames.some((name) => name.endsWith('src/slug.ts'))).toBe(true);
  });

  it('type-checks the fixture without errors', () => {
    const parsed = parseFixtureConfig();
    const program = ts.createProgram(parsed.fileNames, { ...parsed.options, noEmit: true });
    expect(ts.getPreEmitDiagnostics(program)).toEqual([]);
  });

  it('is strict: implicit any and null misuse are errors', () => {
    expect(diagnosticsFor('export function f(x) {\n  return x;\n}\n')).toContain(7006);
    expect(diagnosticsFor('export const n: string = null;\n')).toContain(2322);
  });

  it('follows the Node major of .nvmrc', () => {
    const major = Number(readFileSync(`${ROOT}.nvmrc`, 'utf8').trim());
    const level = LANGUAGE_LEVEL_OF_NODE[major];
    expect(
      level,
      `.nvmrc says Node ${major}: add its language level to this test and the base`
    ).toBeDefined();
    const { options } = parseFixtureConfig();
    expect(ts.ScriptTarget[options.target ?? 0]).toBe(level);
    expect(options.lib).toEqual([`lib.${level.toLowerCase()}.d.ts`]);
  });

  it('keeps engines and @types/node on the Node major of .nvmrc', () => {
    const major = Number(readFileSync(`${ROOT}.nvmrc`, 'utf8').trim());
    const manifests = [
      'package.json',
      'packages/eslint-config/package.json',
      'packages/prettier-config/package.json',
      'packages/tsconfig/package.json',
    ];
    for (const path of manifests) {
      const manifest = JSON.parse(readFileSync(`${ROOT}${path}`, 'utf8')) as {
        engines?: { node?: string };
        devDependencies?: Record<string, string>;
      };
      expect(manifest.engines?.node, path).toMatch(new RegExp(`^>=${major}\\.`));
      const types = manifest.devDependencies?.['@types/node'];
      if (types) expect(types, path).toMatch(new RegExp(`^\\^?${major}\\.`));
    }
  });
});
