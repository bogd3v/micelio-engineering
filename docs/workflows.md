# Reusable workflows

The workflows in `.github/workflows/` are called from a repository's own workflows with `uses:`. Pin them by commit SHA with the tag in a comment (section 10 of the standard):

```yaml
jobs:
  ci:
    uses: bogd3v/micelio-engineering/.github/workflows/check.yml@<commit SHA> # <tag>
    with:
      test-script: test:coverage
```

| Workflow           | Does                                                                                                                                                                                                                                           | Caller must                                                                                                                                                                           |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `check.yml`        | `npm audit` at critical, `typecheck`, `lint`, `format:check`, tests, `lint:licenses`, `lint:standard`, REUSE and the build, then one `Check` status that passes only when all of them did                                                      | grant `contents: read`                                                                                                                                                                |
| `dco.yml`          | Every commit of the pull request has its author's `Signed-off-by`                                                                                                                                                                              | run on `pull_request`                                                                                                                                                                 |
| `scorecard.yml`    | The OpenSSF Scorecard, uploaded to code scanning                                                                                                                                                                                               | grant `contents: read`, `actions: read`, `security-events: write`, `id-token: write`; run on push to the default branch and on a schedule                                             |
| `release.yml`      | Plans the version, writes the notes, and with `dry-run: false` retags the images, publishes the npm packages with provenance and creates the GitHub release                                                                                    | grant `contents: write`, `packages: write`, `pull-requests: read`, `actions: read`, `id-token: write`; define the `release` environment                                               |
| `issue-ready.yml`  | Gate 1 on an issue: runs `lint-issue`, adds or removes the label `ready`, keeps one comment with the report, sets the project Status to Ready (a fail moves a Ready issue back to Todo) and an empty Release line and Front from the milestone | grant `contents: read` and `issues: read`; run on `issues` (`opened`, `edited`, `milestoned`); pass the secret `MICELIO_BOT_PRIVATE_KEY`; define the variable `MICELIO_BOT_CLIENT_ID` |
| `verify-draft.yml` | Gate 4 of the `normal` lane on a pull request: when the diff fits the lane, runs `verify-draft` on the pull request's description; any other diff skips and passes                                                                             | grant `contents: read` and `pull-requests: read`; run on `pull_request`; no secrets                                                                                                   |

## `check.yml`

`profile` picks the language: `typescript` (the default) or `rust`. A caller that passes none gets the `typescript` run described next, with the same `Check` status; any other value runs the `Checks` job of `rust`, whose first step fails and names the two it accepts, and so the `Check` status fails.

**The jobs and the statuses a caller sees.** Each job is reported as `<caller job> / <job name>` ("Required check names" below). A job whose input turns it off, or that belongs to the other profile, is reported as skipped.

| Job            | Profile      | Runs                                                                                                              | Skipped when                                       |
| -------------- | ------------ | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `Types`        | `typescript` | `typecheck`                                                                                                       | never                                              |
| `Lint`         | `typescript` | `lint`, then `format:check` (`format`)                                                                            | never                                              |
| `Tests`        | `typescript` | the test script (`test-script`)                                                                                   | never                                              |
| `Dependencies` | `typescript` | the package manager's audit at critical (`audit`), `lint:licenses` (`licenses`) and `lint:standard` (`standard`)  | `audit`, `licenses` and `standard` are all `false` |
| `Build`        | `typescript` | `build`                                                                                                           | `build: false`                                     |
| `Checks`       | `rust`       | the toolchain and the tools, `cargo audit` (`audit`), the check command and the copy of the standard (`standard`) | the profile is `typescript`                        |
| `REUSE`        | both         | `reuse lint`                                                                                                      | `reuse: false`                                     |
| `Check`        | both         | passes only when every job above passed or was skipped                                                            | never                                              |

A ruleset requires `<caller job> / Check` only: the other names change with the profile and the inputs. Before #479 the `typescript` checks ran one after another in the job `Checks`, so a caller of an older commit still reports `<caller job> / Checks`; no ruleset of `micelio`, `micelio-cms`, `micelio-plugin-core` or `micelio-plugin-fediverse` requires it.

