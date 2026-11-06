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
