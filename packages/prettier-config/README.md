# @micelio/prettier-config

The Prettier configuration of the Micelio repositories (section 4 of the
engineering standard: one formatter configuration per repository, checked in CI).

```json
{
  "prettier": "@micelio/prettier-config",
  "scripts": {
    "format:check": "prettier --check ."
  }
}
```

Semicolons, single quotes, ES5 trailing commas, 100 columns, two spaces.
