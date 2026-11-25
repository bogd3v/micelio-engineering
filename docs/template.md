# Repository template

`template/` is section 14 of the [engineering standard](engineering-standard.md) as files, the checklist of its [TypeScript profile](standard/typescript.md): a repository created from it starts with everything a file can give it, so nobody walks the checklist by hand. `npm run template` copies it. `template-rust/` is the same for the [Rust profile](standard/rust.md) (below), chosen with `--profile rust`.

## Create a repository

From an up-to-date checkout of `main` (the workflows are pinned to its commit, which has to be on GitHub):

```bash
npm ci
npm run template -- ../micelio-example --description "One sentence about what it is."
```

| Option               | Default                  | Used for                                                           |
| -------------------- | ------------------------ | ------------------------------------------------------------------ |
| `--name <repo>`      | the directory name       | lowercase letters, digits and hyphens; the repository and the URLs |
| `--title <text>`     | the name, capitalised    | headings of the README, `LICENSE` and `REUSE.toml`                 |
| `--package <npm>`    | the name                 | `name` in `package.json`                                           |
| `--description <t>`  | `A Micelio repository.`  | README, `AGENTS.md` and `package.json`                             |
| `--ref <commit SHA>` | `HEAD` of this checkout  | the commit the reusable workflows are called at                    |
| `--no-install`       | installs                 | skips writing `package-lock.json` (needs the registry)             |
| `--profile <p>`      | `typescript`             | `typescript` or `rust` (below)                                     |
| `--license <id>`     | none; `rust` requires it | `rust` only: the SPDX id of the repository's licence               |
| `--copyright <h>`    | none; `rust` requires it | `rust` only: the copyright holder of `REUSE.toml` and `LICENSE`    |

The script only creates a new directory: it refuses one that has files, and it never runs `git`. It adds three files that live once in this repository and are not copied into `template/`: `docs/engineering-standard.md` (pinned in `AGENTS.md` to the version it declares), `docs/standard/typescript.md` (the profile `AGENTS.md` pins) and `scripts/check-licenses.mjs`. The `package-lock.json` it writes is what `npm ci` and the reusable `check.yml` need.

The labels come with the first pull request: `pr-labels.yml` creates every label of `.github/labels.json` that the repository lacks, then adds the one of the title's prefix. `labels.json` is the set the title-to-label workflow, the release notes (`release.yml`) and the issue templates use; `test/template.test.ts` fails when one of them uses a label it does not define. A label that already exists is left as it is, colour and description included. A repository created before this file can copy `.github/labels.json` and `pr-labels.yml` from the template; nothing else changes for it.

`issue-ready.yml` runs gate 1 (`docs/factory.md`, "Gate 1 · Issue ready") on the issues of the new repository; it needs the Micelio bot installed on the repository and `MICELIO_BOT_PRIVATE_KEY` and `MICELIO_BOT_CLIENT_ID` visible to it.

