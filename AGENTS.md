# AGENTS.md

Instructions for coding agents working in this repository. It holds Micelio's shared tooling: the configuration packages, the factory's commands, the reusable workflows and the canonical copy of the engineering standard.

## Engineering standard

The rules shared by every Micelio repository live in [`docs/engineering-standard.md`](docs/engineering-standard.md), the core, and in the profiles of [`docs/standard/`](docs/standard/). This repository follows standard version 2.0 with the TypeScript profile (`standard: 2.0`, `profile: typescript`; `npm run lint:standard` checks the core and `docs/standard/typescript.md` against the hashes bundled in `@micelio/eslint-config`). This file adds what is specific to this repository and never relaxes the standard. This is the canonical copy of the core and of both profiles (`typescript.md`, `site-engine.md`): a change to the standard is a pull request here titled `docs(standard): …` (section 16), and `.github/workflows/standard-sync.yml` carries it to the other repositories (`docs/standard-sync.md`).

## Commands

```bash
install: npm ci
test: npm test
check: npm run check            # typecheck, lint, format:check, test, lint:licenses and lint:standard
npm run build            # compiles the packages (typecheck, lint and test run it first)
npm run template -- <dir> # creates a repository from template/ (docs/template.md)
npm run verify:template  # creates one, installs the packed packages and runs its checks (needs the registry)
npm run verify:isolated  # installs the three packed packages in an empty project and runs the fixture's checks (needs the registry)
npm run lint-issue --workspace packages/factory-tools -- <owner/repo#n> # checks an issue against the Definition of Ready (needs gh)
npm run metrics --workspace packages/factory-tools -- --milestone "<title>" # the factory's numbers for a milestone (needs gh; --fixtures <dir> reads a recording instead)
```

What the commands need besides Node 22: the `node:22` image has `git` but not `jq`, `gh` or `reuse`.
`npm run check` needs `git` and `jq` (`scripts/standard-sync.sh` calls `jq`);
`npm run verify:template` also needs `reuse` 6.2.0, the version CI pins (an older `reuse` does not
read `REUSE.toml`); `gh`, logged in, is for `scripts/standard-sync.sh`, its dry run included, and
for the live forms of `lint-issue` and `metrics`; the tests stub it.
In the container, `apt-get update && apt-get install -y jq python3-pip` and `pip install --break-system-packages reuse==6.2.0` supply `jq` and `reuse`, not `gh`: install it from the host or skip the commands that need it.
In a git worktree, Docker also needs the main repository's `.git` mounted at the same path (the worktree's `.git` is a file that points to it), and on an SELinux host `--security-opt label=disable`.
In the container, run `git config --global --add safe.directory <worktree path>` first, or git refuses the mounted worktree as owned by another user.

## Structure

- `packages/` — the configuration packages `@micelio/eslint-config`, `@micelio/tsconfig` and `@micelio/prettier-config`, each with its own version and published by `.github/workflows/publish-packages.yml` from a tag `<package>-vX.Y.Z`; and `@micelio/factory-tools`, the factory's commands (`lint-issue`, `issue-ready`, `project-fields-backfill` and `metrics`, their rules and columns in `packages/factory-tools/README.md`), not published yet.
- `fixtures/basic/` — a project that uses only the three configuration packages; their tests run against it.
- `fixtures/rust-basic/` — a minimal Rust library that `ci.yml` checks through `check.yml` with `profile: rust`.
- `.github/workflows/` — the reusable workflows (`check`, `dco`, `scorecard`, `release`), `standard-sync`, and this repository's own `ci.yml` and `project-fields-backfill.yml` (`docs/workflows.md`); `.github/project-fields.json` holds the Release line and Front of each milestone.
- `.claude/` — this repository's own copy of the factory files in `.github/standard-sync.json` (`agents/`, `skills/ship-pr`, `skills/blind-review` and `skills/verify-pr`; the pull request template is the root `.github/pull_request_template.md` and `CLAUDE.md` the root `CLAUDE.md`), byte-identical to `template/.claude/` (`test/factory-files.test.ts` checks it), and its roster, `TEAM.md`.
- `template/` — the files of section 14 of the standard, with `{{placeholders}}`, the prompts of the five factory roles in `template/.claude/agents/` (`docs/factory.md`) and the `ship-pr`, `blind-review` and `verify-pr` skills in `template/.claude/skills/`; the files listed in `.github/standard-sync.json` are synced to the other repositories, and after you change one, `node scripts/synced-hashes.mjs` (after `npm run build`) refreshes their hashes and the copy at the same path at the root must follow (`docs/standard-sync.md`); `scripts/template.mjs` copies it and `scripts/template-checklist.json` maps each box of the section to a file or an organisation setting.
- `herdr/master.md` — the Herdr runbook of the master (not synced); `fixtures/factory/` — the planted defects, `build-scratch.sh`, `run-canary.sh` and `RUN.md` that prove the gates (`docs/factory.md`, "Running the master"; `test/factory-fixtures.test.ts` keeps their numbers true).
- `docs/` — the standard (the core, and its profiles in `docs/standard/`), the factory (`factory.md`: the pipeline, its gates and roles; `factory-log.md`: the correction log), how the workflows are used, and Micelio's `contributing.md`, `governance.md`, `trademarks.md` and `adr-template.md`; the records of the decisions about the standard and the tooling are in `docs/adr/`. The other repositories link to them from a short `CONTRIBUTING.md` of their own (section 1 of the standard).
- `REUSE.toml`, `LICENSES/` — licensing metadata; the repository is MIT-0 and `reuse lint` runs in CI.

## Rules

- Hard limits: [`.claude/TEAM.md`](.claude/TEAM.md) holds the roster of the five factory roles, their models and their limits. Never push, merge, tag, release or deploy, and never act on production or staging, without the approval of the human running the session; never read or print secrets.
- Work moves through the gates of [`docs/factory.md`](docs/factory.md).
- This repository has no Docker image. What stands in for it: the worker runs `npm run check`, then `npm run verify:template` and `npm run verify:isolated` in its worktree, and the verifier runs them again on a fresh clone.
- Before 1.0.0 a breaking change raises `y` and everything else raises `z` (section 7). The bump is made by a `chore(release)` pull request before the tag.
- Published versions never change. A bad release is fixed by the next patch.
