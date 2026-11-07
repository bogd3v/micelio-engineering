# AGENTS.md

The fixture of `.github/actions/lint-standard`: a repository without npm (no `package.json`) that follows standard version 1.8 (`standard: 1.8`). `.github/workflows/ci.yml` runs the action on it (job `lint-standard`), and on a copy of it with one character of `docs/engineering-standard.md` changed (job `lint-standard-mismatch`).

## Commands

```bash
check: npx --yes --package @micelio/eslint-config@0.2.7 micelio-lint-standard
```
