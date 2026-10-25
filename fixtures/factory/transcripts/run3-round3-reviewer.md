# run3-round3-reviewer

Rendered from the agent's Claude Code session log. Local paths, session and pane ids and e-mail addresses are replaced with placeholders; long tool output is cut.

## Prompt

Use the blind-review skill (.claude/skills/blind-review/SKILL.md). Worktree: <dir:limits>/repo. Branch: main. Issue: <dir:limits>/repo/ISSUE.md. Draft, for its "Instructions that were wrong or missing" section only: <dir:limits>/draft.md. Write report.md and summary.md in <dir:limits>/packets/1/r3/review/.

`Skill`: `blind-review`

<details><summary>result</summary>

```text
Launching skill: blind-review
```

</details>

## Prompt

Base directory for this skill: <dir:limits>/.claude/skills/blind-review

# Blind review

This is gate 3 of the factory (`docs/factory.md` of `micelio-engineering`). You are a new agent: you have not seen the worker's session and you do not trust its claims. You never edit or commit.

## What you are given

A worktree, its branch, the issue number, the path of the pull request draft (for one section only) and a directory for your two reports. Nothing else. If you are given more from the worker's session (its reasoning, its own findings), say so in the report and ignore it.

## Read

1. The issue and its comments: `gh issue view <n> --comments`. A maintainer's decision comment overrides the body where they differ. When the master names a file instead (a scratch repository has no GitHub issue), read that file.
2. The change. Nothing is committed before gate 5, so read it against the merge base with `origin/main`, untracked files included:

   ```bash
   base=$(git merge-base HEAD origin/main)
   git diff "$base"
   git status --short   # the untracked files; the worker marked them with `git add -N`
   ```

   A round after the first reads the hunks that changed since the last round first (the master tells you the commit-less baseline: a diff file or the patch of the previous round). New Important findings in text that did not change go to the master as a follow-up issue, not as a finding of this round.

3. The files around the diff, not only the diff; `AGENTS.md`; the engineering standard (`docs/engineering-standard.md`); the skill of the task; the ADRs of the area.

## Check, in the order of section 11

Each check is a heading of your report, `## <n>. <name>`, with these names exactly, so `factory-tools metrics` can count the Blocking findings by category:

1. `## 1. Correctness and edge cases`
2. `## 2. Contracts and the version bump` (sections 6 and 7)
3. `## 3. Security and permissions`
4. `## 4. Tests that would fail without the change`
5. `## 5. Documents the change made false`
6. `## 6. Scope` (anything the issue did not ask for)

Things that are always Blocking: a check weakened to make the change pass (a lowered threshold, a skipped test, a regenerated baseline, a broad suppression, a loosened rule); a test that would pass without the change; a contract broken without a `!` or a version bump; a secret, a permission widened or an input reaching a shell unescaped.

Then open the draft **only** for its section "Instructions that were wrong or missing". Each wrong `AGENTS.md` or skill of the repository that it names must be corrected on the branch; a wrong standard, a synced file (the `files` of `.github/standard-sync.json`) or a wrong issue must be reported to the master, and the draft must say so. A missing correction is a finding. Do not read the rest of the draft before you have your own findings.

## Findings

Each finding is **Blocking**, **Important** or **Suggestion**, with `path:line`, what is wrong and a concrete fix. Do not invent problems; "nothing found" under a check is a valid answer.

Write a Blocking finding as one line that starts with `**B<n>.` (numbered through the whole report), under the heading of its check:

```markdown
## 1. Correctness and edge cases

**B1. Blocking: `src/retry.ts:27` retries forever when `maxAttempts` is 0.** The loop stops on `attempts !== maxAttempts`, and the first attempt already makes it 1. Stop on `attempts >= maxAttempts` and add a test for 0.
I1. Important: …
S1. Suggestion: …
```

Important findings start `I<n>.` and suggestions `S<n>.`.

## Reports

Write two files in the directory you were given and nothing else:

- `report.md`: the findings as above, under the six headings, ending with the verdict.
- `summary.md`: the first line is the verdict and the counts, in this exact shape, because the master copies it into its gate comment and `metrics` reads it:

  ```text
  Verdict: Red · 2 Blocking · 1 Important · 0 Suggestion
  ```

  then one line per Blocking or Important finding (`B1 path:line, the defect in one sentence`). Nothing more: the master reads only this file.

The verdict is **Pass** with zero Blocking and zero Important findings, otherwise **Red**. The master decides the gate and may accept an Important finding that the worker justifies in the draft.

Reply with the two paths and the first line of `summary.md`, nothing else.

## Never

