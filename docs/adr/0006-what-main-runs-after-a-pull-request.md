# ADR-0006: Reuse a pull request's result on main only where a push publishes nothing

**Status:** Proposed
**Date:** 2026-11-27
**Deciders:** The maintainer (not yet decided)

## Context

Most checks run twice: on the pull request and again on the push to `main` that merges it. The epic bogd3v/micelio-engineering#477 asks whether that second run is needed, and this record is its issue #481. Whether `main` may trust the run of the pull request changes a guarantee, so it is a record and not a workflow edit (standard, section 12). The record proposes; it changes no workflow and no ruleset.

Whatever is chosen, **a deploy never publishes an image whose checks did not pass on the commit it is built from.**

Everything below was read with `gh` on 2026-11-27. Times are UTC. A "wall" time is from the start of a run to its last update, queue included; "job time" is the sum of the durations of its jobs.

### What runs where

"PR" is a pull request into `main`; "push" is a push to `main`. "Required" is what the ruleset "Protect main" asks for. Workflows that run only on a schedule, on issues, on a tag or by hand are left out.

#### micelio at `979788d` (ruleset 25690303)

| Job (workflow)                                                                       | PR  | push | Required                      |
| ------------------------------------------------------------------------------------ | --- | ---- | ----------------------------- |
| `check / Checks`, `check / REUSE`, `check / Check` (`deploy.yml`)                    | yes | yes  | `check / Check`               |
| `Integration Tests`                                                                  | yes | yes  | yes                           |
| `E2E … (Playwright)`, seven groups, and their verdict `E2E Tests (Playwright)`       | yes | yes  | the verdict                   |
| `E2E Static Site (Playwright)`, `E2E Landing (Playwright)`                           | yes | yes  | yes                           |
| `Performance Budgets`, three runs                                                    | yes | yes  | no                            |
| `Playwright Image`                                                                   | yes | yes  | no                            |
| `Docker images (pull request)`                                                       | yes | no   | no                            |
| `Build & Push Docker Image`, `Build Builder Image` (two), `Publish Builder Manifest` | no  | yes  | no                            |
| `Deploy to Dokploy`                                                                  | no  | yes  | no                            |
| `Contract Tests` (`contract.yml`)                                                    | yes | yes  | yes                           |
| `analyze` (`codeql.yml`)                                                             | yes | yes  | yes, and a code scanning rule |
| `dco / Signed-off-by` (`dco.yml`)                                                    | yes | no   | yes                           |
| PR labels, Add to project                                                            | yes | no   | no                            |
| Theme Admission Fixtures (by path), Theme Compatibility (by the `contract` label)    | yes | no   | no                            |
| Scorecard                                                                            | no  | yes  | no                            |

#### micelio-cms at `a966bd4` (ruleset 24403857)

| Job (workflow)                                                                           | PR      | push                                          | Required                      |
| ---------------------------------------------------------------------------------------- | ------- | --------------------------------------------- | ----------------------------- |
| `check / Checks`, `check / REUSE`, `check / Build`, `check / Check` (`ci.yml`)           | yes     | called by `deploy.yml`, unless only documents | `check / Check`               |
| `build-image`, `build-and-push`, `deploy` (`deploy.yml`)                                 | no      | yes, unless only documents                    | no                            |
| `Frontend refs`, `Contract Tests (latest)`, `Contract Tests (previous)` (`contract.yml`) | yes     | yes                                           | no                            |
| Demo stacks (`demo-stacks.yml`)                                                          | by path | no                                            | no                            |
| `analyze` (`codeql.yml`)                                                                 | yes     | yes                                           | yes, and a code scanning rule |
| `dco / Signed-off-by` (`dco.yml`)                                                        | yes     | no                                            | yes                           |
| PR labels, Add to project                                                                | yes     | no                                            | no                            |
| Scorecard                                                                                | no      | yes                                           | no                            |

`deploy.yml` also runs on a push to `develop` (staging), a branch that is not protected.

#### micelio-plugin-core at `27291f5` (ruleset 25735608)

