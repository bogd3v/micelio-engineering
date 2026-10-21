# @micelio/tsconfig

The base TypeScript configuration of the Micelio repositories (section 4 of the
engineering standard): `strict`, and the language level of the Node major in
`.nvmrc` (Node 22: `ES2023`, `NodeNext`).

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