Then, by hand: `git init`, a first commit signed off with `git commit -s`, create the repository on GitHub and push. The section 14 boxes that are organisation settings (below) are done in `bogd3v/.github` (#2); `scorecard` publishes its result to the OpenSSF API, so it runs only in a public repository (in a private one it fails with "Resource not accessible by integration"); every Micelio repository is public. A repository starts the `Release` environment (Settings → Environments → `release`, with required reviewers) when it first publishes.

## The `rust` profile

```bash
npm run template -- ../micelio-example --profile rust --license MIT-0 --copyright "The example authors" --description "One sentence about what it is."
```

It writes the Rust form of the checklist of section 14 of `docs/standard/rust.md`: `Cargo.toml` (with `rust-version`), the committed `Cargo.lock`, `rust-toolchain.toml` (the channel of `fixtures/rust-basic/rust-toolchain.toml`, the one toolchain of the organisation), `src/lib.rs` with one tested and documented function, `deny.toml` (the licence allowlist, which the repository edits to its own policy), `AGENTS.md` (the version pin, `profile: rust` and the `check:` line), `README.md`, `CONTRIBUTING.md`, `.editorconfig`, `REUSE.toml`, `THIRD-PARTY.md`, Dependabot for `cargo` and the workflows `ci.yml` (calls `check.yml` with `profile: rust`, with `standard`, `tools-ref` and `lint-standard-version`, which run the `lint-standard` action, then `dco.yml` and `scorecard.yml`), `pr-labels.yml` and `issue-ready.yml`. `scripts/template-checklist-rust.json` maps each box to its files, and `test/template.test.ts` keeps it true.

- **The licence is the repository's.** The script asks for it (`--license`, `--copyright`, both required) and does not assume Micelio's: it copies the text of `LICENSES/<id>.txt` of this repository or of `template/LICENSES/` (the ids it holds are named in its error), as `LICENSES/<id>.txt` and, with the year and the holder, as `LICENSE`; `REUSE.toml` and `Cargo.toml` carry the id. `deny.toml` lists permissive licences as a starting point and `[licenses.private] ignore = true` so the crate's own licence is not checked against it.
- **One place for each file.** The synced files (`.claude/agents`, the three skills, the pull request template, `CLAUDE.md`), `.claude/TEAM.md`, the issue templates, `labels.json`, `release.yml`, `pr-labels.yml`, `issue-ready.yml` and `.env.example` are read from `template/`, and the core and `docs/standard/rust.md` from `docs/`: `template-rust/` holds none of them, so there is no second copy. `scripts/template.mjs` names them in `RUST_FROM_TEMPLATE`.
- **No npm.** `--package` and `--no-install` are refused with `rust`: there is no package or lockfile (`Cargo.lock` is written already). The `check:` line runs `cargo fmt --check`, `clippy`, `cargo test --locked`, `cargo doc` with warnings denied and `cargo deny check licenses`; CI runs `cargo audit --deny warnings` and the standard and REUSE checks as their own steps of `check.yml`.
- **Not there yet.** The release workflow of section 7: the reusable `release.yml` reads `package.json` and `scripts/release/version.mjs`, so a Rust repository has none to call; `scripts/template-checklist-rust.json` says so under that box.

## What it contains (`typescript`)

Each box of section 14 is ticked by a file or an organisation setting. `scripts/template-checklist.json` lists them, and `test/template.test.ts` fails when the list and section 14 differ, when a file it names is not created, or when a box has neither.

| Box                                                             | Ticked by                                                                                                                                     |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Licence, REUSE, third-party list and the allowlist check        | `LICENSE`, `LICENSES/AGPL-3.0-only.txt`, `REUSE.toml`, `THIRD-PARTY.md`, `scripts/check-licenses.mjs`, the `lint:ee` script of `package.json` |
| README and the short `CONTRIBUTING.md`                          | `README.md`, `CONTRIBUTING.md`; `SECURITY.md` and `CODE_OF_CONDUCT.md` come from `bogd3v/.github` (#2)                                        |
| `AGENTS.md`, `CLAUDE.md`, `.claude/TEAM.md` and the standard    | the files of the same names (`CLAUDE.md` imports `AGENTS.md` and `.claude/TEAM.md`, not the standard)                                         |
| The five factory role prompts (part of the box above)           | `.claude/agents/planner.md`, `master.md`, `worker.md`, `reviewer.md`, `verifier.md`, described in [factory.md](factory.md)                    |
| The `ship-pr` skill (gate 5)                                    | `.claude/skills/ship-pr/SKILL.md`                                                                                                             |
| `.editorconfig`, `.nvmrc`, `.env.example`                       | the files of the same names                                                                                                                   |
| `version`, the configuration packages and the release workflow  | `package.json`, `eslint.config.js`, `tsconfig.json`, `release.yml`, `scripts/release/version.mjs`                                             |
| The scripts `dev` … `check`                                     | `package.json`, and `knip.json` for `lint:unused`                                                                                             |
| CI, DCO, Dependabot and the Scorecard                           | `ci.yml` (calls `check`, `dco` and `scorecard`), `dependabot.yml`                                                                             |
| Pull request and issue templates, title-to-label, release notes | `pull_request_template.md`, `ISSUE_TEMPLATE/`, `pr-labels.yml`, `issue-ready.yml`, `release.yml`, `labels.json`                               |
| `main` protected by rulesets                                    | organisation rulesets (#2), requiring `check / Check` and `dco / Signed-off-by`                                                               |
| The Micelio bot on the repository                               | the GitHub App installed on the organisation (#2), and the repository added to `standard-sync.json`                                           |

The plugin-only boxes of section 14 (the Strapi SDK scaffold, the clean-Strapi suite, the supported core line, TSDoc-generated hooks) are not here: the first plugin repository adds them.

## Keeping it true

- The copy of the standard, the licence check and the `@micelio/*` versions come from this repository when the script runs, so the template never holds a second copy. `@micelio/eslint-config` must be released with the `micelio-lint-standard` and `micelio-lint-ee` commands and the hashes of the standard the template carries; a new repository asks for `^` that version.
- `npm run verify:template -- --profile rust` creates a Rust repository and runs the `check:` line of its `AGENTS.md` and `reuse lint`; it needs `cargo` (with `rustfmt` and `clippy`, and the toolchain of `rust-toolchain.toml`), `cargo-deny` (`cargo install cargo-deny --locked`) and `reuse`.
- `npm run verify:template` creates a repository from the template, installs the three packages from tarballs packed here, and runs that repository's `npm run check`, `npm run build` and `reuse lint` with no edit. It needs the registry, like `verify:isolated`.
- The reusable workflows run only on GitHub. To prove them for a change to the template, create a repository from it, push, open a pull request with a signed commit and check that `check / Check`, `dco / Signed-off-by` and the dry-run `Release` (Actions → Release → Run workflow) pass.
- A change to the standard raises its version (section 16) and the template follows by itself: the script reads the version from the copy.

## Turning it into a GitHub template repository

If a repository created with GitHub's "Use this template" is preferred to running a script, `template/` can be published as its own repository with the placeholders (`{{repo}}`, `{{title}}`, `{{package}}`, `{{description}}`, `{{standard}}`, `{{engineering-ref}}` and the dependency versions) replaced by a first workflow. Until then the script is the one way, because it keeps the standard, the licence check and the pinned workflows at a single source.
