# Reusable workflows

The workflows in `.github/workflows/` are called from a repository's own workflows with `uses:`. Pin them by commit SHA with the tag in a comment (section 10 of the standard):

```yaml
jobs:
  ci:
    uses: bogd3v/micelio-engineering/.github/workflows/check.yml@<commit SHA> # <tag>
    with:
      test-script: test:coverage
```

| Workflow          | Does                                                                                                                                                                                                                                           | Caller must                                                                                                                                                                                           |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `check.yml`       | `npm audit` at critical, `typecheck`, `lint`, `format:check`, tests, `lint:licenses`, `lint:standard`, REUSE and the build, then one `Check` status that passes only when all of them did                                                      | grant `contents: read`                                                                                                                                                                                |
| `dco.yml`         | Every commit of the pull request has its author's `Signed-off-by`                                                                                                                                                                              | run on `pull_request`                                                                                                                                                                                 |
| `scorecard.yml`   | The OpenSSF Scorecard, uploaded to code scanning                                                                                                                                                                                               | grant `contents: read`, `actions: read`, `security-events: write`, `id-token: write`; run on push to the default branch and on a schedule                                                             |
| `release.yml`     | Plans the version, writes the notes, and with `dry-run: false` retags the images, publishes the npm packages with provenance and creates the GitHub release                                                                                    | grant `contents: write`, `packages: write`, `pull-requests: read`, `actions: read`, `id-token: write`; define the `release` environment                                                               |
| `issue-ready.yml` | Gate 1 on an issue: runs `lint-issue`, adds or removes the label `ready`, keeps one comment with the report, sets the project Status to Ready (a fail moves a Ready issue back to Todo) and an empty Release line and Front from the milestone | grant `contents: read` and `issues: read`; run on `issues` (`opened`, `edited`, `milestoned`); pass `tools-ref` and the secret `MICELIO_BOT_PRIVATE_KEY`; define the variable `MICELIO_BOT_CLIENT_ID` |

## `check.yml`

`profile` picks the language: `typescript` (the default) or `rust`. A caller that passes none gets the run described next, with the same jobs and the same `Check` status; any other value fails the first step of the `Checks` job, which names the two it accepts, and so the `Check` status.

**`typescript`.** `typecheck`, `lint` and the test script always run. Everything else is an input, so a skipped check is written down in the caller: `format`, `licenses`, `standard`, `reuse`, `build` and `audit`. `test-script` names the script (`test:coverage` where there is a coverage floor), `lint:licenses` is each repository's script over `@micelio/eslint-config/licenses.json` (this repository's is `scripts/check-licenses.mjs`), `working-directory` points at a project below the root, and `package-manager` is `npm` or `pnpm`. The Node version comes from `.nvmrc`. Sharding or repository-specific jobs (end to end, contract, performance) stay in the repository's own workflow.

**`rust`.** The same jobs and steps run, by name, in `working-directory`, with these differences. `Install dependencies` installs the toolchain `rust-toolchain.toml` names (the file must be there). `Audit dependencies` (`audit`, on by default) runs `cargo audit --deny warnings`: any advisory fails it, unmaintained and yanked crates included, and it needs the `Cargo.lock`. `Test` runs the check command: the `check:` line of the first `## Commands` block of `AGENTS.md` (ADR-0001, point 7), or the input `check-command` when it is set; it runs with `bash -e`, so the repository decides what it holds (`cargo fmt --check`, `cargo clippy`, `cargo test`). `Type check`, `Lint`, `Format`, `Licences`, `Setup Node.js` and the `Build` job are skipped. `package-manager`, `node-version-file`, `test-script`, `format`, `licenses` and `build` are for `typescript` and ignored here. `standard: true` runs the `lint-standard` action where the project has no `package.json`, as below. `reuse` is shared by both profiles. The `Check` status is the same single status, and the caller still grants only `contents: read`. `fixtures/rust-basic/` is the minimal library `ci.yml` calls it on (job `check-rust`); the root `check` job is the `typescript` run.

**`standard`, with and without a `package.json`.** With `standard: true`, the step `Copy of the standard` runs the project's `lint:standard` script when `working-directory` holds a `package.json`, as before. When it holds none (a repository not on Node, of either profile), the same step checks two inputs and the job runs the `lint-standard` action below instead: `Checkout the lint-standard action` checks out `.github/actions` of this repository at `tools-ref` into `.micelio-engineering` in the workspace, and `Copy of the standard without npm` runs it on `working-directory` with `lint-standard-version`. Both inputs are required there and neither has a default that floats: `tools-ref` is the commit SHA the caller pins `check.yml` at, and `lint-standard-version` the exact version of `@micelio/eslint-config`. A missing one fails the step and names it.

