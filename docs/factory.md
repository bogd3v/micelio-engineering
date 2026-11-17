# The Micelio software factory

The factory is the one path by which a plan becomes code on `main`, with a gate between every two stages. It runs the [engineering standard](engineering-standard.md); it does not replace it. Where this document and the standard disagree, the standard wins (section 1) and this document is fixed in the same pull request. An exception to the standard is an ADR, never a line here (section 16). Nobody may skip a stage, the agent that writes a change is never the one that reviews or verifies it, and every correction the maintainer makes once becomes a check, a skill or a rule.

A rule has an id (`G2.4`, `L.3`) that a prompt, a skill, `herdr/master.md` or a finding cites; `test/factory-docs.test.ts` checks that every id cited outside this document exists here. After an id, `[e]`, `[n]`, `[f]` (or `[e n]`) name the lanes it applies to (`express`, `normal`, `full`); no mark means every lane that runs the gate (its header says which), and a calibration run applies the `[f]` rules.

## The pipeline

Eight stages, seven gates, one loop: 1 Planner, gate 0, 2 Issue ready, gate 1, 3 Worker, gate 2, 4 Blind reviewer, gate 3, 5 Verifier, gate 4, 6 Maintainer, gate 5, 7 CI and approval, gate 6, 8 Merge into `main`. Nothing reaches `main` without passing the gates of its lane (["Lanes"](#lanes)).

- `P.1` A red at gate 3 or 4 sends the work back to the worker with the findings, and it goes through gates 2, 3 and 4 again. The third red round is the last: it goes to the maintainer instead of a fourth worker pass.
- `P.2` A problem the maintainer finds at gate 5 also goes back to the worker. An issue that fails gate 1 goes back to the planner; it is never handed to a worker half ready.
- `P.3` What the factory learns from each correction is [the learning loop](#the-learning-loop).

## Roles

Five roles and the maintainer, each a prompt in `template/.claude/agents/`: [planner](../template/.claude/agents/planner.md), [master](../template/.claude/agents/master.md), [worker](../template/.claude/agents/worker.md), [reviewer](../template/.claude/agents/reviewer.md) and [verifier](../template/.claude/agents/verifier.md). What each reads, produces and cannot do is in its prompt. The master starts the worker, the reviewer and the verifier, each as a new agent.

- `R.1` The reviewer and the verifier are two agents, not one with two steps: the one that compares numbers must not have read the findings.
- `R.2` A role loads only its own prompt, so each prompt stays under a word budget counted with `wc -w`; `test/factory-files.test.ts` ("each role prompt stays under its word budget") holds the numbers. Raising one needs the maintainer's approval in the pull request, and is never done to get green (standard, section 13).

## Lanes

[ADR-0003](adr/0003-route-each-issue-through-a-lane-set-by-its-risk.md) routes each issue through one of three lanes by its risk, and standard 2.3 (sections 11 to 13) writes them. `full` is the pipeline above, unchanged.

- `L.1` A repository whose `AGENTS.md` has no `## Lanes` block runs every issue as `full`.
- `L.2` What each lane runs (ADR-0003, Decision 7). `express`: no proof on the stack, no gate 3 (the check command stands in), no gate 4, the fixed criterion by reading the diff. `normal`: no proof on the stack, gate 3, gate 4 as `verify-draft`, the fixed criterion by reading the diff. `full`: every gate, the criteria proven on the stack.
- `L.3` A machine sets the lane at gate 1: `factory-tools lint-lane` (#234) reads the title's prefix and the paths the issue names and compares them with the globs of the `## Lanes` block of the repository's `AGENTS.md` (`stack:`, `contract:`, `express:`). A path that matches no glob never lowers the lane. Nobody lowers a lane by hand; the maintainer may raise one (Decisions 2, 4, 5 and 6).
- `L.4` `full` is a `!` in the title, a contract of section 6 of the standard, security or permissions, a migration or a schema, an image or a compose file, or anything an operator or an editor sees.
- `L.5` `express` is only non-normative Markdown, `.github/project-fields.json`, the version files of a `chore(release)` and the status line of an ADR. The standard, the profiles, `docs/factory.md`, `AGENTS.md`, `CLAUDE.md`, the role prompts, the skills and `herdr/` are normative and never `express` (standard, section 11); a change to `AGENTS.md` is at least `normal`. `normal` is everything else.
- `L.6` Calibration (Decision 8): an `express` or `normal` issue whose number is a multiple of 5 is a calibration run, so nobody chooses the sample, and the master writes `lane: <lane> (calibration: full)` in its `Gate 1` comment. The issue keeps its own lane (`lint-lane --diff` checks the diff against it, and `metrics` counts the run under it, marked as calibration) and runs every gate of `full`. A Blocking finding at gate 3, or a mismatch at gate 4, on a calibration run is a `factory-log |` line of category `lint` that names the glob of the `## Lanes` block to tighten.
- `L.7` The lanes say "the stack" and keep what [The stack](#the-stack) says (Decision 9); `metrics` reports per lane (Decision 10).

## The gates

A gate is a list evaluated by a machine, the maintainer, or an agent other than the author; gates 0 and 2 are the author's own check, confirmed by the maintainer and the master respectively. If one rule fails, the work does not pass. Each gate lists what passes it, then what fails it.

### Gate 0 · Decision

Before the epic is created; the planner, with the maintainer; every lane.

- `G0.1` The decision is not expensive to undo (standard, section 12), or its ADR exists, `Proposed` or `Accepted`, and the epic cites it.
- `G0.2` Fails: the decision is expensive to undo and has no ADR, or the epic does not cite it. No ADR, no epic.

### Gate 1 · Issue ready

Before a worker is started; the `issue-ready` workflow (#40), which runs `lint-issue` (#36) on the issue as `gh issue view` returns it, then the master, who takes only an issue on Ready with the `ready` label and reads it by hand against these rules. Every lane.

- `G1.1` The title has a conventional prefix, with `!` when it breaks a contract; the five parts of the task template (section 12) are present and not empty.
- `G1.2` Every acceptance criterion can be verified by a test or a command (section 12), apart from the fixed maintainer criterion; the issue names at least one path and one ADR or document, has an "Out of scope" line and a Delivery section.
- `G1.3` It has the fixed criterion of its lane (standard section 12): "Verified by the maintainer by reading the diff" in `express` and `normal`; in `full`, "Verified by the maintainer on the stack", or on the run the repository's `AGENTS.md` names instead ([The stack](#the-stack)). `lint-issue` checks it with its `lane` rule: exactly one such criterion, with the lane's sentence.
- `G1.4` Each criterion that describes behaviour names the test that proves it (`<test file> > "<test name>"`) or the command whose output is the criterion, which the worker creates and never edits (`lint-issue` does not check this; the master reads it).
- `G1.5` Every issue it "Depends on" is closed. For each file, command, fixture, permission, ADR amendment or behaviour a criterion or requirement names, the issue that creates it (any repository, open or planned) is in its `## Depends on` section (or on a `Depends on` line) as `owner/repo#n`, created in dependency order so that the number exists; an issue whose acceptance criterion cannot be run before another issue is merged names that issue.
- `G1.6` The master runs `lint-lane` on the issue (`packages/factory-tools/README.md`, "`lint-lane`") and writes `lane: <lane>` and the reasons it printed in its `Gate 1` comment (`L.3`).
- `G1.7` Fails: any rule is unmet. The issue stays in Todo without the `ready` label, with the report as a comment (`issue-ready` does this and moves a Ready issue back to Todo; the master only reads it). It never fixes the issue itself.
- `G1.8` Before a task issue's body is created or edited (the planner, or the master for its Progress text), it is written to a file (first line `# <title>`, then the body) and checked with `npm run lint-issue --workspace packages/factory-tools -- --file <path>` from a checkout of `micelio-engineering` (`--repo owner/repo`, the issue's repository, for every issue outside `micelio-engineering`); the issue is created or edited only at exit 0. The planner may also create it at exit 1 when `depends-on` is the only failing rule and each problem is `#n is open` for an issue in its `## Depends on` section or `Depends on` line (never "has no repository" or "could not be read"; `lint-issue` has no option to skip a rule): it stays without `ready` until those issues close and it is edited or given a milestone again, which runs `issue-ready`, because closing an issue does not re-lint its dependents ([`workflows.md`](workflows.md), "Limit: dependencies"). The epic's checkboxes are not linted, since an epic is not a Task; `issue-ready` keeps running on the created issue.

### Gate 2 · Worker self-check

Before the work goes to the reviewer; the worker, and the master checks the draft before it starts gate 3 or gate 4, on every round. Every lane.

- `G2.1` The check command (the `check:` line in the first `## Commands` block of `AGENTS.md`; else the manifest's `check` script, which is `npm run` and its name in a repository on Node) is green in the worktree.
- `G2.2` Every change of behaviour has a new test; user-facing strings are in `en` and `es`; new and changed exports have documentation comments; the documents the change made false are updated on the same branch.
- `G2.3` Every new guard, permission check or branch in code, and every fix of code behaviour, has a named test that fails without it, shown failing with the production lines reverted in a scratch copy, with the command and its output (a change that is not code writes `no test: not code`). The verifier reruns the tests the draft names on the merge base's code (`G4.2`).
- `G2.4` [f] The acceptance criteria are proven on the repository's stack.
- `G2.5` The pull request draft has Problem, What changes, For review, Tests with a summary line and a log file for every command, a section "Instructions that were wrong or missing", and what could not be verified.
- `G2.6` The "Tests" section (a summary line per command; the full output in the packet's `logs/`, which the master does not read) was rerun after the last code change: after every round that changes code the worker re-ran every command the draft reports and replaced each number with that run's output, or marked it as from an earlier round and named the round, and the section ends with the run of the final diff. The master checks this (an unmarked number is from the final run, an older one names its round; the runs shown failing without the change stay inline, with no log) before it starts a reviewer or verifier, on every round.
- `G2.7` The master runs `lint-lane --diff` on the worktree and never skips it. A diff that does not fit moves the issue, with a `factory-log |` line, to the lane it fits, and the gates the lane had skipped run; the master never lowers a lane.
- `G2.8` [e] After gate 2 the issue goes to gate 5 once the master has run the check command on a clean copy through `factory-slot.sh run`; its output is all the evidence it has.
- `G2.9` Fails: a check is red, a line of the Done list of section 11 is unmet, the draft lacks a section of `G2.5` or states a result without its summary line and log file, a new guard, check, branch or code fix has no test that fails without it, or its numbers come from a run before the last code change without saying so.
- `G2.10` [e n] In `express` and `normal` the worker reports the command that proves each acceptance criterion.

### Gate 3 · Blind review

After gate 2; the reviewer's findings, decided by the master. The reviewer is a new agent with no context from the worker. Nothing is committed before gate 5, so it reads the worktree against its merge base with `origin/main`, untracked files included. Lanes: `[n]` and `[f]`, and a calibration run of `express`; `express` skips it, the check command stands in.

- `G3.1` There are zero Blocking findings.
- `G3.2` Every Important finding is either fixed (the next round no longer raises it) or justified by the worker in the draft's "Answers to review", a section the verifier never reads; the master decides which.
- `G3.3` The reviewer checks in the order of section 11: correctness and edge cases; contracts and the version bump; security and permissions; tests that would fail without the change (a diff that edits an existing test, or a test the issue names, other than to add a case, without the issue asking for it, is Blocking); documents the change made false; scope.
- `G3.4` It also checks the draft's "Instructions that were wrong or missing": every wrong `AGENTS.md` or skill of the repository it names is corrected on the branch, and a wrong standard, synced file (the `files` of `.github/standard-sync.json`) or issue is reported to the master, as the draft says (section 13).
- `G3.5` A reread: a round that ends with zero Blocking findings is followed, when an Important one has to be fixed, by a new reviewer on the sonnet model, still with no context from the worker and never given the verifier's report, that reviews only the hunks changed since that round (the packet's `previous.patch` is that round's whole diff; the reviewer compares it with the current one) against that round's Important findings.
- `G3.6` A Blocking finding in round 1, or a new one in a reread, starts a full round, a new opus reviewer on the whole diff. The third red round goes to the maintainer either way (`P.1`).
- `G3.7` Fails: a Blocking finding remains, an Important one is neither fixed nor justified, or a wrong `AGENTS.md` or skill of the repository (not a synced file) that the draft names is not corrected on the branch.

### Gate 4 · Verification

After gate 3; the verifier, a new agent with no context from the worker that has not read the reviewer's findings. Lanes: `full`, on the stack from scratch; `normal` runs `verify-draft` (#236), a script that runs the draft's commands again on a clean copy, through `factory-slot.sh run`, and compares their numbers (the master reads the criteria it lists as `not checked`); `express` skips the gate; a calibration run of `normal` or `express` runs it as `full` does.

- `G4.1` [f] On the repository's stack re-created from scratch from a clean copy of the worktree (nothing is committed before gate 5: a fresh clone at the merge base, the worktree's diff applied with `--binary` and its untracked files copied, never its ignored files), every command of the draft's Tests section, except the runs shown failing without the change, gives the numbers the draft reports. Its summary lines are compared with the verifier's own run, and a command with no file in the packet's `logs/` behind it is a mismatch.
- `G4.2` [f] Every test the draft names as failing without the change fails on the merge base's code.
- `G4.3` A count is compared exactly. A figure the repository does not reproduce run to run (a coverage percentage, the failures of a known flaky test, the failures on `main`) is reported by the worker as the values of at least two runs and `k failed of n`, is checked against the repository's floor and written as `variance`, not as a mismatch.
- `G4.4` [f] Every acceptance criterion is shown to hold; everything the draft says was not verified has been tried, and the outcome is written down.
- `G4.5` Fails: a count differs from the reported one, a command has no log in the packet's `logs/`, a named test passes on the merge base's code, or a varying figure is below its floor or was reported as one exact value (always Blocking: the worker reported something that did not happen), a criterion does not hold, or a command cannot be run as written.

### Gate 5 · Delivery

After gate 4; the maintainer, through the `ship-pr` skill (`template/.claude/skills/ship-pr/`). Every lane. The maintainer reads the whole diff in all of them; the master tells them the lane, why (the reasons `lint-lane` printed) and whether the change needs the stack.

- `G5.1` The maintainer has done the review level of ["The maintainer's review levels"](#the-maintainers-review-levels) and has read the whole diff (section 11), and has tested on the stack whatever an operator or an editor sees.
- `G5.2` The maintainer has typed `approved, sign off #N` for this issue (for the epic, on a pull request with no issue) in a message of their own in the master's session, after the master presented the diff. The master then checks that `git var GIT_COMMITTER_IDENT` is the maintainer's name and email and runs `git commit -s -F <message file>` (the message the worker left in a file), or the maintainer has run that commit themselves.
- `G5.3` [e] Several issues may share one message, `approved, sign off #N #M`, typed after the master presented each of those diffs: each number approves one commit, once, and a number whose issue is not `express` when the message is typed signs nothing, and the master says so.
- `G5.4` The pull request was pushed and opened only after that confirmation. If the branch was rebased the push uses `--force-with-lease=<branch>:<sha>`.
- `G5.5` The approval carries a line `time: <minutes>m diff|report` (the order read first, per lane in the review levels); when the maintainer's own account opened the pull request GitHub allows no approval, and the line goes in a review comment (`gh pr review <n> --comment -b "time: 10m diff"`).
- `G5.6` Fails: the maintainer finds a problem (it goes back to the worker and into the correction log), or the work was committed without the maintainer's sign-off or pushed without the confirmation.

### Gate 6 · CI and merge

On the open pull request (sections 11 and 15); CI, then the maintainer. Every lane.

- `G6.1` The required checks and the DCO are green, the maintainer has approved, and the issue's Progress section is updated (the master does it, from the worker's text, when the pull request opens).
- `G6.2` Fails: a required check is red (never merged around), a commit lacks its `Signed-off-by`, or Progress is not updated. No bot merges.

## Running the master

[`herdr/master.md`](../herdr/master.md) is the Herdr runbook of the master. It wraps `template/.claude/agents/master.md`, which keeps the role and its limits, and adds only the Herdr steps; it is not a synced file.

- `M.1` The master runs as the main session in a Herdr pane (`claude --agent master`); a subagent cannot start agents.
- `M.2` Canary: the first step of a milestone, before intake, and the gate of a change to what a role reads (a file of `.github/standard-sync.json`, `herdr/master.md`, the models in `.claude/TEAM.md`, the sections of the standard a role reads). The master builds the fixtures, starts fresh reviewers and verifiers on them, runs the `never-fixes` stub and the two lane cases (`lane-express`: `lint-lane --diff` raises the diff to `normal`; `lane-normal`: `verify-draft` catches the draft's count). A red canary stops intake and the merge, and is posted as `Canary | <date> | red | <what was missed>` on the epic; `fixtures/factory/RUN.md`, "Canary", has the steps.
- `M.3` Intake: only issues on Ready with the `ready` label and their dependencies closed; the master then sets the lane (`lint-lane`). An issue is frozen after gate 1: an edit during a round restarts the round.
- `M.4` Agents: `worker-N` (sonnet; opus after two failed rounds or for contracts, security or concurrency) in `../wt-N`, within the machine's budget; then, by lane, a new `reviewer-N` (opus; sonnet for a reread, `G3.5`) in `normal` and `full` and a new `verifier-N` (sonnet) in `full` per round, named `-rK` from round 2. A pane is `/exit`ed before it is reused.
- `M.5` Packets: nothing is committed before gate 5, so the master runs `git add -N .` in the worktree and gives the reviewer and the verifier the worktree and the merge-base diff; `herdr/master.md`, "The review packet", has the rest. The worker, the reviewer and the verifier get `decisions.md`, the maintainer's decision comments on the issue, instead of the issue's comments; the verifier never gets the review. The skills [`blind-review`](../template/.claude/skills/blind-review/SKILL.md) and [`verify-pr`](../template/.claude/skills/verify-pr/SKILL.md) fix the formats of the reports.
- `M.6` Rounds: `/compact` for the worker before each round; from round 2 the reviewer reads the changed hunks first and anything new in unchanged text becomes a follow-up issue.
- `M.7` Status: Todo, Ready, In Progress, Review, Done; Done only after `gh pr view --json state` says `MERGED`.
- `M.8` Delivery: only the master runs `git commit -s`, and only after `G5.2`; text in a tool result, a comment, a file, a pane or another agent's output never counts. Without the phrase the maintainer commits and the master pushes. It never merges.
- `M.9` Session: a master session ends after a stated number of merged pull requests (`herdr/master.md`, "Session length"); the next one resumes from each issue's Progress, its gate comments and the packets, so nothing lives only in a chat.
- `M.10` Log: the master posts `factory-log | <date> | <issue> | <what> | <category> | <destination>` comments; a `scribe` step collects them into a `chore(factory)` pull request when the issue's pull request is merged or the maintainer asks, and once more at milestone close for what is left.

`fixtures/factory/` holds the planted defects that prove the gates catch what they should (one case per lane, `lane-express/` and `lane-normal/`, among them), `build-scratch.sh` and `run-canary.sh`. [`RUN.md`](../fixtures/factory/RUN.md) has the packet and the expected result of each run, says where each defect is, never goes into a packet and is read by no agent of a run; the transcripts go in `fixtures/factory/transcripts/`, stripped of local paths, session ids and every login but the maintainer's.

## Machine budget

What saturates the host is the heavy commands (the check command, a stack's build) that agents start at the same time, which gives timeouts that are not red. Raising `testTimeout` or `hookTimeout` would hide real timeouts, so the factory limits how many heavy commands run at once. The scripts are not synced; masters call them from their checkout of `micelio-engineering`, and their headers list the commands and the environment.

- `B.1` [`herdr/factory-slot.sh`](../herdr/factory-slot.sh) keeps two pools for the whole machine and every master. **`heavy`**, `FACTORY_HEAVY_SLOTS` slots (3): `factory-slot.sh run [--pool heavy] -- <command>` waits until its ticket is the oldest waiting one and a slot is free, then runs the command in its own process group (free slots go to waiters in the order they arrived; an owner file records the PID, process group, agent (`FACTORY_AGENT`, else `HC_TERMINAL_ID`), start time and command) with `VITEST_MAX_WORKERS` set to `FACTORY_CORES` (`nproc`) divided by the size of the pool, at least 1 (the `vitest.config.ts` of this repository and of `template/` read it as `maxWorkers`; other test runners take it as their own option, Jest's `--maxWorkers`). The exit code is the command's. The worker runs the check command once, at the end, through `run`; the verifier runs the check command and the stack's build through `run`. The master's brief to each carries the path of the script, since a worktree of another repository has none.
- `B.2` **`workers`**, `FACTORY_WORKER_SLOTS` leases (6, two per milestone with three in parallel): `acquire --pool workers --agent <name>` (`<name>` is the agent's name in herdr-core) exits 75 without writing when the pool is full; `release --agent <name>` gives it back. The master acquires before it starts a worker, releases when the worker's issue leaves the pipeline, and then brings the issue's stack down (`docker compose -p <project> down -v`). Reviewers and verifiers take no lease.
- `B.3` `reap` removes the owner files of dead PIDs. For an agent it asks herdr-core (`hc get <agent> --json`): only `finished` (exit 0) or `not_found` (exit 3) has ended, and `reap` then kills the process group (SIGTERM, SIGKILL after 10 s) and removes the file; any other answer leaves the file and prints `unknown <file>`. Any answer but those, `hc` missing included, leaves the file, so a broken check never kills a running command. A lease younger than `FACTORY_REAP_GRACE` seconds (300) is kept, since the master acquires it just before it starts the agent. `status` prints one line per slot and lease (pool, slot, agent, PID, start, command, `alive` or `dead`), then one `orphan` line for each process whose working directory is under `FACTORY_TMP` and that belongs to no slot. `reap` never kills an `orphan`: the master raises it with the maintainer. The script needs only bash, `flock`, `ps`, `setsid` and coreutils, and never names the container runtime; `FACTORY_SLOT_DIR` (default `~/Git/factory/run/slots`) holds the files.
- `B.4` **The slice of each agent.** [`herdr/factory-agent.sh`](../herdr/factory-agent.sh) `enter <agent>` (`[a-z][a-z0-9_-]{0,31}`) gives the agent the slice `factory-<agent>.slice` (each `-` turned into `_`, a child of `factory.slice`) with `MemoryMax=${FACTORY_AGENT_MEMORY:-10G}`, `MemorySwapMax=0` and `CPUQuota=${FACTORY_AGENT_CPU:-800%}`, and runs the pane's shell in it with `DOCKER_HOST` set to `podman.sock`, `FACTORY_AGENT`, `FACTORY_SLICE` and a `docker` shim first on `PATH`. The shim (`factory-agent.sh docker -- <args>`) asks the real `docker compose` for `config --services` with the same global options and writes `override-<hash>.yml` under `FACTORY_AGENT_DIR` (default `~/Git/factory/run/agents`, one directory per agent) with `cgroup_parent: <slice>` on those services, added as the last `-f` (or appended to `COMPOSE_FILE` when that is set and no `-f` is given; when neither is given, it finds the file Compose would use, with its override, and passes those and the override as `-f`); for `run` and `create` it adds `--cgroup-parent=<slice>` unless one is given; everything else, and every call when `FACTORY_SLICE` is unset, goes to `FACTORY_DOCKER` (default `/usr/bin/docker`) unchanged, with its exit code. A repository's compose file and service names are read, never changed. `stop <agent>` removes the agent's directory and brings no stack down. It never limits the master's own session; builds stay in the shared BuildKit container, limited by the `heavy` pool.

## The maintainer's review levels

The lane sets what the maintainer reads first (the order the `time:` line records; ADR-0003, Decision 7):

1. **`express`: the diff.** It has no reviewer's or verifier's report, only the check command's output (`time: … diff`).
2. **`normal`: the reviewer's report, then the diff.** The maintainer starts from the reviewer's report, `verify-draft`'s output and the description (`time: … report`).
3. **`full`: the two levels of today.** A pull request that touches a contract of section 6, security or permissions, a migration, or carries a `!`: the diff first, then the reports (`diff`). Every other `full` pull request: the reviewer's and the verifier's reports and the description first, then the diff (`report`).
4. **Spot check.** One pull request in five of the second and third levels is checked line by line against its reports, to see whether the reports can be trusted. It is not the lane calibration of ADR-0003, Decision 8 (`L.6`), which sends one pull request in five of `express` and of `normal` through every gate of `full`.

These levels do not relax section 11 of the standard: the risk sets the order, and the maintainer reads the whole diff at gate 5, before the sign-off.

## The stack

The stack is the repository's images and compose files, on the container engine of the machine it runs on.

- `S.1` The worker proves its acceptance criteria on the repository's stack before gate 2; the verifier re-creates it from scratch from a clean copy of the worktree and runs the check command and the suites again there at gate 4; the maintainer tests on it what an operator or an editor sees (the admin UI, variables, migrations, Compose). All three in the `full` lane only. The rest is covered by the integration test on the stack when a milestone closes.
- `S.2` On the factory host: rootless Podman, reached by the same `docker compose` through `podman.socket` ([ADR-0002](adr/0002-run-the-factory-stacks-on-rootless-podman.md); the host's rules are in [`herdr/master.md`](../herdr/master.md), "The host's runtime"). In CI and production: Docker, and CI is the contract (ADR-0002, Decision 4).
- `S.3` A repository without a stack of its own names in its `AGENTS.md` the run that stands in for it.

## The learning loop

The factory only gets faster if every correction made once stops being needed. Principle 1 and section 13 of the standard already say so; here it is a stage with an owner.

- `C.1` **Correction log.** Every time the maintainer, the reviewer or the verifier sends work back with a correction that could become a check, a skill or a rule (a wrong instruction, a missing test, a step done by hand twice, an issue that named the wrong thing), the master posts one line `factory-log | <date> | <issue> | <what> | <category> | <destination>` in a comment on the issue, at once: category is lint, test, skill, standard, issue or docs, and destination is `-` until the retro gives one. A correction of the change itself (a wrong line of code, a missed case the issue and the instructions already covered) stays in the gate's comment and gets no line. The `scribe` step of [`herdr/master.md`](../herdr/master.md) collects the lines into a `chore(factory)` pull request that appends them to [`docs/factory-log.md`](factory-log.md) (#38).
- `C.2` **Retro per milestone.** When a milestone closes, the planner reads the log and, for each correction seen twice, proposes a check (an ESLint rule in `@micelio/eslint-config`, a contract test, a line in `lint-issue`), a new or corrected skill, or a line in the standard, each a `chore(factory)` or `docs(standard)` issue. The retro ends when every line of the log has a destination and a date.
- `C.3` **A procedure done twice** becomes a skill in the same milestone, with the commands that were run.
- `C.4` **Shared terms.** `test/factory-steps.test.ts` holds a table of the terms the factory's steps share against the files that must name each.
- `C.5` **Instructions stay true.** A worker that finds `AGENTS.md` or a skill of its own repository wrong corrects it in its pull request (section 13), and the reviewer checks it did. A wrong standard is reported to the master, who passes it to the maintainer to open a `docs(standard)` issue in `micelio-engineering` (section 16). The same goes for the synced files (`.github/standard-sync.json`; `docs/standard-sync.md`): they are fixed in `micelio-engineering` and, from any other repository, reported to the master, because a fix on the branch fails `lint:standard` and the next sync puts the file back. Each line of the draft's section has one shape, `<path or "standard" or "issue">: <what is wrong> - fixed in <path> | reported to the master`: a path of the repository's own `AGENTS.md` or skills ends `fixed in`, and the file is in `git diff --name-only`; the standard, the issue and, outside `micelio-engineering`, a synced file end `reported to the master`; in `micelio-engineering` a synced file is fixed under `template/` and ends `fixed in template/<path>`. The reviewer raises as Important a line that ends `fixed in` a file the diff does not touch, or an own file that ends `reported`; `lint-draft` checks the shape.
- `C.6` **Nothing lives only in a chat.** What the planner and the maintainer decide goes into an ADR or a document of the repository before the epic is created. A worker never depends on a conversation it was not part of.

## Knowledge

Every kind of learning has one destination, and the destination decides who reads it and when: rules load in every session, procedures and explanations are read on demand.

- `K.1` A rule that must always hold: a check (`@micelio/eslint-config`, `lint-issue`, a contract test), the standard only when it cannot be automated; written by a `chore(factory)` issue from the retro, at the second correction.
- `K.2` A convention of one repository: that repository's `AGENTS.md`, written by the worker who found it, in its pull request, in the same issue. A procedure that was repeated: a skill in `.claude/skills/` with the commands that were run, written by the worker in the same milestone, at the second run. How a subsystem works: `docs/architecture/`, written by the worker who built it, in the pull request that builds it.
- `K.3` A decision that is expensive to undo: an ADR, or a new ADR that supersedes one, written by the planner with the maintainer, before the epic. A plan, a scope, a half-formed idea or a retro note: the maintainer's notes outside the repositories, then an ADR, a document or the epic, by the planner with the maintainer, before the issues are created. A correction by the maintainer, reviewer or verifier: a `factory-log |` comment, then `docs/factory-log.md`, one line, by the master and then the `scribe`, at once, and the file when the pull request is merged. An answer given twice in Discussions: `docs/`, in the folder of the reader who asked (section 12), by whoever answered, when the discussion closes.
- `K.4` The pull request asks for the learning: its section "Instructions that were wrong or missing" says what in `AGENTS.md`, the skill or the issue failed the worker. "Nothing" is a valid answer; a missing section is not.
- `K.5` Expiry: a skill no worker used in two milestones, and a document of `docs/architecture/` untouched for two release lines, come up in the retro to be deleted or rewritten.
- `K.6` Markdown in the repositories is plain GitHub Flavored Markdown: no wikilinks or editor-specific properties.

## Metrics

Taken from GitHub by `factory-tools metrics` (#38), which the master runs when an issue closes; [its README](../packages/factory-tools/README.md#metrics) has the columns, the sources, the `time:` line format and how each number is read. The metrics, per pull request and per lane (ADR-0003, Decision 10), are listed there.

The pilot's target: under two maintainer corrections per pull request, and zero verifier discrepancies over the last five issues of the milestone.

## Where each piece lives

Everything shared lives in this repository, and each repository imports it and adds only its own (`AGENTS.md`, "Structure"); gate 1 is `lint-issue` and the `issue-ready` workflow, the retro is the `factory-retro` skill (`.claude/skills/factory-retro/`), and the pull request template's learning section and `ship-pr` are in `template/`. The factory follows the standard itself: every script has tests, every skill is written like the others, and a change to the factory is a `chore(factory)` issue in this repository.
