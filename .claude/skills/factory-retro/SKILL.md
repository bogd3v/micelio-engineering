---
name: factory-retro
description: The retro of the Micelio factory - when a milestone closes, turn the corrections in the log that repeat into issue drafts, and list the skills and documents that have expired. Use when a milestone closes, or when asked to run the retro. It proposes and never creates an issue.
---

# Factory retro

This is the learning loop of the factory (`docs/factory.md` of `micelio-engineering`, "Retro per milestone" and "Expiry"). It runs when a milestone closes, in `micelio-engineering`, where the log lives. The skill proposes: it writes drafts and asks the maintainer. It never runs `gh issue create`. It edits `docs/factory-log.md` only at the end, as "Close" says.

## Read

1. `docs/factory-log.md` (or the log you were given): one row per correction, with Date, Issue, What was corrected, Category and Destination (the columns are in that file's header).
2. The numbers of the milestone: `npm run metrics --workspace packages/factory-tools -- --milestone "<title>"`. They show where the corrections came from (gate 1 returns, blocking findings by category). Keep the output: the Why may quote only what it shows.
3. The Task template, `template/.github/ISSUE_TEMPLATE/task.md`, and `packages/factory-tools/README.md` (the rules a draft must pass).

## Find what repeats

1. The input rows are every row of the log whose Destination is empty or starts with `single`, from any milestone. A row with `#n YYYY-MM-DD` was converted already, and one with `declined YYYY-MM-DD` was refused by the maintainer; neither is counted again. A row belongs to the milestone when its Issue does (`gh issue view <n> --json milestone`); the log has no milestone column. With a fixture, every row is of the milestone its header names; do not call `gh`. Group over all input rows, so a mistake made once per milestone is still seen when it repeats; use the rows of the milestone for the counts in "Report and ask".
2. Group the rows that describe the same mistake: the same wrong instruction, check or habit, whatever the issue. Read What was corrected, not the Category: the same mistake can be filed under two. Two rows are one mistake when one destination (the same check, prompt line or standard line) would have prevented both; name that destination when you group. When unsure, they are not.
3. A group of two or more input rows is a repeated correction. A row alone is not: do not draft anything for it. At "Close" it is marked `single YYYY-MM-DD`, and it counts again in the next retro, where a second row can join it.
4. A group already settled by an open issue is not drafted again; name that issue in the report.

## Choose the destination

The cheapest place that makes the mistake impossible, in this order (`docs/factory.md`, "Knowledge"):

1. A check: a rule in `@micelio/eslint-config`, a line in `lint-issue`, a contract test. This is a `chore(factory)` issue.
2. A skill, or a line in a role prompt or in a skill (`template/.claude/`). This is a `chore(factory)` issue; say that the file is synced and is fixed here (`docs/standard-sync.md`).
3. A line of the standard, only when it cannot be automated. This is a `docs(standard)` issue (section 16 of the standard).

## Write the drafts

One file per repeated correction, `<dir>/<short-topic>.md`; `<dir>` is `fixtures/factory/retro-out/` when you were given a fixture, otherwise the scratchpad directory. Each draft is a Task template body (`template/.github/ISSUE_TEMPLATE/task.md`) that passes `lint-issue`:

- The first line is `# <title>`, a conventional title: `chore(factory): …` or `docs(standard): …`. The rest is the body, with `Part of #<epic>.` under it when the milestone has an epic. Write no `Depends on` unless that issue is closed.
- **Why** quotes each log row as `Date #issue`, copying the date and the issue column exactly, then says what the rows have in common. Quote only numbers from the `metrics` output you ran; when you ran none (a fixture) or it shows nothing for this group, say so in the report (not in the draft) and write no count the log does not give.
- **What to build** names the file to change or create. **Requirements** says whether the change is breaking (section 7) and what stays true. **Acceptance criteria** has at least one item with the command or test that proves it, in backticks, and it is checkable by a test, not by judgement. It ends with the fixed maintainer item that gate 1 requires (`docs/factory.md`), worded for the repository: in `micelio-engineering` it is `Verified by the maintainer by reading the diff and the reports` and names the run `AGENTS.md` gives instead of Docker. `lint-issue` does not check this item; add it by hand.
- Cite at least one file path and one document (`docs/factory.md`, an ADR, a section of the standard). Add **Out of scope**, **Delivery** (the factory's: the agent proves the criteria, the blind reviewer and the verifier run, the maintainer reads the diff) and `### Progress` with `Nothing yet.`
- Check each draft: `npm run lint-issue --workspace packages/factory-tools -- --file <path from packages/factory-tools/>`. It must exit 0. A draft that fails is rewritten, not posted.
- Say how you produced the drafts at the end of the report, not in the draft.

## Expiry

List, without drafting anything:

- Skills no worker invoked in two milestones (the invocations are in the sessions' transcripts and in the pull requests' evidence; ask the master for them if you cannot read them). Name each, the milestones checked and the evidence; if you have no record, say so and list none.
- Documents of `docs/architecture/` of `micelio-engineering` untouched in two release lines: `git log -1 --format=%cs -- docs/architecture/<file>` against the date of the tag `vX.(Y-1).0` of this repository. Name each and its last change; if the repository has no such tag or directory, say so and list none.

Each is a candidate to delete or rewrite. The maintainer decides; old knowledge costs, so a candidate stays on the list until it is decided.

## Report and ask

Tell the maintainer, in this order:

1. How many rows the milestone has, how many had a Destination, how many are in a repeated group, how many stand alone.
2. Each draft: its title, the rows it covers and its path. Then the singles, which get no draft.
3. The expiry candidates.
4. The question: which drafts to create. Wait. Create nothing, comment on nothing, and edit nothing until the maintainer answers.

## Close

The retro ends when every input row of the milestone has a terminal Destination: `#n YYYY-MM-DD`, `single YYYY-MM-DD` or `declined YYYY-MM-DD`. After the maintainer answers and creates the issues:

- Fill the Destination of every row a created draft covers, from any milestone (a former `single` row that joined the group too), with the issue as `#n` and the retro's date after it (`#57 2026-11-02`).
- Fill the rows of a draft the maintainer declines with `declined` and the date. They are not counted again; a later row of the same mistake starts a new group.
- Fill each single of the milestone with `single` and the date. A `single` row counts again at the next retro.

A row of the milestone that is still empty is listed to the maintainer as open; do not report the retro as finished.

## Never

Create or edit an issue, push, merge or release; change the log before the maintainer confirms; count a single correction as repeated to make a draft; mark a row `single` before the maintainer confirms.
