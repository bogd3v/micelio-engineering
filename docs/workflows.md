# Reusable workflows

The workflows in `.github/workflows/` are called from a repository's own workflows with `uses:`. Pin them by commit SHA with the tag in a comment (section 10 of the standard):

```yaml
jobs:
  ci:
    uses: bogd3v/micelio-engineering/.github/workflows/check.yml@<commit SHA> # <tag>
    with:
      test-script: test:coverage
```

| Workflow          | Does                                                                                                                                                                                       | Caller must                                                                                                                                                                                           |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `check.yml`       | `npm audit` at critical, `typecheck`, `lint`, `format:check`, tests, `lint:licenses`, `lint:standard`, REUSE and the build, then one `Check` status that passes only when all of them did  | grant `contents: read`                                                                                                                                                                                |
| `dco.yml`         | Every commit of the pull request has its author's `Signed-off-by`                                                                                                                          | run on `pull_request`                                                                                                                                                                                 |
| `scorecard.yml`   | The OpenSSF Scorecard, uploaded to code scanning                                                                                                                                           | grant `contents: read`, `actions: read`, `security-events: write`, `id-token: write`; run on push to the default branch and on a schedule                                                             |
| `release.yml`     | Plans the version, writes the notes, and with `dry-run: false` retags the images, publishes the npm packages with provenance and creates the GitHub release                                | grant `contents: write`, `packages: write`, `pull-requests: read`, `actions: read`, `id-token: write`; define the `release` environment                                                               |
| `issue-ready.yml` | Gate 1 on an issue: runs `lint-issue`, adds or removes the label `ready`, keeps one comment with the report and sets the project Status to Ready (a fail moves a Ready issue back to Todo) | grant `contents: read` and `issues: read`; run on `issues` (`opened`, `edited`, `milestoned`); pass `tools-ref` and the secret `MICELIO_BOT_PRIVATE_KEY`; define the variable `MICELIO_BOT_CLIENT_ID` |

## `check.yml`

`typecheck`, `lint` and the test script always run. Everything else is an input, so a skipped check is written down in the caller: `format`, `licenses`, `standard`, `reuse`, `build` and `audit`. `test-script` names the script (`test:coverage` where there is a coverage floor), `lint:licenses` is each repository's script over `@micelio/eslint-config/licenses.json` (this repository's is `scripts/check-licenses.mjs`), `working-directory` points at a project below the root, and `package-manager` is `npm` or `pnpm`. The Node version comes from `.nvmrc`. Sharding or repository-specific jobs (end to end, contract, performance) stay in the repository's own workflow.

## `issue-ready.yml`

Call it from a workflow that runs on `issues: [opened, edited, milestoned]`. It builds `@micelio/factory-tools` from `tools-repository` at `tools-ref` (a commit SHA; until the package is published, #30), runs `lint-issue` on the issue, and with the Micelio bot's token (`docs/standard-sync.md`, limited to the calling repository, Issues write and organisation Projects write):

- adds the label `ready` on a pass and removes it on a fail, creating the label when the repository lacks it;
- keeps one comment, found by the hidden marker `<!-- micelio:issue-ready -->` and by its author, the bot. A fail creates or updates it; a pass only updates one that exists, so the failing lines disappear;
- on a pass, adds the issue to the organisation project (`project-owner`, `project-number`) and sets Status to `ready-status` (default `Ready`) when it has none or is on `not-ready-status` (default `Todo`, the Status an issue starts in). On a fail it never adds the issue; if the issue already is an item on `Ready`, it sets the Status to `not-ready-status` (Todo), and any other value is left alone. The field `Status` and both options are found by name; a missing option fails the job with a message that names the options the project has. An issue In Progress or Done keeps its Status.

It never edits the issue body and never touches another field of the project. The comment is the `lint-issue` report with `@` mentions, images and raw HTML neutralised, and the job log prints it between `::stop-commands::` markers, because the report quotes the issue.

**Who can trigger it.** Anyone can open an issue, and the label and the view start coding agents, so the job only runs for an open issue whose author is an `OWNER`, `MEMBER` or `COLLABORATOR` (checked in the job's `if:` and again by `issue-ready`, which skips with exit 0 otherwise). An outsider's issue gets no label, no project item and no comment. An edit comes from the author or from someone with triage or more. If an organisation member's membership is private, GitHub may report them as `CONTRIBUTOR` or `NONE`: their issues are skipped without a comment (it fails safe); make the membership public or add them as a collaborator.

The title and body are read through the API by `lint-issue` and never reach a shell. `lint-issue` runs with the runner's token, which reads the calling repository and public repositories only: a "Depends on" cannot probe a private one, and a dependency in a private sibling repository cannot be read, so the run fails (exit 2) instead of passing. The job times out after 10 minutes.

**Limit: dependencies.** The workflow runs when the issue itself is opened, edited or given a milestone. Closing an issue does not re-lint the issues that "Depend on" it, and reopening one does not take `ready` off its dependants, so the view can be stale until the dependant is edited (or the master runs `lint-issue`, gate 1). A sweep on `closed` and `reopened` is a follow-up.

`tools-ref` and `tools-repository` are the interface while the tools are built from source; when `@micelio/factory-tools` is published (#30) they go, which breaks callers of this workflow.

`issues` events run from the default branch, so a change to this workflow is tried on a test issue only after it is merged.

## `release.yml`

The repository keeps what is its own: a script that prints the plan as JSON (`tag`, `version`, `previous`, `bump`, `prerelease`, `breaking`; `--rc` for a candidate) and any check that is not generic. `compatibility` is required to publish, because every release states the other repository's line and the minimum Node and PostgreSQL (section 7); `breaking-changes` and `upgrade-notes` are required when the plan reports a breaking pull request, and come first in the notes. Images are retagged from the commit's short SHA, so their digest and build provenance are kept. npm packages are the one at the root, with `npm-root: true` (a repository that is one package, such as a Strapi plugin), and the workspaces listed in `npm-workspaces`; either needs the `NPM_TOKEN` secret, and the plan lists what would be published, a dry run included, with or without the token. A candidate (`vX.Y.Z-rc.N`) never moves `X.Y` or `latest`, and npm candidates publish under `next`.

**Where `NPM_TOKEN` lives.** Keep it as a secret of the caller's `release` environment (`environment`), not as a repository secret (section 10: least privilege for credentials). Only the `publish` job runs in that environment, after the approval, so only it can read the token; it fails before anything is published if the token is not set. The `plan` job has no environment and never reads it, so a dry run and the plan work without it. A caller that still has a repository secret keeps working, but every workflow of the repository can read it. To move it:

1. Settings, Environments, `release` (the `environment` input, if the caller changed it): add the secret `NPM_TOKEN` with the same value, or a new token if the old one may have been exposed.
2. Run a release and check that it reaches the approval and publishes after it.
3. Settings, Secrets and variables, Actions: delete the repository secret `NPM_TOKEN`.

`standard-sync.yml` is this repository's own, not a reusable one: it opens the pull requests that keep the copies of the standard in step, together with the factory's agent prompts, skills and pull request template (`docs/standard-sync.md`). `dco.yml` skips the commits of the Micelio bot, like Dependabot's.

`.github/workflows/ci.yml` runs all five on this repository, with a dry-run release over `fixtures/basic`. `publish-packages.yml` is what publishes the packages of this repository: one tag per package.

## Required check names

A called workflow's check is reported as `<caller job> / <job name>` (for example `ci / Check`, `dco / Signed-off-by`), so adopting these changes the names a ruleset requires. The repository updates the ruleset in the same step it switches to the reusable workflow (rulesets: #2).
