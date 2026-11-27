import eslintComments from '@eslint-community/eslint-plugin-eslint-comments'
import { defineConfig } from 'eslint/config'
import type { ESLint, Linter } from 'eslint'
import eslintConfigPrettier from 'eslint-config-prettier'
import jsdoc from 'eslint-plugin-jsdoc'
import tsdoc from 'eslint-plugin-tsdoc'
import tseslint from 'typescript-eslint'
import { todoNamesIssue } from './todo-names-issue.js'

/** Message shown when code chains a promise instead of awaiting it. */
const PROMISE_CHAIN_MESSAGE = 'No promise chains: use await with try/catch (AGENTS.md, Async code).'

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
} as const

/** The test files: no doc comment, and room for the assertions a test makes on purpose. */
const TEST_FILES = ['test/**', 'tests/**', 'e2e/**', '**/*.test.ts']

/** Files that never need a doc comment: declarations, build output and tests. */
const UNDOCUMENTED_FILES = ['**/*.d.ts', 'dist/**', ...TEST_FILES]

/** This package's own rules, as the plugin `micelio`. */
const micelioPlugin: ESLint.Plugin = {
  meta: { name: '@micelio/eslint-config' },
  rules: { 'todo-names-issue': todoNamesIssue },
}

/**
 * The ESLint flat config shared by every Micelio repository (standard, sections 4 and 15).
 *
 * @remarks
 * It extends `typescript-eslint`'s recommended rules, turns off the rules Prettier owns,
 * bans promise chains and `console.log` (outside `scripts/`), requires a disable to name its rule
 * and its reason and a to-do marker to name its issue (`micelio/todo-names-issue`) and, in `.ts` files,
 * requires typed module boundaries, valid TSDoc (`tsdoc/syntax`) and a doc comment on every public
 * export (`jsdoc/require-jsdoc`). In `.ts` files it lints with type information
 * (`parserOptions.projectService`), so each one must belong to a `tsconfig.json`; the typed rules
 * and the line of the standard each checks are in the package's README. Spread it in the
 * repository's `eslint.config.js` and add the repository's own entries after it.
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
    // An `eslint-disable` that suppresses nothing fails, so a stale one cannot hide a later finding
    linterOptions: { reportUnusedDisableDirectives: 'error' },
  },
  {
    files: ['**/*.ts', '**/*.js', '**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
    },
    plugins: { '@eslint-community/eslint-comments': eslintComments, micelio: micelioPlugin },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-restricted-syntax': ['error', promiseChainRestriction],
      'no-console': ['error', { allow: ['warn', 'error'] }],
      // A disable names its rule and carries its reason (TypeScript profile, section 4)
      '@eslint-community/eslint-comments/no-unlimited-disable': 'error',
      '@eslint-community/eslint-comments/require-description': 'error',
      // A disable with no matching enable covers the rest of the file (TypeScript profile, section 4)
      '@eslint-community/eslint-comments/disable-enable-pair': 'error',
      'micelio/todo-names-issue': 'error',
    },
  },
  {
    // The rules that need the types: every `.ts` file belongs to a `tsconfig.json`
    files: ['**/*.ts'],
    languageOptions: { parserOptions: { projectService: true } },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      // A `default` would hide a member added later to the union (TypeScript profile, section 4)
      '@typescript-eslint/switch-exhaustiveness-check': [
        'error',
        { allowDefaultCaseForExhaustiveSwitch: false },
      ],
      '@typescript-eslint/only-throw-error': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/prefer-readonly': 'error',
      '@typescript-eslint/restrict-template-expressions': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/no-unsafe-type-assertion': 'error',
      '@typescript-eslint/no-unnecessary-type-assertion': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/no-base-to-string': 'error',
      eqeqeq: 'error',
      'max-lines': ['error', { max: 500, skipBlankLines: true, skipComments: true }],
    },
  },
  {
    // A test asserts a shape on purpose and may be long; it still has every other typed rule
    files: TEST_FILES,
    rules: {
      '@typescript-eslint/no-unsafe-type-assertion': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      'max-lines': 'off',
    },
  },
  {
    // Scripts talk to the terminal (standard, section 4, "Errors and logging")
    files: ['scripts/**', '.claude/skills/**/scripts/**'],
    rules: { 'no-console': 'off' },
  },
  {
    files: ['**/*.ts'],
    ignores: UNDOCUMENTED_FILES,
    plugins: { tsdoc, jsdoc },
    rules: {
      // Exported functions declare their parameter and return types (standard, section 4)
      '@typescript-eslint/explicit-module-boundary-types': 'error',
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
)

export default config
