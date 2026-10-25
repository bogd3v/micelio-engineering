# Agent team (micelio-engineering)

This repository's work runs through the Micelio factory ([`docs/factory.md`](../docs/factory.md)). The main session takes the role it was started as (usually master or planner); the prompts are in `.claude/agents/`, identical to `template/.claude/agents/`.

## Roster

| Agent      | Model  | Use it for                                                                                                             |
| ---------- | ------ | ---------------------------------------------------------------------------------------------------------------------- |
| `planner`  | opus   | With the maintainer: scope, the ADR of gate 0, the epic and its issues, the retro                                      |
| `master`   | opus   | One per milestone, run as the main session: gate 1, one worker per ready issue, the reviewer and the verifier after it |
| `worker`   | sonnet | One per issue, in its own worktree: the change, its evidence and the pull request draft                                |
| `reviewer` | opus   | Gate 3: a new agent that reviews the diff with no context from the worker                                              |
| `verifier` | sonnet | Gate 4: a new agent that re-creates the run below from a clean copy and reruns every reported command                  |

The model is chosen when the agent is started; the prompts do not fix it.

## What stands in for Docker

This repository has no Docker image; [`AGENTS.md`](../AGENTS.md) names the run that stands in for it and who runs it where.

## Hard limits (every agent)

- Never push, merge, tag, release or deploy, and never act on production or staging, without the approval of the human running the session (the maintainer); never read or print secrets.
- Never change a synced file under `template/` without saying why in the draft; then refresh its hash with `node scripts/synced-hashes.mjs` and copy it to the same path at the root (`test/factory-files.test.ts` checks it).
- Never weaken a check: no skipped tests, lowered thresholds, regenerated baselines or broad suppressions.

Per role:

- **Reviewer:** never edits or commits, never reads the worker's session, and does not compare numbers (that is gate 4).
- **Verifier:** never accepts a number it did not produce, never edits or commits, and never reads the worker's session or the reviewer's findings.
- **Worker:** never commits before gate 5 and never with a `Signed-off-by`; it gives the maintainer the `git commit -s` commands and pushes only after the maintainer confirms.
- **Master:** never changes what an issue asks for (status, labels and comments only) and never pushes or merges.
- **Planner:** never writes code; issues and ADRs need the maintainer's approval in the chat.

## Delegation rules

- Subagents start with no context: every delegation gives the goal, the issue number, the relevant paths, the constraints and the definition of done.
- Do not delegate trivia: a one-line edit or a question one file read answers.

## Language

Code, identifiers, commits, PR titles and descriptions in English (see `AGENTS.md`).
