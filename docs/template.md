# Repository template

`template/` is section 14 of the [engineering standard](engineering-standard.md) as files: a repository created from it starts with everything a file can give it, so nobody walks the checklist by hand. `npm run template` copies it.

## Create a repository

From an up-to-date checkout of `main` (the workflows are pinned to its commit, which has to be on GitHub):

```bash
npm ci
npm run template -- ../micelio-example --description "One sentence about what it is."
```

| Option               | Default                 | Used for                                                           |
| -------------------- | ----------------------- | ------------------------------------------------------------------ |
| `--name <repo>`      | the directory name      | lowercase letters, digits and hyphens; the repository and the URLs |
| `--title <text>`     | the name, capitalised   | headings of the README, `LICENSE` and `REUSE.toml`                 |
| `--package <npm>`    | the name                | `name` in `package.json`                                           |
| `--description <t>`  | `A Micelio repository.` | README, `AGENTS.md` and `package.json`                             |
| `--ref <commit SHA>` | `HEAD` of this checkout | the commit the reusable workflows are called at                    |
| `--no-install`       | installs                | skips writing `package-lock.json` (needs the registry)             |

The script only creates a new directory: it refuses one that has files, and it never runs `git`. It adds two files that live once in this repository and are not copied into `template/`: `docs/engineering-standard.md` (pinned in `AGENTS.md` to the version it declares) and `scripts/check-licenses.mjs`. The `package-lock.json` it writes is what `npm ci` and the reusable `check.yml` need.

Then, by hand: `git init`, a first commit signed off with `git commit -s`, create the repository on GitHub and push. The section 14 boxes that are organisation settings (below) are done in `bogd3v/.github` (#2); a repository starts the `Release` environment (Settings → Environments → `release`, with required reviewers) when it first publishes.

## What it contains

Each box of section 14 is ticked by a file or an organisation setting. `scripts/template-checklist.json` lists them, and `test/template.test.ts` fails when the list and section 14 differ, when a file it names is not created, or when a box has neither.

| Box                                                             | Ticked by                                                                                              |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Licence, REUSE, third-party list and the allowlist check        | `LICENSE`, `LICENSES/AGPL-3.0-only.txt`, `REUSE.toml`, `THIRD-PARTY.md`, `scripts/check-licenses.mjs`  |
| README and the short `CONTRIBUTING.md`                          | `README.md`, `CONTRIBUTING.md`; `SECURITY.md` and `CODE_OF_CONDUCT.md` come from `bogd3v/.github` (#2) |
| `AGENTS.md`, `CLAUDE.md`, `.claude/TEAM.md` and the standard    | the files of the same names                                                                            |
| `.editorconfig`, `.nvmrc`, `.env.example`                       | the files of the same names                                                                            |
| `version`, the configuration packages and the release workflow  | `package.json`, `eslint.config.js`, `tsconfig.json`, `release.yml`, `scripts/release/version.mjs`      |
| The scripts `dev` … `check`                                     | `package.json`                                                                                         |
| CI, DCO, Dependabot and the Scorecard                           | `ci.yml` (calls `check`, `dco` and `scorecard`), `dependabot.yml`                                      |
| Pull request and issue templates, title-to-label, release notes | `pull_request_template.md`, `ISSUE_TEMPLATE/`, `pr-labels.yml`, `release.yml`                          |
| `main` protected by rulesets                                    | organisation rulesets (#2), requiring `check / Check` and `dco / Signed-off-by`                        |
| The Micelio bot on the repository                               | the GitHub App installed on the organisation (#2), and the repository added to `standard-sync.json`    |

The plugin-only boxes of section 14 (the Strapi SDK scaffold, the clean-Strapi suite, the supported core line, TSDoc-generated hooks) are not here: the first plugin repository adds them.

## Keeping it true

- The copy of the standard, the licence check and the `@micelio/*` versions come from this repository when the script runs, so the template never holds a second copy. `@micelio/eslint-config` must be released with the `micelio-lint-standard` command and the hashes of the standard the template carries; a new repository asks for `^` that version.
- `npm run verify:template` creates a repository from the template, installs the three packages from tarballs packed here, and runs that repository's `npm run check`, `npm run build` and `reuse lint` with no edit. It needs the registry, like `verify:isolated`.
- The reusable workflows run only on GitHub. To prove them for a change to the template, create a repository from it, push, open a pull request with a signed commit and check that `check / Check`, `dco / Signed-off-by` and the dry-run `Release` (Actions → Release → Run workflow) pass.
- A change to the standard raises its version (section 16) and the template follows by itself: the script reads the version from the copy.

## Turning it into a GitHub template repository

If a repository created with GitHub's "Use this template" is preferred to running a script, `template/` can be published as its own repository with the placeholders (`{{repo}}`, `{{title}}`, `{{package}}`, `{{description}}`, `{{standard}}`, `{{engineering-ref}}` and the dependency versions) replaced by a first workflow. Until then the script is the one way, because it keeps the standard, the licence check and the pinned workflows at a single source.
