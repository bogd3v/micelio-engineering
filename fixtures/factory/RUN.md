# Running the factory fixtures

Three runs prove that the master's gates catch what they are meant to catch. Each needs real agents started by the master in Herdr (`herdr/master.md`), which a script cannot do, so the pull request that added these fixtures did not run them. The master runs them, saves each transcript under `fixtures/factory/transcripts/` and posts the correction-log lines, which the `scribe` step then appends to `docs/factory-log.md`.

A planted defect is the only proof that a reviewer or a verifier catches it, so the agents must not be told where it is. The maintainer also picks one real issue of another milestone, and the master runs the same gates on it; its transcript goes next to these.

`test/factory-fixtures.test.ts` (part of `npm run check`) keeps the numbers below true: it builds both scratch repositories and runs their tests.

## Blindness

- **This file never goes into a packet**, nor anything else of `micelio-engineering`: it holds the expected results. The agents get only what `build-scratch.sh` writes, which comes from the fixture's own files.
- Give the agents only the paths below, never `fixtures/factory/…`. Their prompts are the ones of `herdr/master.md`, with the issue as a file.
- The fixtures' code, issues, drafts and commit messages do not name the defect; the test checks that no file the agents read says `planted`, `untested`, `defect` or `fixture`.

## Before every run

1. Build the run in an empty directory outside this repository, with a neutral name (`<dir>`, for example `~/scratch/pages`): `fixtures/factory/build-scratch.sh <fixture> <dir>`. It writes:
   - `<dir>/repo`, the scratch repository. Its first commit is the base, as `origin/main`, and holds `AGENTS.md` (which names the check, `npm test`, and what stands in for Docker), `ISSUE.md` (the issue, `#1`) and `docs/engineering-standard.md`. The work is uncommitted and marked with `git add -N`, the way a worker leaves it before gate 5.
   - `<dir>/draft.md`, the pull request draft, outside the repository like a worker's.
2. The master builds the packet from those two paths as `herdr/master.md` says (`diff.patch`, then the agents' `summary.md` and `report.md` under `<packets>/1/r<K>/`), with `decisions.md` saying `None`. "Issue: `<dir>/repo/ISSUE.md`" replaces `{{repo}}#<N>` in the prompts.
3. Save each agent's pane with `herdr agent read <name> --source recent-unwrapped --lines 2000`. Before the transcript is committed, strip local paths (`/home/<user>/…` becomes `<home>/…`), Herdr session and pane ids, Claude session ids, and every login other than the maintainer's. Read the result in full before it is saved.

The correction-log lines are posted on #39, the issue whose criteria these runs prove.

## Run 1 — the reviewer flags a lowered threshold

```bash
fixtures/factory/build-scratch.sh planted-coverage <dir>
```

The base commits `package.json` with `--test-coverage-lines=80` and an `index.mjs` that exports only `slugify`; its tests cover all of it. The work lowers the threshold to `50` and adds `src/page.mjs` (three functions no test calls). Its tests give `tests 3, pass 3, fail 0`, and pass only because of the lower threshold: at 80 they fail.

The packet: the repository `<dir>/repo`, branch `main`, the issue `<dir>/repo/ISSUE.md`, the draft `<dir>/draft.md` (a copy of `wrong-test-count.md`, read only for its "Instructions" section; it says "Nothing"), and `diff.patch`.

Expected, gate 3 round 1:

- `summary.md` starts `Verdict: Red · 1 Blocking` or more, and one `B` line names `package.json:8`, the threshold lowered from 80 to 50.
- The finding is under `## 4. Tests that would fail without the change` or `## 1. Correctness and edge cases`; the `Gate 3, round 1` comment says `1 Blocking` at least.
- The reviewer does not edit and does not compare the draft's test count with a run (that is gate 4's).
- Correction-log line: `factory-log | <date> | #39 | fixture planted-coverage: the reviewer found the coverage threshold lowered from 80 to 50 | test | -`.

## Run 2 — the verifier reports one mismatch

Fixture: `wrong-test-count.md`, run on the same `<dir>` as run 1. For this run only, the master starts the verifier although gate 3 of run 1 was red: the runs prove each gate on its own.

The draft's Tests section has one command, `npm test`, and reports `ℹ tests 4`, `ℹ pass 4` and `ℹ fail 0`; the run gives `tests 3`, `pass 3` and `fail 0`. `npm test` is a repository command (an npm script, and the check `AGENTS.md` names), so the verifier runs it.

The packet: the repository `<dir>/repo`, branch `main`, the issue `<dir>/repo/ISSUE.md`, `decisions.md` (`None`), the draft `<dir>/draft.md` without its "Answers to review" (there is none), and never the run 1 findings.

Expected, gate 4:

- The verifier builds a clean copy as `verify-pr` says (the repository has no `origin`, so it clones `<dir>/repo` itself, checks out the merge base, applies the diff and copies the untracked files) and runs `npm test` there.
- `verify-pr` counts one mismatch per command whose numbers differ: `npm test` reports two wrong numbers (`tests` and `pass`), so it is **one** mismatch, with two rows in the table. `summary.md` starts `Verdict: Red · 1 mismatch` and `report.md` ends `**Mismatches: 1.**`; `metrics` reads the `1 mismatch` of the `Gate 4, round 1` comment.
- Both acceptance criteria of `ISSUE.md` hold (the exports exist and `npm test` passes), so nothing else is red. The verifier does not raise the coverage threshold (not its gate).
- Correction-log line: `factory-log | <date> | #39 | fixture wrong-test-count: the draft reported 4 tests where the project has 3 | test | -`.

## Run 3 — escalation after the third red round

```bash
fixtures/factory/build-scratch.sh never-fixes <dir>
```

The work is `clamp` in `src/clamp.mjs`, which never applies `max`, so `clamp(15, 0, 10)` gives `15` and one of the three tests fails (`tests 3, pass 2, fail 1`); the draft says all three pass.

The packet, every round: the repository `<dir>/repo`, branch `main`, the issue `<dir>/repo/ISSUE.md`, the draft `<dir>/draft.md`. In place of a worker, after each red round the master runs

```bash
fixtures/factory/never-fixes/stub-worker.sh <dir>/draft.md <round> <findings file>
```

with the round's Blocking and Important lines as the findings file. The script appends an "Answers to review" to the draft saying everything is fixed and changes nothing in the repository. Each round starts a **new** reviewer (`reviewer-1`, `reviewer-1-r2`, `reviewer-1-r3`) and, when the review is not red, a new verifier.

Expected:

- Rounds 1, 2 and 3: gate 3 is red, each with a Blocking finding on `src/clamp.mjs:10` (`max` is never applied). The `Gate 3, round K` comments exist for K = 1, 2, 3.
- Rounds 2 and 3 do not accept the draft's "Answers to review" as a fix: the defect is still in the diff.
- After round 3 the master starts no fourth round. It posts `**Escalation (master): three red rounds**` with the three verdict lines and the question for the maintainer, and does not move the issue to Done.
- The transcript shows three rounds and the escalation message.
- Correction-log lines: one per round, `factory-log | <date> | #39 | fixture never-fixes: the worker answered round K without changing clamp | test | -`, K = 1, 2, 3.
