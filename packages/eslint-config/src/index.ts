import { defineConfig } from 'eslint/config';
import type { Linter } from 'eslint';
import eslintConfigPrettier from 'eslint-config-prettier';
import jsdoc from 'eslint-plugin-jsdoc';
import tsdoc from 'eslint-plugin-tsdoc';
import tseslint from 'typescript-eslint';

/** Message shown when code chains a promise instead of awaiting it. */
const PROMISE_CHAIN_MESSAGE =
  'No promise chains: use await with try/catch (AGENTS.md, Async code).';

/**
 * The `no-restricted-syntax` entry that bans `.then()`, `.catch()` and `.finally()` chains.
 *
 * @remarks
 * A flat-config override of `no-restricted-syntax` replaces the whole option list, so a
 * repository that adds its own selectors spreads this one back in:
 * `['error', promiseChainRestriction, { selector: '…', message: '…' }]`.
 */
export const promiseChainRestriction = {
  selector:
    "CallExpression[callee.type='MemberExpression'][callee.property.name=/^(then|catch|finally)$/]",
  message: PROMISE_CHAIN_MESSAGE,
} as const;

/** Files that never need a doc comment: declarations, build output and tests. */
const UNDOCUMENTED_FILES = [
  '**/*.d.ts',
  'dist/**',
  'test/**',
  'tests/**',
  'e2e/**',
  '**/*.test.ts',
];

/**
 * The ESLint flat config shared by every Micelio repository (standard, sections 4 and 15).
 *
 * @remarks
 * It extends `typescript-eslint`'s recommended rules, turns off the rules Prettier owns,
 * bans promise chains and, in `.ts` files, requires valid TSDoc (`tsdoc/syntax`) and a doc
 * comment on every public export (`jsdoc/require-jsdoc`). Spread it in the repository's
 * `eslint.config.js` and add the repository's own entries after it.
 *
 * @example
 * ```ts
 * import micelio from '@micelio/eslint-config';
 *
 * export default [...micelio, { ignores: ['generated/**'] }];
 * ```
 */
const config: Linter.Config[] = defineConfig(
  {
    ignores: ['dist/', 'build/', 'coverage/', 'node_modules/', '.tmp/', '.cache/'],
  },
  tseslint.configs.recommended,
  eslintConfigPrettier,
  {
    files: ['**/*.ts', '**/*.js', '**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-restricted-syntax': ['error', promiseChainRestriction],
    },
  },
  {
    files: ['**/*.ts'],
    ignores: UNDOCUMENTED_FILES,
    plugins: { tsdoc, jsdoc },
    rules: {
      'tsdoc/syntax': 'error',
      'jsdoc/require-jsdoc': [
        'error',
        {
          publicOnly: true,
          require: { FunctionDeclaration: true, ClassDeclaration: true },
          contexts: [
            'ExportNamedDeclaration > TSInterfaceDeclaration',
            'ExportNamedDeclaration > TSTypeAliasDeclaration',
            'ExportNamedDeclaration > TSEnumDeclaration',
            'ExportNamedDeclaration > VariableDeclaration',
          ],
        },
      ],
    },
  }
);

export default config;
