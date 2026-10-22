# AGENTS.md

Instructions for coding agents working in this repository. It holds Micelio's shared tooling: the configuration packages, the reusable workflows and the canonical copy of the engineering standard.

## Engineering standard

The rules shared by every Micelio repository live in [`docs/engineering-standard.md`](docs/engineering-standard.md). This repository follows standard version 1.4 (`standard: 1.4`; `npm run lint:standard` checks the copy against the hashes bundled in `@micelio/eslint-config`). This file adds what is specific to this repository and never relaxes the standard. This is the canonical copy: a change to the standard is a pull request here titled `docs(standard): …` (section 16), and `.github/workflows/standard-sync.yml` carries it to the other repositories (`docs/standard-sync.md`).

## Commands

```bash
npm ci
npm run check            # typecheck, lint, format:check, test, lint:licenses and lint:standard
npm run build            # compiles the packages (typecheck, lint and test run it first)
npm run verify:isolated  # installs the three packed packages in an empty project and runs the fixture's checks (needs the registry)
```

## Structure

- `packages/` — `@micelio/eslint-config`, `@micelio/tsconfig`, `@micelio/prettier-config`. Each has its own version and is published by `.github/workflows/publish-packages.yml` from a tag `<package>-vX.Y.Z`.
- `fixtures/basic/` — a project that uses only the three packages; their tests run against it.
- `.github/workflows/` — the reusable workflows (`check`, `dco`, `scorecard`, `release`), `standard-sync` and this repository's own `ci.yml` (`docs/workflows.md`).
- `docs/` — the standard, how the workflows are used, and Micelio's `contributing.md`, `governance.md`, `trademarks.md` and `adr-template.md`. The other repositories link to them from a short `CONTRIBUTING.md` of their own (section 1 of the standard).
- `REUSE.toml`, `LICENSES/` — licensing metadata; the repository is MIT-0 and `reuse lint` runs in CI.

## Rules

- Hard limits: `.claude/TEAM.md` is not here yet; until it is, read `micelio`'s. Never push, merge, tag, release or deploy without the human's approval, and never read secrets.
- Before 1.0.0 a breaking change raises `y` and everything else raises `z` (section 7). The bump is made by a `chore(release)` pull request before the tag.
- Published versions never change. A bad release is fixed by the next patch.
