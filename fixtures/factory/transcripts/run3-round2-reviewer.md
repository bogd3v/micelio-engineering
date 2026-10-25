# run3-round2-reviewer

Rendered from the agent's Claude Code session log. Local paths, session and pane ids and e-mail addresses are replaced with placeholders; long tool output is cut.

## Prompt

Use the blind-review skill (.claude/skills/blind-review/SKILL.md). Worktree: <dir:limits>/repo. Branch: main. Issue: <dir:limits>/repo/ISSUE.md. Draft, for its "Instructions that were wrong or missing" section only: <dir:limits>/draft.md. Write report.md and summary.md in <dir:limits>/packets/1/r2/review/.

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

`Bash`: `cd <dir:limits>/repo && cat ISSUE.md && git status --short && base=$(git merge-base HEAD origin/main) && echo BASE $base && git diff "$base" --stat && ls; ls docs 2>/dev/null`

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
BASE b8510e98a73a077f538248bb5ae761e2773a3800
 src/clamp.mjs       | 11 +++++++++++
 test/clamp.test.mjs | 15 +++++++++++++++
 2 files changed, 26 insertions(+)
AGENTS.md
docs
ISSUE.md
package.json
src
test
engineering-standard.md
```

</details>

`Bash`: `git diff $(git merge-base HEAD origin/main) ; echo ----; cat -n AGENTS.md package.json; ls -R src test .claude .github 2>/dev/null; echo ----; wc -l docs/engineering-standard.md`

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
… (375 more characters)
```

</details>

`Bash`: `grep -n '^#' docs/engineering-standard.md | head -60; awk '/Instructions that were wrong or missing/{f=1;print;next} f&&/^## /{exit} f' ../draft.md; node --test test/*.test.mjs 2>&1 | tail -15`

<details><summary>result</summary>

```text
1:# Micelio engineering standard
9:## 1. How the documents fit together
33:## 2. Principles
43:## 3. Language and naming
51:## 4. Code
53:### TypeScript
59:### Where types and constants live
78:### Style
87:### Errors and logging
95:### HTTP APIs
101:### Doc comments (TSDoc)
171:### Comments and suppressions
177:## 5. Configuration and secrets
184:## 6. Contracts and compatibility
206:## 7. Versions and releases
210:### What a version promises
224:### Before 1.0.0
228:### The release line
238:### Tags and artifacts
245:### Release notes
250:### Deprecation and support
256:## 8. Tests
268:## 9. Security, privacy, accessibility, performance and sustainability
270:### Security
281:### Privacy
286:### Accessibility
294:### Performance
298:### Sustainability
303:## 10. Dependencies, licences, supply chain and runtime
317:## 11. Git, pull requests and review
319:### Branches and commits
326:### Pull requests
334:### Review
340:### Done
351:## 12. Documentation, decisions and planning
353:### Organised by reader
372:### Outside the repository
378:### Decisions and planning
387:## 13. Coding agents
400:## 14. Starting a new repository
422:## 15. Required checks
441:## 16. Changing this standard
## Instructions that were wrong or missing

Nothing.

  
      at TestContext.<anonymous> (file://<dir:limits>/repo/test/clamp.test.mjs:14:10)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1325:25)
      at Test.processPendingSubtests
… (387 more characters)
```

</details>

`Bash`: `sed -n 184,267p docs/engineering-standard.md; sed -n 101,130p docs/engineering-standard.md`

<details><summary>result</summary>

```text
## 6. Contracts and compatibility

| Contract | Source of truth | A breaking change is |
| --- | --- | --- |
| Theme contract: roles, modes, layout variants, public hooks, slots and slot APIs | ADR 0005; `modules/theme/contract.ts`, `app/theme/hooks.json` and the schema and reference generated from them | Removing or renaming any of them, or changing a hook's markup so that existing selectors stop matching |
| Content API between CMS and frontend: content types, components, blocks, response shapes | The schemas in `micelio-cms`; `docs/api.md` in `micelio` | Removing or renaming a field, a block or a route, or changing its type |
| API token permissions | `src/migrations/api-tokens.ts` in `micelio-cms`; `docs/security.md` in `micelio` | Any difference between the two |
| Operator interface: environment variable names, image names and tags, Compose service and volume names, health endpoints, backup paths | `.env.example`, the Compose files, the operator documentation | Renaming or removing one, or an upgrade that needs a manual step |
| Visitor-facing identifiers: URLs, feeds, fediverse actor ids, cookie and storage keys | The ADR that introduced each | Any change that breaks a link, a follow or a stored preference |
| Stored data: database schema and boot migrations | `src/migrations/` | A migration that the previous release's code cannot run against, or that cannot run twice |
| Block contract: the catalogue of blocks, each with its id, schema, presentation options, cost and 
… (10001 more characters)
```

</details>

**Agent:** I've found the main defect: `clamp` never applies `max`. Writing the reports now.

`Bash`: `cd <dir:limits>/packets/1/r2/review/ 2>/dev/null || mkdir -p <dir:limits>/packets/1/r2/review/
d=<dir:limits>/packets/1/r2/review
cat > $d/report.md <<'EOF'
# Blind review: feat(clamp): a clamp helper (ISSUE.md)

Change read against the merge base with `origin/main` (`b8510e9`): `src/clamp.mjs` and `test/clamp.test.mjs`, both untracked and marked with `git add -N`. I was given no context from the 
… (2282 more characters)`

<details><summary>result</summary>

```text
report.md
summary.md
```

</details>

**Agent:** <dir:limits>/packets/1/r2/review/report.md
<dir:limits>/packets/1/r2/review/summary.md

Verdict: Red · 1 Blocking · 0 Important · 1 Suggestion

