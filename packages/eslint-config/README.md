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
