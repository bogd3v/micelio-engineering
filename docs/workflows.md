# Reusable workflows

The four workflows in `.github/workflows/` are called from a repository's own workflows with `uses:`. Pin them by commit SHA with the tag in a comment (section 10 of the standard):

```yaml
jobs:
  ci:
    uses: bogd3v/micelio-engineering/.github/workflows/check.yml@<commit SHA> # <tag>
    with:
      test-script: test:coverage
```

| Workflow        | Does                                                                                                                                                                                      | Caller must                                                                                                                               |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `check.yml`     | `npm audit` at critical, `typecheck`, `lint`, `format:check`, tests, `lint:licenses`, `lint:standard`, REUSE and the build, then one `Check` status that passes only when all of them did | grant `contents: read`                                                                                                                    |
| `dco.yml`       | Every commit of the pull request has its author's `Signed-off-by`                                                                                                                         | run on `pull_request`                                                                                                                     |
| `scorecard.yml` | The OpenSSF Scorecard, uploaded to code scanning                                                                                                                                          | grant `contents: read`, `actions: read`, `security-events: write`, `id-token: write`; run on push to the default branch and on a schedule |
| `release.yml`   | Plans the version, writes the notes, and with `dry-run: false` retags the images, publishes the npm packages with provenance and creates the GitHub release                               | grant `contents: write`, `packages: write`, `pull-requests: read`, `actions: read`, `id-token: write`; define the `release` environment   |

## `check.yml`

`typecheck`, `lint` and the test script always run. Everything else is an input, so a skipped check is written down in the caller: `format`, `licenses`, `standard`, `reuse`, `build` and `audit`. `test-script` names the script (`test:coverage` where there is a coverage floor), `lint:licenses` is each repository's script over `@micelio/eslint-config/licenses.json` (this repository's is `scripts/check-licenses.mjs`), `working-directory` points at a project below the root, and `package-manager` is `npm` or `pnpm`. The Node version comes from `.nvmrc`. Sharding or repository-specific jobs (end to end, contract, performance) stay in the repository's own workflow.

## `release.yml`

The repository keeps what is its own: a script that prints the plan as JSON (`tag`, `version`, `previous`, `bump`, `prerelease`, `breaking`; `--rc` for a candidate) and any check that is not generic. `compatibility` is required to publish, because every release states the other repository's line and the minimum Node and PostgreSQL (section 7); `breaking-changes` and `upgrade-notes` are required when the plan reports a breaking pull request, and come first in the notes. Images are retagged from the commit's short SHA, so their digest and build provenance are kept. npm packages are the one at the root, with `npm-root: true` (a repository that is one package, such as a Strapi plugin), and the workspaces listed in `npm-workspaces`; either needs the `NPM_TOKEN` secret, and the plan lists what would be published, a dry run included. A candidate (`vX.Y.Z-rc.N`) never moves `X.Y` or `latest`, and npm candidates publish under `next`.

`standard-sync.yml` is this repository's own, not a reusable one: it opens the pull requests that keep the copies of the standard in step (`docs/standard-sync.md`). `dco.yml` skips the commits of the Micelio bot, like Dependabot's.

`.github/workflows/ci.yml` runs all four on this repository, with a dry-run release over `fixtures/basic`. `publish-packages.yml` is what publishes the packages of this repository: one tag per package.

## Required check names

A called workflow's check is reported as `<caller job> / <job name>` (for example `ci / Check`, `dco / Signed-off-by`), so adopting these changes the names a ruleset requires. The repository updates the ruleset in the same step it switches to the reusable workflow (rulesets: #2).