```yaml
jobs:
  ci:
    uses: bogd3v/micelio-engineering/.github/workflows/check.yml@<commit SHA> # <tag>
    with:
      profile: rust
      standard: true
      tools-ref: <the same commit SHA>
      lint-standard-version: <version of @micelio/eslint-config, as 0.2.7>
```

## The `lint-standard` action

`.github/actions/lint-standard/action.yml` runs `lint:standard` in a repository without npm (ADR-0001, point 5). The check keeps one implementation: the action sets up Node 22 and runs the published `micelio-lint-standard` of `@micelio/eslint-config` with `npx`, from the runner's temporary directory, against the repository's copy. It installs nothing into the repository and writes no file there. When the tool exits 1 the action fails, and it prints the tool's one line either way. Call it after the checkout, pinned by commit SHA:

```yaml
steps:
  - uses: actions/checkout@<commit SHA> # <tag>
    with:
      persist-credentials: false
  - uses: bogd3v/micelio-engineering/.github/actions/lint-standard@<commit SHA> # <tag>
    with:
      version: 0.2.7
```

| Input       | Required | Default | Is                                                                                                                                                 |
| ----------- | -------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `version`   | yes      | none    | The exact version of `@micelio/eslint-config` whose tool runs (`0.2.7`); a range, a tag such as `latest` or an empty value fails before `npx` runs |
| `directory` | no       | `.`     | The directory that holds `AGENTS.md` and the copy, relative to the workspace or absolute                                                           |

Its output `message` is the tool's line. To run the same check locally, a repository without npm documents this one line in its `AGENTS.md` (with the version its CI pins) and runs it from its root:

```bash
npx --yes --package @micelio/eslint-config@<version> micelio-lint-standard
```

Run inside an npm project that installs `@micelio/eslint-config`, `npx` takes the package from that project instead of the pinned one. Where that copy has no `micelio-lint-standard` linked, as in this repository after a fresh `npm ci` (the workspace package is not built when it is installed), the command fails with exit 127 and `sh: 1: micelio-lint-standard: not found`. The action therefore runs `npx` from `$RUNNER_TEMP` and passes the directory to the tool as its argument, never from the caller's directory. `fixtures/no-npm/` is a repository without npm that pins 1.8: `ci.yml` runs the action on it (job `lint-standard`), and on a copy with one character of its standard changed (job `lint-standard-mismatch`, green only when the action's outcome is `failure` and its line says `does not match`).

## `issue-ready.yml`

