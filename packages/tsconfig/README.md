# @micelio/tsconfig

The base TypeScript configuration of the Micelio repositories (section 4 of the
engineering standard): `strict`, and the language level of the Node major in
`.nvmrc` (Node 22: `ES2023`, `NodeNext`).

Beyond `strict`, the base turns on:

| Option                       | What it catches                                                                                                     |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `noUncheckedIndexedAccess`   | An element read by index or key and used as if it could not be `undefined`.                                         |
| `exactOptionalPropertyTypes` | An optional property set to `undefined` when its type does not say `undefined`.                                     |
| `noImplicitOverride`         | A member that overrides one of the base class without `override`.                                                   |
| `noImplicitReturns`          | A function that returns a value on some paths and falls off the end on others.                                      |
| `noFallthroughCasesInSwitch` | A non-empty `case` that runs into the next one.                                                                     |
| `isolatedModules`            | Code a compiler that reads one file at a time cannot translate, such as a read of an ambient `const enum`.          |
| `erasableSyntaxOnly`         | Syntax that cannot be removed to leave JavaScript: `enum`, a runtime `namespace`, a constructor parameter property. |

```json
{
  "extends": "@micelio/tsconfig",
  "include": ["src"]
}
```

A repository adds only what is its own (`include`, `outDir`, a different
`module` when a framework needs it). `@types/node` is a peer dependency and the base loads it (`"types": ["node"]`); a browser-only
project sets its own `types`. The Node major moves with a MAJOR of this
package once the standard raises it.