| Job (workflow `ci.yml` unless said)                                 | PR  | push | Required        |
| ------------------------------------------------------------------- | --- | ---- | --------------- |
| `check / Checks`, `check / REUSE`, `check / Build`, `check / Check` | yes | yes  | `check / Check` |
| `Playwright Image`, `Admin pages`, `Compose stack`                  | yes | yes  | no              |
| `dco / Signed-off-by`                                               | yes | no   | yes             |
| PR labels (`pr-labels.yml`)                                         | yes | no   | no              |
| `scorecard / Scorecard analysis`                                    | no  | yes  | no              |

#### micelio-plugin-fediverse at `e3f4863` (ruleset 26904957)

| Job (workflow `ci.yml` unless said)                                 | PR  | push | Required        |
| ------------------------------------------------------------------- | --- | ---- | --------------- |
| `check / Checks`, `check / REUSE`, `check / Build`, `check / Check` | yes | yes  | `check / Check` |
| `PostgreSQL suites`                                                 | yes | yes  | no              |
| `dco / Signed-off-by`                                               | yes | no   | yes             |
| PR labels (`pr-labels.yml`)                                         | yes | no   | no              |
| `scorecard / Scorecard analysis`                                    | no  | yes  | no              |

#### micelio-engineering at `73d0c1c` (ruleset 25690307)

| Job (workflow `ci.yml`)                                             | PR                       | push | Required        |
| ------------------------------------------------------------------- | ------------------------ | ---- | --------------- |
| `check / Checks`, `check / REUSE`, `check / Build`, `check / Check` | yes                      | yes  | `check / Check` |
| `check-rust / …`, `lint-standard`, `lint-standard-mismatch`         | yes                      | yes  | no              |
| `release / Plan` (a dry run)                                        | from the same repository | yes  | no              |
| `dco / Signed-off-by`                                               | yes                      | no   | yes             |
| `verify-draft`                                                      | yes                      | no   | no              |
| `scorecard / Scorecard analysis`                                    | no                       | yes  | no              |

#### What the rulesets share

All five rulesets are active, require a pull request, allow `merge` and `squash`, and set `strict_required_status_checks_policy` to `false`: **no repository requires the branch to be up to date**, and none has a merge queue. Only `micelio` has a bypass actor (`OrganizationAdmin`, `always`).

### What depends on the run of `main` today

- `micelio`: `Deploy to Dokploy` needs `check`, the integration, E2E and performance jobs and the image builds, all of the same run. It does not need `Contract Tests` or `analyze`, which are other workflows. `Build & Push Docker Image` pushes the image under the commit's short SHA without waiting for the tests; only the `edge` tag waits. `release.yml` refuses a commit on which `deploy.yml` has no successful push run.
- `micelio-cms`: `build-and-push` needs `ci` and `build-image`, so a red `check / Check` publishes nothing. It does not wait for `Contract Tests`. `release.yml` refuses a commit whose `build-and-push` did not succeed.
- The plugins and `micelio-engineering` publish nothing on a push to `main`. Their packages are published by hand or by a tag; the `release.yml` they use reads no check of the commit.
- A run of `main` is also what saves the caches that pull requests restore: a pull request's own cache cannot be restored by another branch ([GitHub, dependency caching](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching)).
- A `pull_request` run checks out the merge of the head into the base as it was when the run started, not the head alone ([GitHub, events](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows)). So `main` ran a tree no check had seen only when the base moved between that start and the merge.

### What the second run costs

The latest merge of each repository on 2026-11-27:

| Repository                 | Pull request run (wall)     | Run of `main` (wall)       | Job time of that run of `main` that repeats the pull request |
| -------------------------- | --------------------------- | -------------------------- | ------------------------------------------------------------ |
| `micelio`                  | 46064085981, 380 s (11-27)  | 46064890038, 450 s (11-27) | 3399 s of 3997 s                                             |
| `micelio-cms`              | 45927192595, 421 s (11-27)  | 45928177546, 464 s (11-27) | 506 s of 735 s                                               |
| `micelio-plugin-core`      | 46033994629, 589 s (11-27)  | 46035540813, 826 s (11-27) | 1558 s of 1595 s                                             |
| `micelio-plugin-fediverse` | 45163994236, 1457 s (11-23) | 45476733918, 305 s (11-24) | 592 s of 624 s                                               |
| `micelio-engineering`      | 46064219784, 397 s (11-27)  | 46065040455, 408 s (11-27) | 488 s of 523 s                                               |

