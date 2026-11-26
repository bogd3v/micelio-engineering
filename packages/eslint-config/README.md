# @micelio/eslint-config

The ESLint flat config of the Micelio repositories (sections 4 and 15 of the
engineering standard) and the licence allowlist that `npm run lint:licenses` reads.

```js
// eslint.config.js
import micelio from '@micelio/eslint-config'

export default [...micelio, { ignores: ['generated/**'] }]
```

It extends `typescript-eslint`'s recommended rules and `eslint-config-prettier`, bans
promise chains and `console.log` (except in `scripts/`), and in `.ts` files requires
typed module boundaries (`explicit-module-boundary-types`), valid TSDoc (`tsdoc/syntax`) and a doc
comment on every public export (`jsdoc/require-jsdoc`). `eslint` and `typescript` are
peer dependencies. A flat-config override of `no-restricted-syntax` replaces the option
list, so a repository that adds selectors spreads `promiseChainRestriction` back in.

In `.ts` files it lints with type information (`parserOptions.projectService`), so every linted
`.ts` file must belong to a `tsconfig.json` of the repository, tests included; a file that none
includes fails with a parsing error that names it. Leave build output out of lint: the config
ignores `dist/` and `build/` at the root only, so a repository with packages adds their folders
(`packages/*/dist/**`) to its own `ignores`.

## Rules

Every rule below is an error. The test files (`test/**`, `tests/**`, `e2e/**`, `**/*.test.ts`)
are exempt from the three the table marks. The lines are those of the TypeScript profile of the
standard, section 4 (`docs/standard/typescript.md`); "nearest" marks a rule that no line names, with
the line it serves.

| Rule                                                                                                                             | The line of the standard it checks                                                                                                                           |
| -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@typescript-eslint/no-floating-promises`, `no-misused-promises`, `await-thenable`                                               | Style: "`async`/`await` with `try`/`catch`", and `Promise.all` and the others "are fine when awaited"                                                        |
| `@typescript-eslint/no-unsafe-argument`, `no-unsafe-assignment`, `no-unsafe-call`, `no-unsafe-member-access`, `no-unsafe-return` | TypeScript: "No `any`. Data that crosses a boundary […] enters as `unknown` and is narrowed by a schema or a type guard"                                     |
| `@typescript-eslint/no-unsafe-type-assertion` (not in tests)                                                                     | The same line: an `as` that narrows is not a type guard                                                                                                      |
| `@typescript-eslint/no-non-null-assertion` (not in tests)                                                                        | The same line: a `!` is an `as` that drops `null` and `undefined`                                                                                            |
| `@typescript-eslint/no-unnecessary-type-assertion`                                                                               | The same line: an assertion stays only where it changes the type                                                                                             |
| `@typescript-eslint/restrict-template-expressions`, `no-base-to-string`                                                          | Nearest: "No `any`": a value is narrowed to a string or a number before it is printed                                                                        |
| `@typescript-eslint/consistent-type-imports`                                                                                     | TypeScript: "Type-only imports use `import type`"                                                                                                            |
| `@typescript-eslint/switch-exhaustiveness-check`, `prefer-readonly`, `eqeqeq`                                                    | Nearest: "Every TypeScript project must compile under `strict`": the checks `strict` leaves out                                                              |
| `@typescript-eslint/only-throw-error`                                                                                            | Nearest, Errors and logging: an error is caught "where it can be handled or given context", which a thrown `Error` carries                                   |
| `max-lines` (500, blank lines and comments skipped; not in tests)                                                                | Style: "A file should stay under about 500 lines"                                                                                                            |
| `linterOptions.reportUnusedDisableDirectives`, `@eslint-community/eslint-comments/no-unlimited-disable`, `require-description`   | Comments and suppressions: "A suppression […] covers one line and carries its reason on that line", written `// eslint-disable-next-line <rule> -- <reason>` |
| `micelio/todo-names-issue`                                                                                                       | Comments and suppressions: "A `TODO` names its issue": `TODO(#123):` or `TODO(owner/repo#123):`                                                              |

`micelio/todo-names-issue` is this package's own rule (`src/todo-names-issue.ts`); it reads every
comment of `.ts`, `.js` and `.mjs` files, as the two `eslint-comments` rules do.

## Licence allowlist

`@micelio/eslint-config/licenses.json` holds `allowed`, `allowedPrefixes` and
`allowedGpl2`: the SPDX identifiers a production dependency may carry (ADR 0007). The
repository's `lint:licenses` script reads it and evaluates SPDX expressions against it.

## `lint:standard`

`micelio-lint-standard` checks that `docs/engineering-standard.md` is the copy published for the
version `AGENTS.md` pins (`` `standard: X.Y` ``), using the SHA-256 hashes in
`@micelio/eslint-config/standard-hashes.json`. Add it as `"lint:standard": "micelio-lint-standard"`
and to `npm run check`. A pinned version newer than the installed package knows fails with a message
that says to upgrade the package.

A repository may also pin its profiles on the same line, comma-separated (`` `standard: 2.0` ``,
`` `profile: typescript, site-engine` ``; ADR-0001); with no `profile:` pin it is read as
`typescript`. In `standard-hashes.json` a version maps to one hash (1.4 to 1.8, one file) or to
`{ "core": "<sha256>", "profiles": { "<profile>": "<sha256>" } }`; for the second form the command
also compares `docs/standard/<profile>.md` for each pinned profile and names the file that differs.
A profile the pinned version does not have fails, naming the ones it has (a one-file version has
`typescript` and `site-engine`).

## `lint:ee`

`micelio-lint-ee [--allow <path>]... [root]` fails when a file git tracks enables Strapi Enterprise
code, which is not AGPL-compatible (bogd3v/micelio-cms#96). It reads the tracked files with an
extension of code or configuration (`.js`, `.ts` and their variants, `.json`, `.yml`, `.sh`,
`.env.example`, `Dockerfile`) line by line and reports `path:line message` for three rules:

- the line names `STRAPI_LICENSE` (sets or reads the Enterprise licence key);
- the line imports `@strapi/review-workflows` or `@strapi/content-releases`;
- the line imports Strapi code under `ee/` (`@strapi/<package>/ee`).

`--allow <path>` (repeatable) names a tracked file, relative to the root, that may mention them, such
as `THIRD-PARTY.md` or `package-lock.json`; nothing else is skipped. A repository without Strapi
passes. Add it as `"lint:ee": "micelio-lint-ee"` and to `npm run check`.
