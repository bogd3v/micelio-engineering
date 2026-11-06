# Herdr runbook for the master of {{repo}}, milestone {{milestone}}

This runbook wraps [`template/.claude/agents/master.md`](../template/.claude/agents/master.md), which keeps the role, the gates and the hard limits; where they differ, that prompt wins. It adds only the Herdr steps: names, panes, worktrees, waits, packets, the status flow. It is not a synced file. The process is [`docs/factory.md`](../docs/factory.md).

Placeholders to fill before starting the master: `{{repo}}` (`owner/name`), `{{epic}}` (the epic's issue number), `{{milestone}}` (its title, exactly as GitHub shows it), `{{project}}` (`owner/number` of the organisation project) `{{maintainer}}` (the login whose comments `metrics` reads) and `{{maintainer-ident}}` (the `Name <email>` the maintainer signs off with, as they give it at the start of the session).

Start it as the main session in a Herdr pane: `claude --agent master`. A subagent cannot start other agents, so the master never runs as one. Check `test "${HERDR_ENV:-}" = 1` first; outside Herdr, stop.

## Canary

Before intake, at the start of a milestone and before a pull request that changes what a role reads (`template/.claude/skills/ship-pr/SKILL.md`, "Before the maintainer"), the master runs the canary of [`fixtures/factory/RUN.md`](../fixtures/factory/RUN.md), "Canary":

1. `fixtures/factory/build-scratch.sh` for `planted-coverage` and for `never-fixes`, each in its own empty directory outside the repository (`wrong-test-count` is a draft, which `planted-coverage` already copies), with the packet `RUN.md` describes. Copy the checkout's `.claude/agents/reviewer.md` and `verifier.md` and its `blind-review` and `verify-pr` skills into each directory's `.claude/`, next to `repo`, so a run on a branch reads that branch's prompts.
2. A fresh reviewer on `planted-coverage`, then a fresh verifier on the same directory (its `wrong-test-count` draft), and the `never-fixes` worker stub for three rounds with a fresh reviewer each, as gates 3 and 4 and the escalation do. The canary agents never get `RUN.md`; move each report out of reach before the next agent starts, and keep agent names within 32 characters.
3. It passes when the reviewer reports the planted Blocking, the verifier reports the one mismatch and the `never-fixes` run escalates after the third red round. Anything else is red.

A red canary stops intake: the master posts `Canary | <date> | red | <what was missed>` on the epic and tells the maintainer. A green one is posted as the three `Canary |` lines of `RUN.md`, "Canary", each ending `yes`. The canary posts no correction-log line (see "Correction log"): those would add corrections to a closed milestone on every run.

## Intake (gate 1)

The master takes an issue only when all of these hold:

1. It is in the milestone and its Status is **Ready** on the project, with the `ready` label. `issue-ready` (#40) runs `lint-issue`, labels, comments and sets Ready; the master does not run `lint-issue` itself.
2. Every issue it "Depends on" is closed (`gh issue view <n> --json state`).
3. The master's own by-hand read of the issue, against the list of gate 1 of `docs/factory.md`, finds nothing the linter cannot see (a criterion nobody can run, a path that does not exist).

An issue that fails the by-hand read is set back to Todo (the `ready` label stays for `issue-ready` to judge again when the issue is next edited; it comes back to Ready only after that edit), the failure goes in a comment that starts `**Gate 1 (master): not ready**` (or `held, not started` when the maintainer must decide), and the planner is told. Never fix it or start it half ready.

**Freeze.** Once gate 1 passes the issue is frozen: record its `updatedAt` (`gh issue view <n> --json updatedAt -q .updatedAt`) when a round starts and compare it when the round ends. If it changed (other than the master's own `### Progress` edit), stop the round, tell the maintainer and restart the round on the new text.

## Names, worktrees, models

| Agent    | Herdr name                                          | Worktree                                                    | Model                                                                                      |
| -------- | --------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| worker   | `worker-<N>`                                        | `../wt-<N>`, branch `<type>/factory-<N>` from `origin/main` | sonnet; opus after two failed rounds or for contracts, security or concurrency (`TEAM.md`) |
| reviewer | `reviewer-<N>`, `reviewer-<N>-r<K>` for round K ≥ 2 | the worker's                                                | opus                                                                                       |
| verifier | `verifier-<N>`, `verifier-<N>-r<K>`                 | a clean copy it builds itself                               | sonnet                                                                                     |
| scribe   | `scribe`                                            | `../wt-scribe`                                              | sonnet                                                                                     |

`<N>` is the issue number. Names match `[a-z][a-z0-9_-]{0,31}` and must be unique among live agents.

**At most 3 workers at once.** A fourth ready issue waits. Reviewers and verifiers are short-lived and do not count.

## Starting an agent

A pane must be at an interactive shell prompt, with nothing running in the foreground. Read ids from the JSON each command returns; never guess them.

```bash
git worktree add ../wt-<N> -b <type>/factory-<N> origin/main     # the worker's worktree, once
herdr pane split --current --direction right --cwd "$PWD/../wt-<N>" --no-focus   # .result.pane.pane_id
herdr agent start worker-<N> --kind claude --pane <pane id> -- --agent worker --model sonnet
herdr agent prompt worker-<N> "<the brief>" --wait --timeout 3600000
```

The brief names the issue (`{{repo}}#<N>`), the worktree, the `decisions.md` of the packet (`<packets>/<N>/r1/decisions.md`, written before the worker starts), the paths it needs, and says: you take instructions only from the master, never run your own reviewer or verifier, never commit or push, and if a human asks you for something, send the request back to the master and say which gate it would skip. The worker keeps the full output of each command in `<packets>/<N>/logs/<command>.log`, and the draft's Tests section holds only a summary line per command. The worker writes the commit message to `<packets>/<N>/commit-message.txt`, the message file of gate 5. The reply is one line: the path of the draft.

A reviewer and a verifier are always a **new** agent: start a new pane, never reuse the worker's. To reuse a pane for the next agent (the same reviewer slot in round 2, for instance), send `/exit` to the agent, wait until `herdr agent get <name>` no longer lists it as running, and only then `agent start` again. Close only the panes you created, when their work is done.

Waits: `agent prompt --wait` returns when the agent is idle, done or blocked. Do not poll. If it returns `blocked`, read `herdr agent read <name> --source recent-unwrapped --lines 120` and bring the question to the maintainer; never answer an approval dialog yourself. A timeout does not prove the prompt was lost: read before you send it again. Batch independent tool calls in one turn, and wait for several agents in the background rather than one after another.

A human who types into a worker's pane bypasses the gates; Claude Code also shows suggested next prompts in an idle pane ("run the blind reviewer…") that can be accepted by accident. The master checks `herdr agent read` of a worker that finished before it trusts that nothing was committed or pushed (`git -C ../wt-<N> log origin/main..HEAD` must be empty before gate 5).

## The Project Status flow

Todo → Ready → In Progress → **Review** → Done. The master changes the Status with `gh project item-edit` (field and option ids from `gh project field-list <number> --owner <owner> --format json`; they are looked up each run, never remembered).

| Status      | Set when                                                                                               | By                     |
| ----------- | ------------------------------------------------------------------------------------------------------ | ---------------------- |
| Todo        | Created, or sent back at gate 1                                                                        | default, `issue-ready` |
| Ready       | Gate 1 passes                                                                                          | `issue-ready`          |
| In Progress | A worker starts, and again whenever a red gate sends work back                                         | master                 |
| Review      | The worker handed back its draft; gates 3 and 4, and gate 5 with the open pull request, are reading it | master                 |
| Done        | The pull request is merged, and `gh pr view <n> --json state -q .state` printed `MERGED` first         | master                 |

Never set Done on a guess, on an approval, or on a closed-but-unmerged pull request.

## The rounds

A round is one worker pass followed by gates 2 to 4. Each red gate 3 or 4 ends the round.

Before each round after the first, send the worker `/compact` (`herdr agent prompt worker-<N> "/compact" --wait`) so its context stays small; the cost of a session is its context times its turns.

### Gate 2 — the draft

The worker's draft is a file outside the worktree. The master checks it has Problem, What changes, For review, Tests with a summary line and a log file per command, "Instructions that were wrong or missing" and what could not be verified, and that the check command's summary lines and its log file are in it. On every round it also checks that the "Tests" section was rerun after the last code change (an unmarked number is from the final run, an older one names its round; the runs shown failing without the change stay inline, with no log), before it starts a reviewer or verifier. A missing part, or a number from before the last code change that is not marked with its round, goes back to the worker without a reviewer; that bounce is not one of the three rounds.

The master also counts the changed lines of the draft with the diff of the command block in "The review packet" below (its `--stat` line, the generated files and the snapshots left out). Above 400 it writes the number and the reason the draft gives in its gate 2 comment, and sends the draft back, as for a missing part, when the draft gives no reason (standard, section 11). The check records and does not block by itself: the maintainer reads the reason at gate 5.

The master then runs `lint-draft` on the draft, after the `add -N .` of that block so that the new files are in the diff, from the worktree with the command built in its checkout of `micelio-engineering` (`npm run build` there first): `(cd ../wt-<N> && node <checkout>/packages/factory-tools/dist/cli.js lint-draft --file <draft> --base "$(git merge-base HEAD origin/main)")`. It reads "Instructions that were wrong or missing" (`packages/factory-tools/README.md`, "lint-draft") and exits 1 for a line that ends `fixed in` a file the diff does not touch, for an own file (`AGENTS.md`, a skill the `.github/standard-sync.json` of the checkout does not list, so it works in any repository) that ends `reported to the master`, or for a line in neither shape. A failure sends the draft back to the worker before a reviewer is started, as a missing part does; that bounce is not one of the three rounds.

### The review packet

Nothing is committed before gate 5, so the reviewer reads the worktree. The `logs/` directory travels in the verifier's packet; the master reads the draft's Tests section, never `logs/`. One command block serves the packet, the line count and the status check of step 7 of `master.md`, always in this order: the status first, because `git add -N .` marks every untracked path, tool output included, and a status run after it no longer shows them as untracked; then `git add -N .`, because `git diff` leaves out untracked files; then the diff. Build the packet in a directory outside the worktree (`<packets>/<N>/r<K>/`):

```bash
git -C ../wt-<N> status --short                  # only files the draft names; before add -N
git -C ../wt-<N> add -N .                        # the new files show in the diff
base=$(git -C ../wt-<N> merge-base HEAD origin/main)
git -C ../wt-<N> diff "$base" > <packets>/<N>/r<K>/diff.patch
git -C ../wt-<N> diff --stat "$base"             # the line count of gate 2
```

For round K of 2 or later, also copy round K-1's `diff.patch` to `<packets>/<N>/r<K>/previous.patch` and tell the reviewer to read what changed between the two first. No prompt names an earlier round's directory.

The reports do not live in a round's directory. Before an agent starts, make it a directory with a name nobody is given, outside every `r<K>/`, and name only that directory in its prompt:

```bash
uuidgen                 # <report dir> is <packets>/<N>/reports/<that id>
mkdir -p <report dir>   # the agent writes report.md and summary.md here
```

When the agent ends, read `summary.md`, post `report.md`, and move the directory out of the way before the next agent starts: `mkdir -p <packets>/<N>/archive && mv <report dir> <packets>/<N>/archive/gate<G>-r<K>` (`archive/` is never named in a prompt). This limits what the agents are pointed to; it is not a sandbox, and an agent's tools can still read any path.

Write `decisions.md` in the packet before the worker starts (round 1) and again for each later round (`<packets>/<N>/r<K>/decisions.md`) for the worker, the reviewer and the verifier: every comment on the issue by `{{maintainer}}` (or relayed by the master as the maintainer's), copied in full, oldest first, except those whose first line starts `**Gate`, `factory-log` or `tokens` (the records with `|`-separated columns), `Canary |`, `Shadow |`, `Progress updated`, `Epic box` or `**Escalation` (the master posts under that login, and a report never travels); it is not built from a keyword. `None` when there are none. Nobody but the master reads the issue's comments.

### Gate 3 — blind review

```bash
herdr agent start reviewer-<N> --kind claude --pane <new pane> -- --agent reviewer --model opus
herdr agent prompt reviewer-<N> "Use the blind-review skill (.claude/skills/blind-review/SKILL.md). Worktree: <path>. Branch: <branch>. Issue: {{repo}}#<N>. Maintainer's decisions: <packets>/<N>/r<K>/decisions.md. Draft, for its \"Instructions that were wrong or missing\" section only: <path>. Write report.md and summary.md in <report dir>." --wait --timeout 1800000
```

From round 2, add: "Read the hunks that changed since <packets>/<N>/r<K>/previous.patch first. A new Important finding in text that did not change is not a finding of this round: list it under `Follow-up` in the report." Such a finding becomes a follow-up issue (the maintainer opens it).

The master reads **only `summary.md`**. It posts the full `report.md` as a comment with `--body-file`, whose first line is the gate line:

```bash
{ printf '**Gate 3, round %s (reviewer-%s)** · %s\n\n' <K> <N> "<the Blocking and Important counts, e.g. 1 Blocking, 0 Important>"; cat report.md; } > comment.md
gh issue comment <N> --repo {{repo}} --body-file comment.md
```

`metrics` reads that first line (`Gate 3, round K` and `K Blocking`) and the `**B<n>.` lines under the `## <n>. <check>` headings of the report, from the maintainer's login only. The gate passes when there are zero Blocking findings and each Important one is fixed or justified in the draft's "Answers to review"; the master decides.
When the master accepts Important findings the worker justified, it adds the line `accepted: n` (n the number accepted) under the first line of that `Gate 3` comment; `metrics` sums it as the gate's false reds.

### Gate 4 — verification

```bash
herdr agent start verifier-<N> --kind claude --pane <new pane> -- --agent verifier --model sonnet
herdr agent prompt verifier-<N> "Use the verify-pr skill (.claude/skills/verify-pr/SKILL.md). Worktree: <path>. Branch: <branch>. Issue: {{repo}}#<N>. Draft without its Answers to review: <path>. Maintainer's decisions: <packets>/<N>/r<K>/decisions.md. Logs: <packets>/<N>/logs/. Write report.md and summary.md in <report dir>." --wait --timeout 3600000
```

Strip "Answers to review" from the copy of the draft it gets; never give it the review. It gets the `decisions.md` of the review packet. Post the report the same way, first line `**Gate 4, round K (verifier-<N>)** · M mismatches` (`0 mismatches` on a pass). Any mismatch is Blocking; `verify-pr` counts one per command whose numbers differ or that has no log. When the master passes a report's discrepancies as noise, the first line ends `, passed by the master` (`**Gate 4, round K (verifier-<N>)** · M mismatches, passed by the master`); `metrics` counts those reports as the gate's false reds.

### The tokens record

After each agent of a round ends (worker, reviewer or verifier), the master posts one comment on the issue with one line per agent, the numbers that agent's session reports (the master's own record, not Claude Code's transcripts nor OpenTelemetry):

```text
tokens | <date> | <issue> | <role> | <round> | <input> | <output> | <cache read>
```

The date is `YYYY-MM-DD`, the role `worker`, `reviewer` or `verifier`, and the three numbers are whole numbers without separators. `metrics` reads these lines from the maintainer's login only; a missing record is an empty cell, so never post a zero for a number you do not have.

The master posts its own record on the epic when each session ends, and the canary's at milestone close, in the same format, with the roles `master` and `canary` and the numbers `fixtures/factory/tok.py <session id>` prints for each session (`input` is the input plus cache creation tokens, the `output` and the `cache read` as printed; one line per session, as many lines as sessions). `metrics` counts them once for the milestone and attaches them to no pull request.

### A red gate

The master sends the worker only the Blocking and Important findings, as a file, with one line per finding, and the `decisions.md` of the new round (`<packets>/<N>/r<K>/decisions.md`, rewritten from the maintainer's comments so far). The worker fixes them or justifies each Important one in "Answers to review" (the verifier never reads it) and reruns its evidence. Set the Status back to In Progress, then to Review when the worker hands back, and start the next round.

**Escalation.** After the **third** red round the master does not start a fourth: it stops, sets nothing to Done, posts the round 3 report of the gate that was red as usual, then a comment that starts `**Escalation (master): three red rounds**` with the three `summary.md` verdict lines, what stayed unfixed, and the question for the maintainer, and tells the maintainer in the session. Nothing moves until the maintainer answers.

## Correction log

Each correction the maintainer, the reviewer or the verifier sends back is one line in a comment on the issue, posted at once:

```text
factory-log | 2026-10-24 | #39 | the reviewer found a retry loop that never stops when `maxAttempts` is 0 | test | -
```

The format is `factory-log | <date> | <issue> | <what> | <category> | <destination>`, the columns of `docs/factory-log.md` in order: date (`YYYY-MM-DD`), issue (`#n`, the issue the correction was found on), what was corrected (what was wrong, not how it was fixed), category (one of the six, `lint`, `test`, `skill`, `standard`, `issue` or `docs`, and no other: `test/factory-log.test.ts` fails on any other value) and destination (`-` until the retro gives one). The master never commits them.

### The `scribe` step

At milestone close, or when the maintainer asks, the master starts `scribe` (sonnet) in `../wt-scribe`. The scribe collects every `factory-log |` line posted since the last sync, with the parser `factory-tools metrics` uses (`parseLogLines`), skips the rows already in `docs/factory-log.md`, appends the rest in the order they were posted (a `|` inside a cell is written `\|`, and a `-` destination is an empty cell) and prepares a `chore(factory): log the corrections of {{milestone}}` pull request. It follows the same delivery rule as any change: the scribe never commits, and the master ships it under the sign-off rule below. That pull request has no issue of its own: it says `Refs #{{epic}}`, its `N` is the epic, and the phrase is `approved, sign off #{{epic}}`.

## Gate 5 — delivery

Once gate 4 passes, tell the maintainer the issue is ready, with both reports and the review level (diff or reports); set the Status to Review. The `ship-pr` skill is the procedure. Delivery rule of `master.md`:

- **The sign-off.** The rule is written once, in `.claude/agents/master.md` ("Delivery"): the exact phrase, a message of the maintainer's own, one commit per phrase, the identity check and who may run `git commit -s`. Without the phrase, the maintainer commits and the master pushes after they say so.
- The commit is `git commit -s -F <message file>`, with the message the worker left outside the worktree (it carries the `Co-Authored-By:` trailer). Before running it, the master quotes the maintainer's message that holds the phrase, checks that its `N` is this issue (the epic for the scribe's), and checks that `git var GIT_COMMITTER_IDENT` starts with `{{maintainer-ident}}`; if not, it stops and asks.
- After the pull request opens, replace only the text under `### Progress` of the issue, and tick the epic's box for it, with a script that edits that section and nothing else; save the body before and after and post both as a comment with `gh issue comment --body-file`. Never touch the title, the criteria or the scope.
- The `time: <minutes>m diff|report` line is the maintainer's, in a review comment on the pull request.
- The master never merges. When `gh pr view <n> --json state -q .state` prints `MERGED`, set Done, run `factory-tools metrics`, and tell the maintainer.

## Tokens

97% of a session's tokens are cache reads, which grow with context size times turns. So: the master reads only `summary.md`; workers are compacted before each round; verifiers run on Sonnet and reviewers on Opus; tool calls are batched and agents are waited on in the background; issues are frozen after gate 1; reviewers focus on changed hunks from round 2; a worker never runs its own reviewer or verifier.

## Session length

A master session ends after 4 merged pull requests, counted from its start. It then starts no new worker, reviewer or verifier. It waits for the agents still running, posts their gate comments and `tokens |` lines as usual, and closes their panes, so no name stays live. It adds to the `### Progress` of each issue in flight its worktree, its packet directory and its draft's path, then writes the issue's `updatedAt`, read after that edit, to `<packets>/<N>/freeze.txt`, which the next session compares as gate 1's freeze; it posts its own `tokens |` line on the epic (role `master`, round `-`; one line, when the session ends), tells the maintainer and exits. The maintainer starts a new session with `claude --agent master` and the same placeholders. It hands over nothing else: the next session starts from what GitHub and the packets hold, namely each issue's Status on the project and its `### Progress`, the gate comments, the open pull requests and `<packets>/<N>/`. Anything more the next session would need goes in that `### Progress` too, never in a free comment (it would be copied into `decisions.md`) and never left in the chat. No gate moves: the next session takes up an issue at the gate its Status and gate comments show, and runs any gate not yet posted. A later round starts a new worker with the issue, the packet and the findings: the worker of the ended session is gone.

## Report

To the maintainer, briefly: per issue, the gate it is at, the round, what is blocked and why.
