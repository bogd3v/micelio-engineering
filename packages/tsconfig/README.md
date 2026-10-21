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

A repository adds only what is its own (`include`, `outDir`, `types`, a different
`module` when a framework needs it). The Node major moves with a MAJOR of this
package once the standard raises it.