The times are one run each, not an average. `Contract Tests` and `analyze` repeat too and are not in the job time: 122 s and 81 s in `micelio` (46064889531, 46064889512, 11-27), 476 s and 68 s in `micelio-cms` (45928177203, 45928177321, 11-27). In 45928177546, `build-and-push` waited for a `check / Checks` of 366 s while `build-image` had taken 142 s.

### The runs of `main` that failed

The last 50 push runs of `main` of each repository (`micelio-plugin-fediverse` has 26 in all), 226 runs: 13 failed, none was cancelled and none had been rerun. The windows are 2026-11-25 to 11-27 (`micelio`, `micelio-engineering`), 11-23 to 11-27 (`micelio-cms`), 11-12 to 11-27 (`micelio-plugin-core`) and 11-05 to 11-24 (`micelio-plugin-fediverse`). Runs of one merge count one each, so `micelio` and `micelio-cms` cover 13 merges each. `micelio` had no failure.

**Failed after a pull request whose runs were all green (6):**

| Run of `main` (date), repository                | Its pull request run      | Same tree?                                   | Cause                                                                                                                                                                                                                                                                                                                                          |
| ----------------------------------------------- | ------------------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 45736450524 (11-26), `micelio-plugin-core`      | 45731471772 (11-26), #271 | yes                                          | A flaky test: `a scheduled reusable block that would put a page over its budget stays scheduled` of `test/strapi/reusable-block-budget.test.ts`, 1 failed of 1458. The test application's scheduler runs every second and raced the test's own publish (cause read in bogd3v/micelio-plugin-core#283, closed 2026-11-27).                      |
| 43441389405 (11-13), `micelio-plugin-core`      | 43439251653 (11-13), #222 | yes                                          | A test that fails now and then: `edits the alternative text where Strapi keeps it, and marks a file decorative` of `test/admin/builder-media.test.ts`, in `Admin pages`, 1 failed of 268. The same tree passed, so it is not deterministic; that it reads a control before the page has updated it is an inference. No issue was found for it. |
| 44661023764 (11-20), `micelio-plugin-fediverse` | 44659663152 (11-20), #50  | yes                                          | A flaky test: `serves the actor and signs an Accept that verifies with the published key` of `test/fediverse-actor-key-encryption.test.ts`, 1 failed of 541. bogd3v/micelio-plugin-fediverse#25, about the same test, was closed on 2026-11-11.                                                                                                |
| 45648768458 (11-25), `micelio-engineering`      | 45646557541 (11-25), #437 | yes                                          | An outside service: in `release / Plan`, the call to GitHub's `releases/generate-notes` ended with `unexpected end of JSON input`.                                                                                                                                                                                                             |
| 45731462581 (11-26), `micelio-engineering`      | 45730409931 (11-26), #468 | no: tested on `32ae9ac`, merged on `3b86b73` | Two changes that pass apart and fail together: #468 set a coverage floor of 95 % of lines, measured without #466; together they have 94.4 % (branches 83.54 %, floor 84 %). 928 tests passed.                                                                                                                                                  |
| 45731861429 (11-26), `micelio-engineering`      | 45731263959 (11-26), #469 | no: tested on `3b86b73`, merged on `8122408` | The same combination: #469 was tested before the floor of #468 was on `main`, and ran after it.                                                                                                                                                                                                                                                |

**Failed after green required checks, with the same workflow already red on the pull request (7):** `Contract Tests (previous)` of `micelio-cms`, which is not required. Runs 45210562425 (11-23), 45269955578 (11-23), 45368930210 (11-24), 45471215724 (11-24), 45637577886 (11-25), 45659223379 (11-25) and 45704208947 (11-25). One cause: the mock of the frontend `v0.8.1`, a released tag, answers `seo.metaSocial`, which the CMS never returns; bogd3v/micelio-cms#530 (closed 2026-11-26) made that one difference reported and not failed. `Build and Deploy` succeeded on six of the seven commits (45210563380, 45368931642, 45471216487, 45637578265, 45659223984, 45704209460); the seventh changed only documents and started none.