**`typescript`.** The jobs `Types`, `Lint`, `Tests` and `Dependencies` run side by side, beside `REUSE` and `Build`; each one checks the inputs, checks out the repository and installs its dependencies itself (`npm ci` or `pnpm install --frozen-lockfile`) from the npm cache of `actions/setup-node`, and no job hands `node_modules` to another. `typecheck`, `lint` and the test script always run. Everything else is an input, so a skipped check is written down in the caller: `format`, `licenses`, `standard`, `reuse`, `build` and `audit`. `test-script` names the script (`test:coverage` where there is a coverage floor), `lint:licenses` is each repository's script over `@micelio/eslint-config/licenses.json` (this repository's is `scripts/check-licenses.mjs`), `working-directory` points at a project below the root, and `package-manager` is `npm` or `pnpm`. The Node version comes from `.nvmrc`. Sharding or repository-specific jobs (end to end, contract, performance) stay in the repository's own workflow.

**`rust`.** One job, `Checks`, runs in `working-directory`, because the check command is one command. Its `Install dependencies` installs the toolchain `rust-toolchain.toml` names (the file must be there), then `cargo-deny` 0.21.0 and `reuse` 6.2.0, because section 15 of `docs/standard/rust.md` puts both in the check command. `Audit dependencies` (`audit`, on by default) runs `cargo audit --deny warnings`: any advisory fails it, unmaintained and yanked crates included, and it needs the `Cargo.lock`. `Test` runs the check command: the `check:` line of the first `## Commands` block of `AGENTS.md` (ADR-0001, point 7), or the input `check-command` when it is set; it runs with `bash -e`, so the repository decides what it holds (`cargo fmt --check`, `cargo clippy`, `cargo test`). The jobs `Types`, `Lint`, `Tests`, `Dependencies` and `Build` are skipped. `package-manager`, `node-version-file`, `test-script`, `format`, `licenses` and `build` are for `typescript` and ignored here. `standard: true` runs the `lint-standard` action where the project has no `package.json`, as below. `reuse` is shared by both profiles. The `Check` status is the same single status, and the caller still grants only `contents: read`. `fixtures/rust-basic/` is the minimal library `ci.yml` calls it on (job `check-rust`); the root `check` job is the `typescript` run.

**`standard`, with and without a `package.json`.** With `standard: true`, the step `Copy of the standard` runs the project's `lint:standard` script when `working-directory` holds a `package.json`, as before. The step is in the job `Dependencies` for `typescript` and in `Checks` for `rust`. When it holds none (a repository not on Node, of either profile), the same step checks two inputs and its job runs the `lint-standard` action below instead: `Checkout the lint-standard action` checks out `.github/actions` of this repository at `tools-ref` into `.micelio-engineering` in the workspace, and `Copy of the standard without npm` runs it on `working-directory` with `lint-standard-version`. Both inputs are required there and neither has a default that floats: `tools-ref` is the commit SHA the caller pins `check.yml` at, and `lint-standard-version` the exact version of `@micelio/eslint-config`. A missing one fails the step and names it.

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