Call it from a workflow that runs on `issues: [opened, edited, milestoned]`. It builds `@micelio/factory-tools` from `tools-repository` at `tools-ref` (a commit SHA; until the package is published, #30), runs `lint-issue` on the issue, and with the Micelio bot's token (`docs/standard-sync.md`, limited to the calling repository, Issues write and organisation Projects write):

- adds the label `ready` on a pass and removes it on a fail, creating the label when the repository lacks it;
- keeps one comment, found by the hidden marker `<!-- micelio:issue-ready -->` and by its author, the bot. A fail creates or updates it; a pass only updates one that exists, so the failing lines disappear;
- on a pass, adds the issue to the organisation project (`project-owner`, `project-number`) and sets Status to `ready-status` (default `Ready`) when it has none or is on `not-ready-status` (default `Todo`, the Status an issue starts in). On a fail it never adds the issue; if the issue already is an item on `Ready`, it sets the Status to `not-ready-status` (Todo), and any other value is left alone. The field `Status` and both options are found by name; a missing option fails the job with a message that names the options the project has. An issue In Progress or Done keeps its Status.

- then sets the item's `Release line` and `Front` from the entry of the issue's milestone in `.github/project-fields.json`, read from the tools at `tools-ref`: one entry per milestone title, with `releaseLine`, `front` and an optional `frontByRepository` (repository name without the owner to Front option), which wins over `front` for that repository. A field that already has a value is never changed, so a choice made by hand in the project wins. A milestone with no entry, an issue with no milestone and an issue that is not in the project change nothing and print one line saying so. Both fields and their options are found by name, like Status; a missing one fails the job before anything is written, with the name it looked for. The milestone title is read through the API and compared as data. The planner adds a milestone's entry before it creates the milestone's issues (`.claude/agents/planner.md`).

It never edits the issue body and never touches another field of the project. The comment is the `lint-issue` report with `@` mentions, images and raw HTML neutralised, and the job log prints it between `::stop-commands::` markers, because the report quotes the issue.

**Who can trigger it.** Anyone can open an issue, and the label and the view start coding agents, so the job only runs for an open issue whose author is an `OWNER`, `MEMBER` or `COLLABORATOR` (checked in the job's `if:` and again by `issue-ready`, which skips with exit 0 otherwise). An outsider's issue gets no label, no project item and no comment. An edit comes from the author or from someone with triage or more. If an organisation member's membership is private, GitHub may report them as `CONTRIBUTOR` or `NONE`: their issues are skipped without a comment (it fails safe); make the membership public or add them as a collaborator.

The title and body are read through the API by `lint-issue` and never reach a shell. `lint-issue` runs with the runner's token, which reads the calling repository and public repositories only: a "Depends on" cannot probe a private one, and a dependency in a private sibling repository cannot be read, so the run fails (exit 2) instead of passing. The job times out after 10 minutes.

**Limit: dependencies.** The workflow runs when the issue itself is opened, edited or given a milestone. Closing an issue does not re-lint the issues that "Depend on" it, and reopening one does not take `ready` off its dependants, so the view can be stale until the dependant is edited (or the master runs `lint-issue`, gate 1). A sweep on `closed` and `reopened` is a follow-up.

**Lane.** `lint-issue` reads the `## Lanes` block of the `AGENTS.md` of the issue's own repository on its default branch (`gh api repos/<owner>/<repo>/contents/AGENTS.md`), so the report the workflow posts starts with the issue's lane and the `lane` rule asks for that lane's criterion. A repository with no `AGENTS.md`, or none with a `## Lanes` block, is `full`. The runner's token reads the calling repository, so the workflow needs no change.

`tools-ref` and `tools-repository` are the interface while the tools are built from source; when `@micelio/factory-tools` is published (#30) they go, which breaks callers of this workflow.

`issues` events run from the default branch, so a change to this workflow is tried on a test issue only after it is merged.

## `project-fields-backfill.yml`

This repository's own workflow, run by hand (`workflow_dispatch`) with a milestone title. It sets `Release line` and `Front` on every open issue of that milestone in the repositories its `REPOSITORIES` names, from the same `.github/project-fields.json` and with the same rules as `issue-ready.yml`: a field with a value is kept, an issue not in the project is left alone, and every field, option and issue is read before the first write, so a missing option changes nothing. A milestone with no entry prints one line and changes nothing. It prints one line per issue and field. The Micelio bot's token is limited to those repositories, Issues read and the organisation's Projects write. Run it for a milestone whose issues were created before its entry existed:

```bash
gh workflow run project-fields-backfill.yml --repo bogd3v/micelio-engineering -f milestone="Micelio · Garantías medibles"
```

## `release.yml`

The repository keeps what is its own: a script that prints the plan as JSON (`tag`, `version`, `previous`, `bump`, `prerelease`, `breaking`; `--rc` for a candidate) and any check that is not generic. `compatibility` is required to publish, because every release states the other repository's line and the minimum Node and PostgreSQL (section 7); `breaking-changes` and `upgrade-notes` are required when the plan reports a breaking pull request, and come first in the notes. Images are retagged from the commit's short SHA, so their digest and build provenance are kept. npm packages are the one at the root, with `npm-root: true` (a repository that is one package, such as a Strapi plugin), and the workspaces listed in `npm-workspaces`; either needs the `NPM_TOKEN` secret, and the plan lists what would be published, a dry run included, with or without the token. A candidate (`vX.Y.Z-rc.N`) never moves `X.Y` or `latest`, and npm candidates publish under `next`.

**Where `NPM_TOKEN` lives.** Keep it as a secret of the caller's `release` environment (`environment`), not as a repository secret (section 10: least privilege for credentials). Only the `publish` job runs in that environment, after the approval, so only it can read the token; it fails before anything is published if the token is not set. The `plan` job has no environment and never reads it, so a dry run and the plan work without it. A caller that still has a repository secret keeps working, but every workflow of the repository can read it. To move it:

1. Settings, Environments, `release` (the `environment` input, if the caller changed it): add the secret `NPM_TOKEN` with the same value, or a new token if the old one may have been exposed.
2. Run a release and check that it reaches the approval and publishes after it.
3. Settings, Secrets and variables, Actions: delete the repository secret `NPM_TOKEN`.

`standard-sync.yml` is this repository's own, not a reusable one: it opens the pull requests that keep the copies of the standard in step, together with the factory's agent prompts, skills, pull request template and `CLAUDE.md` (`docs/standard-sync.md`). `dco.yml` skips the commits of the Micelio bot, like Dependabot's.

`.github/workflows/ci.yml` runs all five on this repository, with a dry-run release over `fixtures/basic`, and the `lint-standard` action over `fixtures/no-npm`. `publish-packages.yml` is what publishes the packages of this repository: one tag per package.

## Required check names

A called workflow's check is reported as `<caller job> / <job name>` (for example `ci / Check`, `dco / Signed-off-by`), so adopting these changes the names a ruleset requires. The repository updates the ruleset in the same step it switches to the reusable workflow (rulesets: #2).