So of the 6 that a green pull request did not predict, 4 ran the very tree the pull request had passed (three tests that are not deterministic and one outside service) and 2 ran a tree that nothing had tested.

### Two facts every option depends on

- **The same tree can give another result.** Besides flaky tests, some inputs are not in the tree: the advisory database of `npm audit`, the `micelio-cms:edge` image the contract suite of `micelio` runs against, the tags `demo-stacks.yml` resolves, an outside API.
- **How often a tree is new.** Of the last 20 merges of each repository, read at the commits above:

| Repository                 | Merged         | Head already contained `main` | Pull request run of CI started after the commit it was merged onto |
| -------------------------- | -------------- | ----------------------------- | ------------------------------------------------------------------ |
| `micelio`                  | 11-23 to 11-27 | 9 of 20                       | 16 of 20                                                           |
| `micelio-cms`              | 11-21 to 11-27 | 12 of 20                      | 16 of 20                                                           |
| `micelio-plugin-core`      | 11-23 to 11-27 | 9 of 20                       | 15 of 20                                                           |
| `micelio-plugin-fediverse` | 11-10 to 11-24 | 18 of 20                      | 20 of 20                                                           |
| `micelio-engineering`      | 11-26 to 11-27 | 9 of 20                       | 15 of 20                                                           |