Call it from a workflow that runs on `issues: [opened, edited, milestoned]`. It builds `@micelio/factory-tools` from the commit the workflow is pinned at (`job.workflow_sha` of `job.workflow_repository`; until the package is published, #30), runs `lint-issue` on the issue, and with the Micelio bot's token (`docs/standard-sync.md`, limited to the calling repository, Issues write and organisation Projects write):

- adds the label `ready` on a pass and removes it on a fail, creating the label when the repository lacks it;
- keeps one comment, found by the hidden marker `<!-- micelio:issue-ready -->` and by its author, the bot. A fail creates or updates it; a pass only updates one that exists, so the failing lines disappear;
- on a pass, adds the issue to the organisation project (`project-owner`, `project-number`) and sets Status to `ready-status` (default `Ready`) when it has none or is on `not-ready-status` (default `Todo`, the Status an issue starts in). On a fail it never adds the issue; if the issue already is an item on `Ready`, it sets the Status to `not-ready-status` (Todo), and any other value is left alone. The field `Status` and both options are found by name; a missing option fails the job with a message that names the options the project has. An issue In Progress or Done keeps its Status.

- then sets the item's `Release line` and `Front` from the entry of the issue's milestone in `.github/project-fields.json`, read from those tools: one entry per milestone title, with `releaseLine`, `front` and an optional `frontByRepository` (repository name without the owner to Front option), which wins over `front` for that repository. A field that already has a value is never changed, so a choice made by hand in the project wins. A milestone with no entry, an issue with no milestone and an issue that is not in the project change nothing and print one line saying so. Both fields and their options are found by name, like Status; a missing one fails the job before anything is written, with the name it looked for. The milestone title is read through the API and compared as data. The planner adds a milestone's entry before it creates the milestone's issues (`.claude/agents/planner.md`).

It never edits the issue body and never touches another field of the project. The comment is the `lint-issue` report with `@` mentions, images and raw HTML neutralised, and the job log prints it between `::stop-commands::` markers, because the report quotes the issue.

**Who can trigger it.** Anyone can open an issue, and the label and the view start coding agents, so the job only runs for an open issue whose author is an `OWNER`, `MEMBER` or `COLLABORATOR` (checked in the job's `if:` and again by `issue-ready`, which skips with exit 0 otherwise). An outsider's issue gets no label, no project item and no comment. An edit comes from the author or from someone with triage or more. If an organisation member's membership is private, GitHub may report them as `CONTRIBUTOR` or `NONE`: their issues are skipped without a comment (it fails safe); make the membership public or add them as a collaborator.

The title and body are read through the API by `lint-issue` and never reach a shell. `lint-issue` runs with the runner's token, which reads the calling repository and public repositories only: a "Depends on" cannot probe a private one, and a dependency in a private sibling repository cannot be read, so the run fails (exit 2) instead of passing. The job times out after 10 minutes.

**Limit: dependencies.** The workflow runs when the issue itself is opened, edited or given a milestone. Closing an issue does not re-lint the issues that "Depend on" it, and reopening one does not take `ready` off its dependants, so the view can be stale until the dependant is edited (or the master runs `lint-issue`, gate 1). A sweep on `closed` and `reopened` is a follow-up.

**Label: `maintainer-run`.** An issue the maintainer runs by hand (no worker, no pull request by an agent) carries the label `maintainer-run`, added by hand; `issue-ready` creates it when the repository lacks it, as it does `ready`. The job reads the issue's labels through the API on every run, not from the event payload, so adding the label and then editing the issue takes `ready` off. With the label, whatever `lint-issue` says, it never adds `ready` or sets Status to `ready-status`: it removes `ready`, moves an item on `ready-status` back to `not-ready-status` (as on a fail) and never adds the issue to the project. It still creates or updates its one comment, with the report under a first line that says the maintainer runs the issue and intake never takes it. Intake never takes such an issue (`docs/factory.md`, `M.3`).

**Lane.** `lint-issue` reads the `## Lanes` block of the `AGENTS.md` of the issue's own repository on its default branch (`gh api repos/<owner>/<repo>/contents/AGENTS.md`), so the report the workflow posts starts with the issue's lane and the `lane` rule asks for that lane's criterion. A repository with no `AGENTS.md`, or none with a `## Lanes` block, is `full`. The runner's token reads the calling repository, so the workflow needs no change.

**One pin.** The tools come from the commit `uses:` pins, so a Dependabot bump of `uses:` moves them with it. `tools-ref` and `tools-repository` are still accepted (`tools-ref` is optional) and ignored: a `tools-ref` that differs from `job.workflow_sha`, or a `tools-repository` that differs from `job.workflow_repository`, prints a `::warning::` naming both and the job goes on. A caller does not need to pass them. They go when `@micelio/factory-tools` is published (#30), which breaks callers that still pass them.

**One run per issue.** The workflow's `concurrency` groups the runs by repository and issue number with `cancel-in-progress: true`: a new edit of an issue cancels the run of that issue still in progress (or waiting), because only the issue's last state matters. A cancelled run may stop between the label and the project fields; the run that follows reads the issue again and writes the label, the comment and the project fields (the Status, and the Release line and Front when they are empty). Runs of different issues are in different groups, so they never cancel or wait behind each other. Every run still installs and builds the tools: an `issues` run has read-only cache access, so it cannot save a cache.

`issues` events run from the default branch, so a change to this workflow is tried on a test issue only after it is merged.

## The project's auto-close

This is the organisation project's workflow, not one of this repository's.

**Done closes the issue.** The organisation project's own workflow closes an issue whose Status becomes Done, within a second: `bogd3v/micelio-cms#417` (Done 2026-11-11T22:33:59Z, closed 22:34:00Z), `bogd3v/micelio#888` (2026-11-12T03:29:45Z, 03:29:46Z) and `bogd3v/micelio-plugin-fediverse#28` (2026-11-12T14:23:21Z, 14:23:22Z) show it, each closed by `ProjectV2`. The factory therefore sets Done only when the issue is to close (`herdr/master.md`, "The Project Status flow"). The workflow's setting is the maintainer's.

## `verify-draft.yml`

Gate 4 of the `normal` lane (ADR-0003, D7) repeated by CI on a pull request, so a description whose numbers the code does not produce turns a check red. Call it from a workflow that runs on `pull_request`, never on `pull_request_target`:

```yaml
on:
  pull_request:
jobs:
  verify-draft:
    permissions:
      contents: read
      pull-requests: read
    uses: bogd3v/micelio-engineering/.github/workflows/verify-draft.yml@<commit SHA> # <tag>
    with:
      reuse: true # optional, default false
      cargo-deny: true # optional, default false
```

**Permissions.** `contents: read` and `pull-requests: read`; it takes no secrets and uses no token. The tools are built from the commit the workflow is pinned at, and `tools-ref` and `tools-repository` are accepted, ignored and warned about when they differ, as in `issue-ready.yml` ("One pin"); they go when `@micelio/factory-tools` is published (#30).

**What it does.** It checks out the pull request's head (`github.event.pull_request.head.sha`, not its merge with the base branch, which `check.yml` builds and tests) with its history and the tools at the workflow's commit, builds the tools and moves them out of the workspace (the commands `verify-draft` runs, such as `prettier --check .`, read the whole workspace), then runs `lint-lane --diff <the merge base of the head and the pull request's base SHA> --lane normal` (a failing `git merge-base` fails the job) (`packages/factory-tools/README.md`). Then:

- exit 0, the diff fits `normal` (or `express`): it sets up Node from `.nvmrc` as `check.yml` does for `typescript`, runs the `install:` line of the first `## Commands` block of `AGENTS.md` (then `pipx install reuse==6.2.0`, only when the input `reuse` is `true`), downloads `cargo-deny-0.21.0-x86_64-unknown-linux-musl.tar.gz` from the `0.21.0` release of `EmbarkStudios/cargo-deny`, checks it with `sha256sum -c` against the SHA-256 written in the workflow (a mismatch fails the step and installs nothing), puts its `cargo-deny` on the job's `PATH` through `$GITHUB_PATH` and prints `cargo-deny --version`, only when the input `cargo-deny` is `true`, and runs `verify-draft --draft <file> --cwd .` on the pull request's description. The job fails when `verify-draft` exits non-zero, which includes a description whose Tests section names no command it can run (`no command ran`, exit 1). There is no `logs/` directory in CI, so it runs without `--logs`: a command with no log is not a mismatch and the output says `logs: not checked`;
- exit 1, the diff does not fit: it prints `full lane: gate 4 is the verifier` and the job passes;
- exit 2: the job fails.

**When it skips.** The job skips and passes on a diff that raises the lane to `full`, and in a repository whose `AGENTS.md` has no `## Lanes` block, where every path is `full` (ADR-0003, D13). It does not run on other events. It never reads the lane from the issue.

**The description is data.** It reaches `verify-draft` through a file that a step writes from an environment variable; it is never in a shell line or in an expression of a `run:` script. `verify-draft` runs only the repository's own commands (`packages/factory-tools/README.md`, `verify-draft`) and the job never builds or starts a stack. `verify-draft` reads the commands `AGENTS.md` allows at `HEAD`, which in CI is the pull request's head, the commit the worker and the master measured the numbers on, not the merge with the base branch.

**What a runner lacks.** The commands run on `ubuntu-latest` with Node and the repository's `install:` line, nothing else, plus `reuse` when the caller sets the input `reuse` to `true` and `cargo-deny` when it sets the input `cargo-deny` to `true` (both default `false`; this repository's `ci.yml` sets both, because `npm run verify:template` ends with `reuse lint` and `npm run verify:template -- --profile rust` calls `cargo-deny`). `reuse` and `cargo-deny` are the two tools the workflow can add: a draft that reports a command needing any other tool mismatches in CI, so such a draft is verified by the master at gate 4, not by this job. A description with CRLF line endings is read as one with LF.

Making it a required check, and calling it from the other repositories, are maintainer steps.

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

`.github/workflows/ci.yml` runs all five on this repository, with a dry-run release over `fixtures/basic`, and the `lint-standard` action over `fixtures/no-npm`. A new push to a pull request cancels the run of that pull request before it: its top-level `concurrency` groups the runs by the pull request's number and sets `cancel-in-progress: true`. A run of `main`, of the schedule, of an `issues` event or started by hand falls back to its own run id (`github.run_id`), so it is never cancelled and never waits behind another. `publish-packages.yml` is what publishes the packages of this repository: one tag per package.

## Required check names

A called workflow's check is reported as `<caller job> / <job name>` (for example `ci / Check`, `dco / Signed-off-by`), so adopting these changes the names a ruleset requires. The repository updates the ruleset in the same step it switches to the reusable workflow (rulesets: #2).