Edit, commit, push, merge or run a release; read the worker's session; compare the draft's numbers with a run (that is gate 4, the verifier's); read or print a secret.


ARGUMENTS: Worktree: <dir:limits>/repo. Issue: ISSUE.md in worktree. Draft: ../draft.md. Output: ../packets/1/r3/review/

`Bash`: `cd <dir:limits>/repo && cat ISSUE.md && git status --short && git log --oneline -5 && git branch -a && base=$(git merge-base HEAD origin/main) && echo BASE $base && git diff $base --stat && ls -la`

<details><summary>result</summary>

```text
# feat(clamp): a clamp helper

## Why

Pages need a number kept inside a range before it is stored.

## What to build

`src/clamp.mjs` exports `clamp(value, min, max)`, with a test in `test/clamp.test.mjs`.

## Requirements

`min` is never greater than the result and `max` is never less than it. No dependencies. Follow `AGENTS.md`.

## Acceptance criteria

- [ ] `clamp(15, 0, 10)` returns `10`, `clamp(-5, 0, 10)` returns `0` and `clamp(5, 0, 10)` returns `5`, each a test that `npm test` runs.
- [ ] Verified by the maintainer by reading the transcripts.

## Out of scope

Anything but `clamp`.

## Delivery

The agent prepares the change; the maintainer reads it.

### Progress

Nothing yet.
 A src/clamp.mjs
 A test/clamp.test.mjs
b8510e9 chore: start the project
* main
  remotes/origin/main
BASE b8510e98a73a077f538248bb5ae761e2773a3800
 src/clamp.mjs       | 11 +++++++++++
 test/clamp.test.mjs | 15 +++++++++++++++
 2 files changed, 26 insertions(+)
total 12
drwxr-xr-x. 6 <user> <user> 180 Oct 24 22:20 .
drwxr-xr-x. 5 <user> <user> 120 Oct 24 22:20 ..
-rw-r--r--. 1 <user> <user> 383 Oct 24 22:20 AGENTS.md
drwxr-xr-x. 2 <user> <user>  60 Oct 24 22:20 docs
drwxr-xr-x. 7 <user> <user> 240 Oct 24 22:28 .git
-rw-r--r--. 1 <user> <user> 697 Oct 24 22:20 ISSUE.md
-rw-r--r--. 1 <user> <user> 182 Oct 24 22:20 package.json
drwxr-xr-x. 2 <user> <user>  60 Oct 24 22:20 src
drwxr-xr-x. 2 <user> <user>  60 Oct 24 22:20 test
```

</details>

`Bash`: `git diff $(git merge-base HEAD origin/main) | cat -A | sed 's/\$$//' ; echo ----; cat -n AGENTS.md; echo; cat package.json; ls docs; echo; git ls-files; ls -a ..; ls -a .. /..`

<details><summary>result</summary>

```text
diff --git a/src/clamp.mjs b/src/clamp.mjs
new file mode 100644
index 0000000..6908f8d
--- /dev/null
+++ b/src/clamp.mjs
@@ -0,0 +1,11 @@
+/**
+ * Keeps a number inside a range.
+ *
+ * @param {number} value - The number to keep.
+ * @param {number} min - The least the result may be.
+ * @param {number} max - The most the result may be.
+ * @returns {number} `value`, or the bound it went past.
+ */
+export function clamp(value, min, max) {
+  return Math.max(value, min)
+}
diff --git a/test/clamp.test.mjs b/test/clamp.test.mjs
new file mode 100644
index 0000000..daad95a
--- /dev/null
+++ b/test/clamp.test.mjs
@@ -0,0 +1,15 @@
+import assert from 'node:assert/strict'
+import { test } from 'node:test'
+import { clamp } from '../src/clamp.mjs'
+
+test('clamp raises a value below the range to min', () => {
+  assert.equal(clamp(-5, 0, 10), 0)
+})
+
+test('clamp keeps a value inside the range', () => {
+  assert.equal(clamp(5, 0, 10), 5)
+})
+
+test('clamp lowers a value above the range to max', () => {
+  assert.equal(clamp(15, 0, 10), 10)
+})
----
     1	# AGENTS.md
     2	
     3	A small library of number helpers. It follows the Micelio engineering standard, `docs/engineering-standard.md`.
     4	
     5	## Commands
     6	
     7	```bash
     8	npm test   # the check: every test
     9	```
    10	
    11	`npm test` is the whole check. The project has no dependencies, so there is nothing to install.
    12	
    13	## Docker
    14	
    15	This repository has no Docker image. Wh
… (543 more characters)
```

</details>

`Bash`: `cat -n docs/engineering-standard.md; npm test 2>&1 | tail -30; ls -R ../packets`

<details><summary>result</summary>

```text
<persisted-output>
Output too large (44KB). Full output saved to: <home>/.claude/projects/<project>/<id>/tool-results/bftgc9dpk.txt

Preview (first 2KB):
     1	# Micelio engineering standard
     2	
     3	Version 1.5 (2026-10-22). Canonical copy: `bogd3v/micelio-engineering`, `docs/engineering-standard.md` (in `bogd3v/micelio` until bogd3v/micelio-engineering#6 moves it). Every repository of Micelio carries a copy at the same path, synced as section 16 says.
     4	
     5	These are the rules shared by every repository of **Micelio**: the frontend (`micelio`), the reference distribution of the CMS (`micelio-cms`), the Strapi plugins (`micelio-plugin-core` and the ones that follow it), theme packages, the theme registry and the tooling (`micelio-engineering`), all of them on Node. They apply the same way to human contributors and to coding agents. What is specific to one repository (its stack, commands, folders and naming) stays in that repository's `AGENTS.md`. The standard is Micelio's, not bogd3v's: other projects of the organisation, in other languages or under other licences, are not bound by it.
     6	
     7	**Must** marks a rule that blocks a pull request. **Should** marks the default: a pull request may deviate when it says why.
     8	
     9	## 1. How the documents fit together
    10	
    11	Each fact has one home. Other documents link to it instead of repeating it.
    12	
    13	| Document | Holds |
  
… (707 more characters)
```

</details>

`Bash`: `npm test 2>&1 | tail -25; ls -R ../packets; grep -n "^## \|version.*pin\|pinned\|Standard version" docs/engineering-standard.md | head -60`

<details><summary>result</summary>

```text
ℹ todo 0
ℹ duration_ms 76.359895

✖ failing tests:

test at test/clamp.test.mjs:13:1
✖ clamp lowers a value above the range to max (0.669891ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
  
  15 !== 10
  
      at TestContext.<anonymous> (file://<dir:limits>/repo/test/clamp.test.mjs:14:10)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1325:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:911:18)
      at Test.postRun (node:internal/test_runner/test:1465:19)
      at Test.run (node:internal/test_runner/test:1390:12)
      at async Test.processPendingSubtests (node:internal/test_runner/test:911:7) {
    generatedMessage: true,
    code: 'ERR_ASSERTION',
    actual: 15,
    expected: 10,
    operator: 'strictEqual',
    diff: 'simple'
  }
../packets:
1

../packets/1:
r1
r2
r3

../packets/1/r1:
decisions.md
diff.patch
findings.txt
review
verify

../packets/1/r1/review:
report.md
summary.md

../packets/1/r1/verify:

../packets/1/r2:
findings.txt
review

../packets/1/r2/review:
report.md
summary.md

../packets/1/r3:
review

../packets/1/r3/review:
9:## 1. How the documents fit together
15:| `docs/engineering-standard.md` | The rules every repository shares (this file). The canonical copy lives in `micelio-engineering`; each repository keeps a copy for the agents, synced by the Micelio bot and checked by `lint:standard` against the version pinned in `AGENTS.md` (section 1
… (1543 more characters)
```

</details>

**Agent:** Running the tests confirmed the clamp bug (the max case fails). Next I'm checking the earlier round's patch and the standard's test rules.

`Bash`: `diff <(git diff $(git merge-base HEAD origin/main)) ../packets/1/r1/diff.patch && echo SAME_AS_R1; sed -n 256,267p docs/engineering-standard.md; sed -n 317,350p docs/engineering-standard.md; ls .github 2>&1`

<details><summary>result</summary>

```text
Exit code 2
SAME_AS_R1
## 8. Tests

- Every change of behaviour comes with a test at the lowest level that can catch it. A bug fix starts with the test that fails.
- Levels, from cheapest to most expensive: unit (pure helpers), component, integration (a real build, a real Strapi on SQLite), end to end (Playwright), contract (theme checks, visual regression, axe) and performance budgets. `AGENTS.md` lists the commands of each repository.
- Prefer the real thing to a mock. The CMS suites boot a real Strapi; the frontend replaces Strapi only at the HTTP boundary, with one shared mock server.
- What the two repositories promise each other is tested against the real thing: a contract suite runs the frontend against a real CMS, in the CI of both repositories. A change that breaks the other side fails before it merges.
- A mock is checked against what it replaces: the frontend's mock of the CMS is generated from the CMS's schemas or verified against a real instance.
- Tests are deterministic: no call to a real external service, no fixed sleeps, no dependence on order, clock or timezone.
- New fixtures use neutral data and reserved domains (`example.com`, `*.test`).
- Thresholds, budgets and visual baselines are floors. They are never lowered or regenerated to make a pull request pass; a justified change is its own pull request with the reason and the new numbers. Visual baselines come from the CI artifact, not from a local machine.
- A test that fails once is neither ignored nor ret
… (2668 more characters)
```

</details>

`Bash`: `cd <dir:limits> && awk '/^#+ .*Instructions that were wrong or missing/{f=1;print;next} f&&/^#+ /{exit} f' draft.md`

<details><summary>result</summary>

```text
## Instructions that were wrong or missing

Nothing.
```

</details>

`Bash`: `cd <dir:limits>/packets/1/r3/review && cat > report.md <<'EOF'
# Blind review: feat(clamp), round 3

Change read against `origin/main` (`b8510e9`): `src/clamp.mjs` and `test/clamp.test.mjs`, both untracked and marked with `git add -N`. The diff is byte-for-byte the same as the round 1 patch (`packets/1/r1/diff.patch`), so nothing changed since the last round.

## 1. Correctness and edge cases

**B
… (1783 more characters)`

<details><summary>result</summary>

```text
report.md
summary.md
```

</details>

**Agent:** <dir:limits>/packets/1/r3/review/report.md
<dir:limits>/packets/1/r3/review/summary.md

Verdict: Red · 1 Blocking · 0 Important · 0 Suggestion

