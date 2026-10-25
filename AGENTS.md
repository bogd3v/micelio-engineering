# AGENTS.md

Instructions for coding agents working in this repository. It holds Micelio's shared tooling: the configuration packages, the factory's commands, the reusable workflows and the canonical copy of the engineering standard.

## Engineering standard

The rules shared by every Micelio repository live in [`docs/engineering-standard.md`](docs/engineering-standard.md). This repository follows standard version 1.5 (`standard: 1.5`; `npm run lint:standard` checks the copy against the hashes bundled in `@micelio/eslint-config`). This file adds what is specific to this repository and never relaxes the standard. This is the canonical copy: a change to the standard is a pull request here titled `docs(standard): …` (section 16), and `.github/workflows/standard-sync.yml` carries it to the other repositories (`docs/standard-sync.md`).

## Commands

```bash
npm ci
npm run check            # typecheck, lint, format:check, test, lint:licenses and lint:standard
npm run build            # compiles the packages (typecheck, lint and test run it first)
npm run template -- <dir> # creates a repository from template/ (docs/template.md)
npm run verify:template  # creates one, installs the packed packages and runs its checks (needs the registry)
npm run verify:isolated  # installs the three packed packages in an empty project and runs the fixture's checks (needs the registry)
npm run lint-issue --workspace packages/factory-tools -- <owner/repo#n> # checks an issue against the Definition of Ready (needs gh)
npm run metrics --workspace packages/factory-tools -- --milestone "<title>" # the factory's numbers for a milestone (needs gh; --fixtures <dir> reads a recording instead)
```

## Structure

- `packages/` — the configuration packages `@micelio/eslint-config`, `@micelio/tsconfig` and `@micelio/prettier-config`, each with its own version and published by `.github/workflows/publish-packages.yml` from a tag `<package>-vX.Y.Z`; and `@micelio/factory-tools`, the factory's commands (`lint-issue`, `issue-ready` and `metrics`, their rules and columns in `packages/factory-tools/README.md`), not published yet.
- `fixtures/basic/` — a project that uses only the three configuration packages; their tests run against it.
- `.github/workflows/` — the reusable workflows (`check`, `dco`, `scorecard`, `release`), `standard-sync` and this repository's own `ci.yml` (`docs/workflows.md`).
- `.claude/` — this repository's own copy of the factory files in `.github/standard-sync.json` (`agents/`, `skills/ship-pr`; the pull request template is the root `.github/pull_request_template.md`), byte-identical to `template/.claude/` (`test/factory-files.test.ts` checks it), and its roster, `TEAM.md`.
- `template/` — the files of section 14 of the standard, with `{{placeholders}}`, the prompts of the five factory roles in `template/.claude/agents/` (`docs/factory.md`) and the `ship-pr` skill in `template/.claude/skills/`; the files listed in `.github/standard-sync.json` are synced to the other repositories, and after you change one, `node scripts/synced-hashes.mjs` refreshes their hashes and the copy at the same path at the root must follow (`docs/standard-sync.md`); `scripts/template.mjs` copies it and `scripts/template-checklist.json` maps each box of the section to a file or an organisation setting.
- `docs/` — the standard, the factory (`factory.md`: the pipeline, its gates and roles; `factory-log.md`: the correction log), how the workflows are used, and Micelio's `contributing.md`, `governance.md`, `trademarks.md` and `adr-template.md`. The other repositories link to them from a short `CONTRIBUTING.md` of their own (section 1 of the standard).
- `REUSE.toml`, `LICENSES/` — licensing metadata; the repository is MIT-0 and `reuse lint` runs in CI.

## Rules

- Hard limits: [`.claude/TEAM.md`](.claude/TEAM.md) holds the roster of the five factory roles, their models and their limits. Never push, merge, tag, release or deploy, and never act on production or staging, without the approval of the human running the session; never read or print secrets.
- Work moves through the gates of [`docs/factory.md`](docs/factory.md).
- This repository has no Docker image. What stands in for it: the worker runs `npm run check`, then `npm run verify:template` and `npm run verify:isolated` in its worktree, and the verifier runs them again on a fresh clone.
- Before 1.0.0 a breaking change raises `y` and everything else raises `z` (section 7). The bump is made by a `chore(release)` pull request before the tag.
- Published versions never change. A bad release is fixed by the next patch.