The first count is how often "require up to date" would have asked nothing more. The second is how often the merged tree was the tree the pull request tested (derived from the dates, not read from each run's checkout).

## Decision

Proposed:

1. **`micelio` and `micelio-cms` keep both runs** (option A). Their push to `main` publishes images, and the checks run on the commit the image is built from. Nothing changes in them. The rule of the Context holds there for the jobs each deploy needs. It does not cover `Contract Tests` or `analyze`, and `micelio` pushes the short-SHA tag before its tests end ("What depends on the run of `main` today"); this record changes neither.
2. **`micelio-plugin-core`, `micelio-plugin-fediverse` and `micelio-engineering` reuse the result of the pull request** (option D): on a push to `main`, a job that already passed on the same tree does not run again.
3. In those three, reuse holds only when all of these are true; otherwise the job runs, and any error in finding out runs it too:
   - the pushed commit is the merge of a pull request of this repository, not from a fork;
   - the tree of the pushed commit is the tree that pull request's run recorded it checked out;
   - the job of the same name, in the same workflow, ended in success in that run. A skipped, cancelled or missing job is not a success.
4. In those three, `main` always runs what a pull request cannot (Scorecard) and what reads something outside the tree (the dependency audit), and installs when the lockfile changed, so that the cache is saved.
5. The log of the run of `main` names the run it reused.
6. Runs by schedule or by hand reuse nothing.
7. A repository that starts publishing from a push to `main` leaves reuse in the same pull request.

## Options considered

### D. Reuse the result when the merged tree is the tree that was tested (proposed where nothing is published)

**Guarantees:** every tree on `main` passed each job once, on the pull request or on `main`. A tree nothing tested still runs, so the two combinations of the table would still have been seen, after the merge as today. No ruleset changes and no branch is updated by hand.

**Costs:** new code that decides to skip a check, with its tests; a wrong "yes" is silent. The evidence is written by the pull request's run, whose workflows are those of the pull request: that is the trust the required status check already has, but it now reaches `main`. It does not rerun for an input outside the tree. A flaky test no longer gets its second chance to show on `main`: of the four same-tree failures, all would have stayed unseen until a later run. The commit on `main` is not the commit that was checked, only its tree; a green run of `main` with skipped jobs looks like a full one, to a person and to any gate that reads "success". A tree is new, and runs in full, in about one merge in four where the base moves often (table above).

For `micelio` and `micelio-cms` it is not proposed: the checks of an image would have run on another commit than the one it is built from, neither release gate could tell a reused run from one that checked the commit, and the contract suite reads an image outside the tree.

### A. Keep both runs (proposed for `micelio` and `micelio-cms`)

**Guarantees:** every commit of `main` has its own run, so a deploy and a release read checks of their own commit; combinations that nothing tested and inputs that moved are seen after the merge.

**Costs:** the time and the job time of the table, on every merge, and runner slots that pull requests wait for. It sees a bad combination only after it is on `main`. A flaky test makes `main` red and, in `micelio` and `micelio-cms`, stops a deploy of a change that had passed.

### B. Require the branch up to date, and run on `main` only what a pull request cannot

"What a pull request cannot": publishing, Scorecard, deploy.

**Guarantees:** the tree merged is the tree tested, for the required checks, before the merge. The two combinations of the table could not have merged. It does not keep the rule of the Context for an image: the checks would not have run on the commit it is built from.

**Costs:** every merge makes the other open pull requests stale: each must be updated and run again, one at a time, and three milestones run at once. On the last 20 merges, 11 of `micelio`, 8 of `micelio-cms`, 11 of `micelio-plugin-core`, 2 of `micelio-plugin-fediverse` and 11 of `micelio-engineering` would have needed it, with runs of up to the times above. Only required checks are held to it, so every job that leaves `main` must become required first (`Admin pages`, `Performance Budgets`, `PostgreSQL suites` and the others marked "no"). The bypass actor of `micelio` escapes it. Both release gates read the run of `main` and would have to change, and pull requests lose the caches `main` saves unless a job still writes them.

### C. A merge queue

All five repositories are public and owned by an organisation, so GitHub offers it ([managing a merge queue](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue)).

**Guarantees:** the required checks run on the base plus the queued pull requests, before it reaches `main`, with no update by hand. Without the run of `main`, it keeps the rule of the Context for an image only if the commit checked is the commit that reaches `main` (below).

**Costs:** it does not remove a run by itself: it adds one before the merge, on a `merge_group` event, and the saving comes only from dropping the run of `main`. Every workflow with a required check needs that trigger. `dco.yml` fails on it, since it reads the pull request's base and head and exits when there is none. Code scanning merge protection does not apply to merge groups ([GitHub, merge protection](https://docs.github.com/en/code-security/concepts/code-scanning/merge-protection)), so `micelio` and `micelio-cms` would lose that rule at the point of the merge. A `merge_group` run cannot write the caches of the default branch. A flaky test takes a pull request out of the queue. Whether the commit that reaches `main` is the very commit the group checked was not verified.

## Trade-offs

- The proposal leaves the longest repeated job time, `micelio`'s, as it is. Its wait is better attacked by running less where a change cannot matter (bogd3v/micelio#1005) than by trusting another commit's checks before a deploy.
- In the three repositories that reuse, the guarantee becomes "this tree passed", no longer "this commit's run passed".
- Flaky tests show less often on `main`. Each of the three above is a defect whether `main` runs or not.
- One repository family, two behaviours: a reader of a green `main` has to know which one it is.
- Worth revisiting if: a run of a tree that reuse would have skipped turns out to have been needed; a plugin or this repository starts publishing from a push; or it is confirmed that a merge queue puts on `main` the very commit it checked, which would let `micelio` and `micelio-cms` drop the second run and still publish only a checked commit, if their other costs of option C are solved.

## Consequences

Nothing is adopted by this record: no workflow, ruleset, standard or published package changes. It adds this file and its row in [`docs/adr/README.md`](README.md). No version changes. Accepting it is a later decision of the maintainer.

If it is accepted, these issues would be needed. They are listed here and not created:

- `micelio-engineering`, `feat(workflows)`: a reusable step that records the tree a pull request run checked out, and answers on `main` whether a job may be reused, running it on any doubt; with tests, and `docs/workflows.md`.
- `micelio-engineering`, `ci`: `ci.yml` reuses, keeping Scorecard, the audit and the cache.
- `micelio-plugin-core`, `ci`: the same for `check`, `Playwright Image`, `Admin pages` and `Compose stack`.
- `micelio-plugin-fediverse`, `ci`: the same for `check` and `PostgreSQL suites`.

`micelio` and `micelio-cms` need no issue.
