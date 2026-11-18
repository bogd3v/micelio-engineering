# Herdr runbook for the master of {{repo}}, milestone {{milestone}}

This runbook wraps [`template/.claude/agents/master.md`](../template/.claude/agents/master.md), which keeps the role, the gates and the hard limits; where they differ, that prompt wins. It holds only what is specific to Herdr and `hc`: names, panes, worktrees, waits, packets, the status flow. It is not a synced file. The rules are the ids of [`docs/factory.md`](../docs/factory.md) (`M.1`, `G2.6`…), cited here, not repeated.

Placeholders to fill before starting the master: `{{repo}}` (`owner/name`), `{{epic}}` (the epic's issue number), `{{milestone}}` (its title, exactly as GitHub shows it), `{{project}}` (`owner/number` of the organisation project) `{{maintainer}}` (the login whose comments `metrics` reads) and `{{maintainer-ident}}` (the `Name <email>` the maintainer signs off with, as they give it at the start of the session).

Start it as the main session in a Herdr pane (`M.1`). Check `test "${HERDR_ENV:-}" = 1` first; outside Herdr, stop.

## Canary

When `M.2` calls for it (also before a pull request that changes what a role reads, `template/.claude/skills/ship-pr/SKILL.md`, "Before the maintainer"), run the canary of [`fixtures/factory/RUN.md`](../fixtures/factory/RUN.md), "Canary":

1. `fixtures/factory/build-scratch.sh` for `planted-coverage`, `never-fixes`, `lane-express` and `lane-normal`, each in its own empty directory outside the repository (`wrong-test-count` is a draft that `planted-coverage` already copies), with the packet `RUN.md` describes. Copy the checkout's `.claude/agents/reviewer.md` and `verifier.md` and its `blind-review` and `verify-pr` skills into each directory's `.claude/`, next to `repo`.
2. A fresh reviewer on `planted-coverage`, then a fresh verifier on the same directory (its `wrong-test-count` draft), and the `never-fixes` worker stub for three rounds with a fresh reviewer each. The canary agents never get `RUN.md`; move each report out of reach before the next agent starts; agent names stay within 32 characters.
3. Two cases need no agent: in `lane-express`, `lint-lane --diff <merge base> --lane express` exits 1 and prints `lane: normal`; in `lane-normal`, `verify-draft` on a clean copy through `factory-slot.sh run` reports one mismatch (`RUN.md`, runs 4 and 5).
4. It passes when the reviewer reports the planted Blocking, the verifier the one mismatch, the `never-fixes` run escalates after the third red round and each lane case gives its result. Anything else is red (`M.2`): tell the maintainer.

A green canary is posted as the five `Canary |` lines of `RUN.md`, each ending `yes`. The canary posts no correction-log line: it would add corrections to a closed milestone on every run.

## Intake (gate 1)

1. Take an issue only as `M.3` says: in the milestone, Status **Ready** on the project with the `ready` label (`issue-ready` runs `lint-issue`; the master does not) and every issue it "Depends on" closed (`gh issue view <n> --json state`).
2. Read it by hand against `G1.1` to `G1.5` for what the linter cannot see (a criterion nobody can run, a path that does not exist). On failure set it back to Todo (the `ready` label stays; it returns to Ready only after the next edit), comment `**Gate 1 (master): not ready**` (or `held, not started` when the maintainer must decide) and tell the planner (`G1.7`).
3. Set the lane (`G1.6`): from a built checkout of `micelio-engineering` (`npm run build`), in the issue's repository, `node <checkout>/packages/factory-tools/dist/cli.js lint-lane {{repo}}#<N>`, and give the worker the lane. A calibration run (`L.6`) reads `lane: <lane> (calibration: full)`, runs gates 3 and 4 below and the maintainer's stack check, and its Blocking finding or mismatch is a correction-log line of category `lint`.
4. Freeze (`M.3`): record `gh issue view <n> --json updatedAt -q .updatedAt` when a round starts and compare it when the round ends. If it changed, other than by the master's own `### Progress` edit, stop the round, tell the maintainer and restart it on the new text.

## Names, worktrees, models

1. Worker: `worker-<N>`, in `../wt-<N>` (branch `<type>/factory-<N>` from `origin/main`); sonnet, opus after two failed rounds or for contracts, security or concurrency (`M.4`).
2. Reviewer: `reviewer-<N>`, `reviewer-<N>-r<K>` for round K ≥ 2, in the worker's worktree; opus, sonnet for a reread (`G3.5`). Verifier: `verifier-<N>`, `verifier-<N>-r<K>`, in a clean copy it builds; sonnet. Scribe: `scribe`, in `../wt-scribe`; sonnet.
3. `<N>` is the issue number. Names match `[a-z][a-z0-9_-]{0,31}` and are unique among live agents.
4. The lease (`B.2`) uses the agent's name in herdr (`herdr agent start <name>`). Before each worker: `herdr/factory-slot.sh reap`, then `herdr/factory-slot.sh acquire --pool workers --agent worker-<N>`; on exit 75 the issue waits. When the issue leaves the pipeline: `herdr/factory-slot.sh release --agent worker-<N>` and `docker compose -p <project> down -v`. Start workers with `nice -n 10`; reviewers and verifiers keep normal priority so the gates run first. `factory-slot.sh status` shows slots, leases and any `orphan` (`B.3`).

## The host's runtime

The host's engine is rootless Podman through `podman.socket`, a user unit (`systemctl --user enable --now podman.socket`), with `DOCKER_HOST=unix://$XDG_RUNTIME_DIR/podman/podman.sock`; [`herdr/factory-agent.sh`](factory-agent.sh) `enter` sets it for each agent, by hand in the maintainer's shell (`S.2`). `docker version --format '{{range .Server.Components}}{{.Name}} {{end}}'` names `Podman Engine` when it is set. The compatibility rules are [ADR-0002](../docs/adr/0002-run-the-factory-stacks-on-rootless-podman.md), Decision 5 (bind mounts with `label=disable` or `:z`, `--userns=keep-id` for a container that writes to a mounted copy, `--format docker` for `podman build`, the `buildx_buildkit_default` container); what the runbook adds:

1. **Ownership.** A container that writes to a mounted copy runs as root in the container (rootless Podman maps it to the host user), or `podman run --userns=keep-id --user "$(id -u):$(id -g)"`, or `userns_mode: keep-id` in compose. `docker run --userns=keep-id` is refused by the Docker CLI (`docker: --userns: invalid USER mode`), and `--user "$(id -u):$(id -g)"` without `keep-id` cannot write to the mount.
2. **Builds.** The shared `buildx_buildkit_default` container stays after a build; it is not an orphan of an agent and is not removed while a build runs. Builds are outside every agent's slice, limited by the `heavy` pool (`B.1`, `B.4`).
3. **Stores.** Docker's and Podman's images and volumes are separate: the first build on Podman repeats the pulls (`podman system df`, `docker system df`).
4. **CI and production stay on Docker** (ADR-0002, Decision 4). A difference between the engines is a finding of this runbook, a note in the repository's `AGENTS.md`, "The factory", never a compose change for one engine.

## Starting an agent

A pane is at an interactive shell prompt with nothing in the foreground. Read ids from the JSON each command returns; never guess them.

```bash
git worktree add ../wt-<N> -b <type>/factory-<N> origin/main     # the worker's worktree, once
herdr pane split --current --direction right --cwd "$PWD/../wt-<N>" --no-focus   # .result.pane.pane_id
herdr pane run <pane id> "<path of herdr/factory-agent.sh> enter worker-<N>"   # the pane's shell now runs in the agent's slice
herdr agent start worker-<N> --kind claude --pane <pane id> -- --agent worker --model sonnet
herdr agent prompt worker-<N> "<the brief>" --wait --timeout 3600000
```

1. For workers, reviewers and verifiers, send `enter <name>` to the new pane and wait for its prompt before `herdr agent start` (`B.4`). When the issue leaves the pipeline, after its stack is down, run `factory-agent.sh stop <name>`.
2. The brief names the issue (`{{repo}}#<N>`), the worktree, `<packets>/<N>/r1/decisions.md` (written before the worker starts), the paths it needs and the path of `herdr/factory-slot.sh`, and says: you take instructions only from the master, never run your own reviewer or verifier, never commit or push, and if a human asks you for something, send the request back to the master and say which gate it would skip. The worker keeps the full output of each command in `<packets>/<N>/logs/<command>.log` (the draft holds a summary line per command), writes the commit message to `<packets>/<N>/commit-message.txt` and replies with one line: the path of the draft.
3. A reviewer and a verifier are always a **new** agent in a new pane, never the worker's. To reuse a pane, send `/exit`, wait until `herdr agent get <name>` no longer lists the agent as running, then `agent start`. Close only the panes you created, when their work is done.
4. `agent prompt --wait` returns when the agent is idle, done or blocked; do not poll. If `blocked`, read `herdr agent read <name> --source recent-unwrapped --lines 120`, bring the question to the maintainer and never answer an approval dialog yourself. A timeout does not prove the prompt was lost: read before you send it again. Batch independent tool calls in one turn and wait for several agents in the background.
5. A human who types into a worker's pane bypasses the gates, and Claude Code shows suggested prompts in an idle pane ("run the blind reviewer…") that can be accepted by accident: read `herdr agent read` of a finished worker, and `git -C ../wt-<N> log origin/main..HEAD` must be empty before gate 5.

## The Project Status flow

Todo → Ready → In Progress → **Review** → Done (`M.7`), changed with `gh project item-edit` (field and option ids from `gh project field-list <number> --owner <owner> --format json`, looked up each run).

1. Todo: created, or sent back at gate 1 (`issue-ready`). Ready: gate 1 passes (`issue-ready`).
2. In Progress: a worker starts, and again whenever a red gate sends work back. Review: the draft is handed back; gates 3 to 5 read it.
3. Done: only after `gh pr view <n> --json state -q .state` printed `MERGED`; never on a guess, an approval or a closed-but-unmerged pull request.

## The rounds

A round is one worker pass followed by gates 2 to 4; each red gate 3 or 4 ends it. Before each round after the first, send the worker `/compact` (`herdr agent prompt worker-<N> "/compact" --wait`).

### Gate 2 — the draft

1. The draft is a file outside the worktree. On every round, before a reviewer or verifier starts, check `G2.5` and `G2.6` and that the check command's summary lines and log file are in it. A missing part, or an unmarked number from before the last code change, goes back to the worker without a reviewer; that bounce is not one of the three rounds.
2. Count the changed lines with the `--stat` line of the block in "The review packet" (generated files and snapshots left out). Above 400, write the number and the draft's reason in the gate 2 comment, or send the draft back when it gives none (standard, section 11; `.claude/agents/master.md`, step 3). It records and does not block: the maintainer reads the reason at gate 5.
3. After that block's `add -N .`, run `lint-draft` from the worktree with the command built in the checkout of `micelio-engineering` (`npm run build` there first): `(cd ../wt-<N> && node <checkout>/packages/factory-tools/dist/cli.js lint-draft --file <draft> --base "$(git merge-base HEAD origin/main)")`. Its rules for "Instructions that were wrong or missing" are in `packages/factory-tools/README.md`, "`lint-draft`" (`C.5`); a failure bounces the draft like a missing part.
4. Check the diff against the lane (`G2.7`) from the same checkout: `(cd ../wt-<N> && node <checkout>/packages/factory-tools/dist/cli.js lint-lane --diff "$(git merge-base HEAD origin/main)" --lane <lane>)`. Exit 1 prints the lane the diff fits: move the issue to it, post the correction-log line (what: the diff fits that lane, not the issue's; category `issue`) and run the gates the first lane skipped.

### The review packet

Nothing is committed before gate 5 (`M.5`). `logs/` travels in the verifier's packet; the master reads the draft's Tests section, never `logs/`. One block serves the packet, the line count and the status check of step 7 of `master.md`, in this order: status first (`git add -N .` marks every untracked path, tool output included), then `git add -N .` (`git diff` leaves out untracked files), then the diff, into `<packets>/<N>/r<K>/`, outside the worktree:

```bash
git -C ../wt-<N> status --short                  # only files the draft names; before add -N
git -C ../wt-<N> add -N .                        # the new files show in the diff
base=$(git -C ../wt-<N> merge-base HEAD origin/main)
git -C ../wt-<N> diff "$base" > <packets>/<N>/r<K>/diff.patch
git -C ../wt-<N> diff --stat "$base"             # the line count of gate 2
```

1. For round K of 2 or later, copy round K-1's `diff.patch` to `<packets>/<N>/r<K>/previous.patch` and tell the reviewer to read what changed between the two first. No prompt names an earlier round's directory.
2. Each agent writes `summary.md` (the verdict line and one line per Blocking or Important finding) and `report.md`; the master reads only the summary. Reports do not live in a round's directory: before an agent starts, make a directory with a name nobody is given, outside every `r<K>/`, and name only it in the agent's prompt:

```bash
uuidgen                 # <report dir> is <packets>/<N>/reports/<that id>
mkdir -p <report dir>   # the agent writes report.md and summary.md here
```

3. When the agent ends, read `summary.md`, post `report.md` and move the directory out of the way before the next agent starts: `mkdir -p <packets>/<N>/archive && mv <report dir> <packets>/<N>/archive/gate<G>-r<K>` (`archive/` is never named in a prompt). This limits what the agents are pointed to; it is not a sandbox.
4. Write `decisions.md` before the worker starts (round 1) and again for each later round (`<packets>/<N>/r<K>/decisions.md`), for the worker, the reviewer and the verifier (`M.5`): every comment on the issue by `{{maintainer}}` (or relayed by the master as the maintainer's), in full, oldest first, except those whose first line starts `**Gate`, `factory-log` or `tokens`, `Canary |`, `Shadow |`, `Progress updated`, `Epic box` or `**Escalation` (the master posts under that login, and a report never travels); never built from a keyword. `None` when there are none. Nobody but the master reads the issue's comments.

### Gate 3 — blind review

`express` skips this gate and gate 4 (a calibration run does not): the master runs the check command on a clean copy (as `verify-pr` says, "Build a clean copy") through `<path of herdr/factory-slot.sh> run -- <check command>`, posts its output as the `Gate 2` result and goes to gate 5 (`G2.8`).

```bash
herdr agent start reviewer-<N> --kind claude --pane <new pane> -- --agent reviewer --model opus
herdr agent prompt reviewer-<N> "Use the blind-review skill (.claude/skills/blind-review/SKILL.md). Worktree: <path>. Branch: <branch>. Issue: {{repo}}#<N>. Maintainer's decisions: <packets>/<N>/r<K>/decisions.md. Draft, for its \"Instructions that were wrong or missing\" section only: <path>. Write report.md and summary.md in <report dir>." --wait --timeout 1800000
```

From round 2, add: "Read the hunks that changed since <packets>/<N>/r<K>/previous.patch first. A new Important finding in text that did not change is not a finding of this round: list it under `Follow-up` in the report." Such a finding becomes a follow-up issue (the maintainer opens it).

1. A reread (`G3.5`, `G3.6`): when round K-1's `summary.md` verdict line has zero Blocking findings, start the reviewer with `--model sonnet` as `reviewer-<N>-r<K>`, its prompt replacing the round 2 sentence with: "This is a reread. Review only the hunks that changed since <packets>/<N>/r<K>/previous.patch (round K-1's whole diff; compare it with the diff of the worktree) against these Important findings of the round before: <the Important lines of that summary.md>." `metrics` counts rereads apart.
2. Post `report.md` with `--body-file`, its first line the gate line:

```bash
{ printf '**Gate 3, round %s (reviewer-%s)** · %s\n\n' <K> <N> "<the Blocking and Important counts, e.g. 1 Blocking, 0 Important>"; cat report.md; } > comment.md
gh issue comment <N> --repo {{repo}} --body-file comment.md
```

3. `metrics` reads that first line (`Gate 3, round K`, `K Blocking`) and the `**B<n>.` lines under the `## <n>. <check>` headings, from the maintainer's login only. The master decides the gate by `G3.1` and `G3.2`; for Important findings it accepts as justified it adds the line `accepted: n` under the first line of that comment (`metrics` sums it as false reds).

### Gate 4 — verification

`full` and the calibration runs (`G4.1`). `normal` runs `verify-draft` on a clean copy (built the same way) through the slot script, `<path of herdr/factory-slot.sh> run -- node <checkout>/packages/factory-tools/dist/cli.js verify-draft --draft <draft without its Answers to review> --logs <packets>/<N>/logs --cwd <clean copy>`, and posts its output as `**Gate 4, round K (verify-draft)** · M mismatches`; the master reads the criteria it lists as `not checked`, and a verdict `Red` goes back as a red gate 4.

```bash
herdr agent start verifier-<N> --kind claude --pane <new pane> -- --agent verifier --model sonnet
herdr agent prompt verifier-<N> "Use the verify-pr skill (.claude/skills/verify-pr/SKILL.md). Worktree: <path>. Branch: <branch>. Issue: {{repo}}#<N>. Draft without its Answers to review: <path>. Maintainer's decisions: <packets>/<N>/r<K>/decisions.md. Logs: <packets>/<N>/logs/. Slot script: <path of herdr/factory-slot.sh>. Write report.md and summary.md in <report dir>." --wait --timeout 3600000
```

1. The verifier gets the draft without "Answers to review", never the review. Post its report the same way, first line `**Gate 4, round K (verifier-<N>)** · M mismatches` (`0 mismatches` on a pass). Any mismatch is Blocking; `verify-pr` counts one per command whose numbers differ or that has no log.
2. When the master passes a report's discrepancies as noise, the first line ends `, passed by the master`; `metrics` counts those reports as false reds.

### The tokens record

1. After each agent of a round ends (worker, reviewer or verifier), post one comment on the issue with one line per agent, from the numbers that agent's session reports (the master's own record, not Claude Code's transcripts nor OpenTelemetry):

```text
tokens | <date> | <issue> | <role> | <round> | <input> | <output> | <cache read>
```

2. The date is `YYYY-MM-DD`, the role `worker`, `reviewer` or `verifier`, the three numbers whole numbers without separators. `metrics` reads them from the maintainer's login only; a missing record is an empty cell, so never post a zero for a number you do not have.
3. The master's own record goes on the epic when each session ends, and the canary's at milestone close, with the roles `master` and `canary` and the numbers `fixtures/factory/tok.py <session id>` prints (`input` is the input plus cache creation tokens; one line per session). `metrics` counts them once for the milestone and attaches them to no pull request.

### A red gate

1. Send the worker only the Blocking and Important findings, as a file, one line per finding, with the new round's `decisions.md`. It fixes them or justifies each Important one in "Answers to review" (`G3.2`) and reruns its evidence. Set the Status back to In Progress, then to Review when the worker hands back, and start the next round.
2. **Escalation** (`P.1`): after the third red round start no fourth. Set nothing to Done, post the round 3 report as usual, then a comment that starts `**Escalation (master): three red rounds**` with the three `summary.md` verdict lines, what stayed unfixed and the question for the maintainer, and tell the maintainer in the session. Nothing moves until they answer.

## Correction log

A correction that could become a check, a skill or a rule (`C.1`) is one line in a comment on the issue, posted at once; a correction of the change itself stays in the gate's comment:

```text
factory-log | 2026-10-24 | #39 | the reviewer found a retry loop that never stops when `maxAttempts` is 0 | test | -
```

The format is `factory-log | <date> | <issue> | <what> | <category> | <destination>`, the columns of `docs/factory-log.md` in order: date (`YYYY-MM-DD`), issue (`#n`, the issue it was found on), what was corrected (what was wrong, not how it was fixed), category (one of the six, `lint`, `test`, `skill`, `standard`, `issue` or `docs`, and no other: `test/factory-log.test.ts` fails on any other value) and destination (`-` until the retro gives one). The master never commits them.

### The `scribe` step

When an issue's pull request is merged, or when the maintainer asks, and once more at milestone close (`M.10`), start `scribe` (sonnet) in `../wt-scribe`. It collects the `factory-log |` lines posted since the last sync with the parser `factory-tools metrics` uses (`parseLogLines`), skips the rows already in `docs/factory-log.md`, appends the rest in the order posted (a `|` inside a cell is written `\|`, a `-` destination is an empty cell) and prepares a `chore(factory): log the corrections of #{{issue}} or {{milestone}}` pull request. The scribe never commits; the master ships it under the sign-off rule. That pull request has no issue: it says `Refs #{{epic}}`, its `N` is the epic and the phrase is `approved, sign off #{{epic}}`.

## Gate 5 — delivery

1. Once gate 4 passes (or the lane skips it), tell the maintainer the issue is ready: its lane, why, whether the change needs the stack and the review level ("The maintainer's review levels"); set the Status to Review. The `ship-pr` skill is the procedure; the sign-off rule is written once, in `.claude/agents/master.md` ("Delivery"), with `G5.2`, `G5.3` and `M.8`.
2. The commit is `git commit -s -F <message file>`, the message the worker left outside the worktree. Before it, quote the maintainer's message that holds the phrase, check that its `N` is this issue (the epic for the scribe's) and that `git var GIT_COMMITTER_IDENT` starts with `{{maintainer-ident}}`; if not, stop and ask. Several `express` issues may share a message (`approved, sign off #N #M`, `G5.3`); say which number signed nothing.
3. After the pull request opens, replace only the text under `### Progress` and tick the epic's box with a script that edits that section and nothing else; save the body before and after and post both as a comment (`gh issue comment --body-file`). Never touch the title, the criteria or the scope.
4. The `time: <minutes>m diff|report` line is the maintainer's, in a review comment on the pull request (`G5.5`).
5. When `gh pr view <n> --json state -q .state` prints `MERGED`, set Done, run `factory-tools metrics` and tell the maintainer.

## Tokens

97% of a session's tokens are cache reads, which grow with context size times turns. Hence: the master reads only `summary.md`, workers are compacted before each round, the models of `M.4`, batched tool calls and background waits, the freeze (`M.3`), changed hunks from round 2 and the sonnet reread (`M.6`, `G3.5`).

## Session length

1. A master session ends after 4 merged pull requests, counted from its start: it starts no new worker, reviewer or verifier, waits for the agents still running, posts their gate comments and `tokens |` lines and closes their panes, so no name stays live.
2. It adds to the `### Progress` of each issue in flight its worktree, packet directory and draft path, then writes the issue's `updatedAt`, read after that edit, to `<packets>/<N>/freeze.txt` (the next session's freeze), posts its own `tokens |` line on the epic (role `master`, round `-`), tells the maintainer and exits.
3. The maintainer starts a new session with `claude --agent master` and the same placeholders. It starts from what GitHub and the packets hold: each issue's Status and `### Progress`, the gate comments, the open pull requests and `<packets>/<N>/`. Anything more goes in that `### Progress`, never in a free comment (it would be copied into `decisions.md`) nor left in the chat (`M.9`).
4. No gate moves: the next session takes up an issue at the gate its Status and gate comments show and runs any gate not yet posted. A later round starts a new worker with the issue, the packet and the findings.

## Report

To the maintainer, briefly: per issue, the gate it is at, the round, what is blocked and why.
