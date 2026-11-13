# @micelio/factory-tools

The commands of the Micelio software factory: `lint-issue` (Gate 1, the Definition of Ready, as a
script), [`issue-ready`](#issue-ready) (what the workflow does with its result, and the project fields of
`project-fields-backfill`),
[`metrics`](#metrics) (the factory's numbers for a milestone), [`lint-draft`](#lint-draft) (the
shape of a draft's section "Instructions that were wrong or missing"),
[`lint-lane`](#lint-lane) (an issue's lane, and a diff checked against it) and
[`verify-draft`](#verify-draft) (gate 4 of the `normal` lane: a draft's commands rerun and their
numbers compared).

## lint-issue

It checks a task against the rules below (section 12 of the engineering
standard, "Decisions and planning", and the Task template
`template/.github/ISSUE_TEMPLATE/task.md`) and prints a Markdown report that can be posted as an
issue comment.

```bash
# From this repository, until the package is published
npm run lint-issue --workspace packages/factory-tools -- bogd3v/micelio#729
npm run lint-issue --workspace packages/factory-tools -- --file test/fixtures/pass.md

# Once published
npx @micelio/factory-tools lint-issue bogd3v/micelio#729
```

A target `owner/repo#n` is read with `gh issue view --json title,body`, so `gh` must be installed
and signed in. `--file <path>` reads a Markdown file instead: the first line is `# <title>`, the
rest is the body; add `--repo owner/repo` when its "Depends on" names a bare `#n`. The exit code is
0 when every rule passes, 1 when one fails, 2 when the arguments are wrong or the issue cannot be
read.

The report starts with `lane: <lane>`, the lane of the issue (`lint-lane`'s function, from the
`## Lanes` block of the `AGENTS.md` of the issue's own repository, read with `gh api`; with `--file`,
from the `AGENTS.md` at the root of the repository the command runs in; with no such file or block
the lane is `full`), so the `issue-ready` comment shows it.

```text
lane: full
**lint-issue** · `bogd3v/micelio#729` · 2026-10-24 · 1 of 8 rules fail

- `depends-on`: depends on bogd3v/micelio-plugin-core#44 is open.
```

### Rules

| Rule           | Passes when                                                                                                                                                                                                                                                                |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `title`        | The title starts with a type of the Task template (`feat`, `fix`, `docs`, `refactor`, `style`, `test`, `ci`, `perf`, `chore`), an optional `(scope)` and `: `; with a `!` before the colon when a line or list item of the body starts with `BREAKING CHANGE:` (section 7) |
| `task-parts`   | The five parts of a task are headings with something under them: Why, What to build, Requirements, Acceptance criteria, Progress. HTML comments and empty bullets left by the template do not count                                                                        |
| `criteria`     | At least one item of "Acceptance criteria" names a command, a test or a file: it contains a backtick or `npm run`                                                                                                                                                          |
| `citations`    | The body, outside HTML comments, cites a file path (`a/b.ts`, `dir/`, `AGENTS.md`; not a URL, nor `Node.js`) and an ADR or document: `ADR-n`, a `.md` file or a path under `docs/`, or a section of the standard                                                           |
| `out-of-scope` | There is a non-empty "Out of scope" section, or a line outside code that starts with "Out of scope" and says something                                                                                                                                                     |
| `delivery`     | There is a non-empty "Delivery" section                                                                                                                                                                                                                                    |
| `depends-on`   | Every issue listed after "Depends on" (up to the end of that sentence) or in a "Depends on" section, is closed (`gh issue view --json state`). A bare `#n` belongs to the issue's repository                                                                               |
| `lane`         | Exactly one item of "Acceptance criteria" starts "Verified by the maintainer", and it reads "by reading the diff" in `express` and `normal`, or "on the stack" (or "on the run `AGENTS.md` names") in `full`. The report names the lane and the sentence it expected       |

Headings are matched at any level, ignoring case, emphasis and a trailing colon, by their name or
a name that starts with it as a whole word (`## Why this matters`, `## Out of scope (see #40)`).
A section runs to the next heading of the same or a higher level, so a part may have
subheadings, but the parts and the "Out of scope", "Delivery" and "Depends on" sections never
nest (`### Progress` under `## Delivery` ends it). HTML comments are ignored everywhere, so the
template's guidance cites nothing; `BREAKING CHANGE:`, "Depends on" and an "Out of scope" line are
also ignored inside fenced code blocks. After "Depends on" only the list up to the end of its
sentence counts (`Depends on #35. Part of #34.` depends on #35 alone). Setext headings (`Why`
over `===`) are not recognised.

`test/fixtures/` has `pass.md` and one `fail-<rule>.md` per rule; `fail-depends-on.md` names a
bare `#3`, so read without `--repo` it fails offline. `test/fixtures/builder-fase-1/` holds the
first run on the milestone "Micelio · Builder, fase 1 — Vista previa": each issue's body as read
that day (`<repo>-<n>.input.md`) and its report (`<repo>-<n>.md`). A test runs the offline rules
on each body and compares them with the report.

## `issue-ready`

Turns the result of `lint-issue` into a label, a comment and a project Status; the `issue-ready`
workflow (`docs/workflows.md`) runs it with the Micelio bot's token in `GH_TOKEN`.

```bash
factory-tools issue-ready <owner/repo#n> --passed <true|false> --report <file> \
  --project <owner/number> --author <login> --association <author_association> --state <open|closed> \
  [--ready-status Ready] [--not-ready-status Todo] [--project-fields <file>]
```

An issue that is closed, or whose author is not an `OWNER`, `MEMBER` or `COLLABORATOR`, is skipped
(`skipped: …`, exit 0). A pass adds the issue to the project and sets Ready; a fail never adds it
and only moves a Status that is Ready back to Todo.

With `--project-fields` (the workflow passes `.github/project-fields.json` of this repository), it
then sets the item's `Release line` and `Front` from the entry of the issue's milestone, only where
the field has no value:

```json
{
  "Micelio · Corte 0.7 — El sitio y el fediverso": {
    "releaseLine": "0.7",
    "front": "Plugin core",
    "frontByRepository": { "micelio-plugin-fediverse": "Fediverse" }
  }
}
```

The key is the milestone title, compared exactly; `frontByRepository` maps a repository name,
without the owner, to the Front it gets instead of `front`. A milestone with no entry, an issue with
no milestone or one not in the project prints `fields left alone: …` and changes nothing.

`factory-tools project-fields-backfill --milestone <title> --project <owner/number> --project-fields <file> --repositories <name,name,…>`
applies the same rules to every open issue of the milestone in those repositories, after reading
every field, option and issue; the `project-fields-backfill` workflow runs it (`docs/workflows.md`).

It prints one line per change and exits 0, or 2 with the reason (for example a Status option the
project does not have, or a Release line or Front option a milestone's entry names; nothing is changed then). The logic is tested against recorded API
responses in `test/fixtures/ready/`, with no network.

## `lint-draft`

Gate 2 reads the draft's section "Instructions that were wrong or missing" with this command. The
shape is in `docs/factory.md`, "The learning loop".

```bash
# In the worktree of the branch, after `git add -N .` so that new files are in the diff
node <checkout>/packages/factory-tools/dist/cli.js lint-draft --file <draft> --base "$(git merge-base HEAD origin/main)"
```

It reads the section (the lines under that heading, up to the next heading; a leading `-` is
ignored) and the `files` of `.github/standard-sync.json` of the `micelio-engineering` checkout the
command was built in (the target repository has none), and lists
the lines that break a rule. Exit 0 when none does, 1 when one does, 2 when the arguments are wrong
or a file cannot be read.

- `Nothing` passes.
- A line that ends `fixed in <path>` fails when `git diff --name-only <ref>` lacks the path. In
  `micelio-engineering` a synced file is fixed under `template/<path>`, which is in the diff, so it
  passes.
- A line whose subject is `issue` or `standard` (case ignored) fails when it ends `fixed in <path>`,
  whatever the diff holds: they are reported to the master.
- A line whose subject is a synced file fails when it ends `fixed in <path>` and the path is not
  `template/<subject>`: outside `micelio-engineering` it is reported, inside it the fix is under
  `template/`.
- A line whose subject is an own file, `AGENTS.md` or a skill under `.claude/skills/` that
  `standard-sync.json` does not list, fails when it ends `reported to the master`. The standard, the
  issue and a synced file (outside `micelio-engineering`) end `reported to the master` and pass.
- A line in neither shape, a missing section and an empty one fail.

It does not judge whether a "Nothing" is true.

## `verify-draft`

Gate 4 of the `normal` lane (ADR-0003, D7, `docs/adr/0003-route-each-issue-through-a-lane-set-by-its-risk.md`)
is this script instead of the verifier agent: it reruns the commands of a draft's Tests section and
compares their numbers. The `full` lane keeps the verifier (`docs/factory.md`, gate 4).

```bash
node <checkout>/packages/factory-tools/dist/cli.js verify-draft --draft <draft> --logs <packet>/logs --cwd <clean copy>
```

`--logs` may be left out (below).

Nothing is committed before gate 5, so `--cwd` is a clean copy: a fresh clone at the merge base with
the worktree's diff applied (`.claude/skills/verify-pr/SKILL.md`, "Build a clean copy"), and the
master runs the command through `herdr/factory-slot.sh run`. `--cwd` defaults to the current
directory. The script never builds or starts a stack and never names an engine: a draft whose
commands need the stack belongs to `full`.

**What it reads.** The items of the draft's `## Tests` section, bullets (`- `, `* `) and numbered
items (`1. `, `1) `, any number), up to the next heading of the same or a higher level. An item that
starts with a command in backticks is a command, and the rest of
the line is its summary:

```text
- `npm test`: exit 0, 23 test files, 482 passed (`logs/npm-test.log`)
```

- `exit <n>` is the expected exit code.
- Each `<n> <word>` is a figure: the output of the run must hold the same `<n> <word>` (`482 passed`
  matches `Tests  482 passed (482)`; a label before the number counts too: `23 test files` matches
  `Test Files  23 passed (23)`, `482 tests` matches `Tests  482 passed (482)`). Thousands may be written with a space or a comma. `round <n>`
  and anything in backticks are not figures.
- `<k> failed of <n>` marks a figure the repository does not reproduce: the command runs `n` times,
  the number of runs with a non-zero exit is compared as `variance`, and the exit code is not; with
  no log and with `--logs` it is a mismatch, as any command.
- `logs/<file>` names the file of `--logs` that holds the full output; a command with no such file
  is a mismatch. `--logs` is optional: without it (a pull request's CI has no `logs/` directory) a
  command with no log is not a mismatch, and the output has a line `logs: not checked` before the
  verdict.
- A command run through the slot script, `<path>/factory-slot.sh run -- <command>` (the way a worker
  reports the check command), is read as `<command>`: only that prefix, a first word that ends
  `factory-slot.sh` followed by `run --`, is removed, and the rest goes through the same rules as
  any command (below). The prefix is never run.
- A bullet that is under a line, or contains words, `without the change`, and does not report
  `exit 0`, is a run shown failing without the change: it is skipped (a run that reports `exit 0`
  is rerun whatever it says).
- An item that does not start with a command (and is not `no test: …`) is a criterion for the
  master.

**What it runs.** Only a repository command, without a shell, in `--cwd`: a line of the first
`## Commands` block of the `AGENTS.md` at the merge base (`git show HEAD:AGENTS.md` in the clean
copy, never the file the diff may have changed; `--cwd` must be a git clean copy) (the words before the first `<placeholder>`, plus the
arguments the draft gives), or `npm test` / `npm run <script>` for a script of its `package.json`.
Any other command, and any with a pipe, `;`, `&&`, a redirection, `$(…)`, a backtick, a URL or a
path outside the copy, is not run.

**What it prints**, one line per item, then a verdict line in the words of the `verify-pr` skill:

| Line                                                | Meaning                                                                                          |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `match: <command>`                                  | the exit code and every figure agree with the draft                                              |
| `mismatch: <command>: <what>; …`                    | a different exit code or figure, a figure with no counterpart, no log                            |
| `variance: <command>: draft …, got …`               | a `k failed of n` figure; never a mismatch                                                       |
| `skipped: <command> (shown failing …)`              | a run shown failing without the change                                                           |
| `not run: <command>`                                | not a repository command; for the master, not a mismatch                                         |
| `not checked: <criterion>`                          | a bullet that is not a command; for the master                                                   |
| `no command ran: gate 4 of the normal lane needs …` | no entry is a `match`, `mismatch` or `variance`; printed before the verdict, which is then `Red` |
| `Verdict: Pass · 0 mismatches`                      | a command ran and none mismatches (`Verdict: Red · K mismatches` otherwise)                      |

A mismatch counts commands, not figures. Exit 0 when a command ran and nothing mismatches, 1 when a
command mismatches or no command ran (the line `no command ran: gate 4 of the normal lane needs at least one repository command in the
Tests section`, then `Verdict: Red · 0 mismatches`: a draft that `verify-draft` cannot check does
not pass), 2 when the
arguments are wrong or a file cannot be read, or the draft has no Tests section. It does not rerun
the tests the draft names as failing without the change, and it does not check the acceptance
criteria: the master reads the `skipped` and `not checked` lines.

## metrics

`metrics` reads one milestone from GitHub with `gh api` (read only; nothing is written back) and
prints the numbers of `docs/factory.md`, "Metrics", as Markdown tables.

```bash
# From this repository, until the package is published
npm run metrics --workspace packages/factory-tools -- --milestone "Micelio · Fábrica"
npm run metrics --workspace packages/factory-tools -- --milestone "Micelio · Fábrica" --fixtures test/fixtures/metrics
```

| Flag                   | Meaning                                                                                                                                                                                          |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `--milestone <title>`  | Required. The title of the milestone, exactly as GitHub shows it; if there is none, the error lists the titles of the repository                                                                 |
| `--repo <owner/repo>`  | The repository of the milestone; by default the one `gh repo view` names                                                                                                                         |
| `--maintainer <login>` | Whose comments count: the master posts as the maintainer, and their `time:` lines and review comments are measured. Default: the author of the lowest-numbered issue of the milestone (its epic) |
| `--log <path>`         | The correction log; default `docs/factory-log.md` of the repository root (`git rev-parse --show-toplevel`, so it works from a package folder), or `factory-log.md` inside `--fixtures`           |
| `--fixtures <dir>`     | Reads a recording instead of `gh api` (see below), so a run needs neither `gh` nor the network                                                                                                   |

The exit code is 0, or 2 when the arguments are wrong, the milestone does not exist or something
cannot be read. The output is six tables, a total row ending the first two, and two summary lines.

| Table                  | Column                                         | Counts                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ---------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Issues (one per issue) | Times returned at gate 1                       | The maintainer's comments whose first line starts `Gate 1` and says `not ready`, `not started` or `held`, and `lint-issue` reports that name a failing rule, from the maintainer or from the `issue-ready` bot (below); each maintainer comment counts, so an issue held twice counts 2, and the bot's comment counts each time its edit history turns it to failing                                                                                                                                                                                    |
|                        | Gate 3 rounds                                  | The highest `round N` of the comments whose first line starts `Gate 3`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
|                        | Blocking findings                              | Over all the rounds: the `K Blocking` of the first line; if it has none, the lines of the report that start `**B<n>.`                                                                                                                                                                                                                                                                                                                                                                                                                                   |
|                        | Verifier mismatches                            | Over the maintainer's verification reports: the `K mismatch(es)` of the first line; if it has none, the `**Mismatches: K.**` line of the report; else 0. A report is a comment whose first line, without its markup (`<details><summary><b>…`, `# `, `**`), starts `Gate 4` or `Verification report`                                                                                                                                                                                                                                                    |
|                        | False reds, gate 3                             | The `accepted: n` line of the maintainer's `Gate 3` comments, summed: the Important findings the worker justified in "Answers to review" and the master accepted (0 without the line)                                                                                                                                                                                                                                                                                                                                                                   |
|                        | False reds, gate 4                             | The maintainer's `Gate 4` comments whose first line, without its markup, says `passed by the master`: reports whose discrepancies the master let through as noise                                                                                                                                                                                                                                                                                                                                                                                       |
| Pull requests          | Issue                                          | The issue of the milestone the body closes or refers to (`Closes`, `Fixes`, `Resolves` or `Refs #n`), `—` if none                                                                                                                                                                                                                                                                                                                                                                                                                                       |
|                        | Changed lines                                  | Additions plus deletions                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
|                        | Maintainer corrections                         | Comments on the diff (`pulls/<n>/comments`) by the maintainer                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
|                        | Red required checks                            | Over the commits pushed after the pull request opened (committer date later than `created_at`), the checks required on its base branch (`rules/branches/<base>`) that ended `failure`, `timed_out`, `cancelled`, `action_required` or `startup_failure`; once per commit and check. If the branch requires none, every check counts                                                                                                                                                                                                                     |
|                        | Findings with no log row (any kind)            | The `Gate 3` and `Gate 4` comments of the maintainer's with findings (a Blocking or an Important in a review, a mismatch in a verification) on the pull request's issue, when that issue has no `factory-log \| ` comment by the maintainer; 0 when it has one, or when the pull request has no issue. It counts every finding of any kind, though only a correction that could become a check, a skill or a rule gets a line (`docs/factory.md`, "The learning loop"): a finding that is a correction of the change itself counts here and has no line |
|                        | Defects after merge                            | For a merged pull request, the `fix` issues (title starts `fix`) of the repository whose body cites it as `#n` or `/pull/n`                                                                                                                                                                                                                                                                                                                                                                                                                             |
|                        | Minutes, diff / report                         | The maintainer's `time:` notes on the pull request, put together (see below): the minutes of the first reading in its column, 0 in the other, `—` in both when the note has none; `—` in all three when there is no note                                                                                                                                                                                                                                                                                                                                |
|                        | Minutes, Docker or test                        | The `stack`, `docker` or `test` minutes of the maintainer's `time:` notes, `—` when no note gives them                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
|                        | Silent approvals                               | The maintainer's reviews, approved or commented, with no text and no inline comment, on a pull request with no `time:` note from the maintainer. It counts reviews, so a pull request merged with no review and no note scores 0; an empty Minutes cell is what shows that case                                                                                                                                                                                                                                                                         |
|                        | Reports read first                             | 1 when the maintainer's `time:` notes say `report` (the reports were read first), 0 when there is a note that does not, `—` when there is none                                                                                                                                                                                                                                                                                                                                                                                                          |
|                        | Tokens, by role                                | From the master's `tokens \|` comments on the pull request's issue (below): input plus output by role, in the order the roles first appear, with the cache reads in brackets (`worker 225000 (cache 1400000)`); `—` when the issue has no such comment, never 0. The pull requests of one issue show the same cell, and its total row is empty                                                                                                                                                                                                          |
| Lanes (one per lane)   | Lane, Pull requests                            | `express`, `normal` and `full`, one row each. The lane of an issue is the `lane: <lane>` line of the last `Gate 1` comment of the maintainer that has one (below); without one it is `full`, so a recording made before the lanes reads every pull request as `full`. A pull request takes its issue's lane, and one with no issue is `full`                                                                                                                                                                                                            |
|                        | Defects after merge                            | The "Defects after merge" of the lane's pull requests, added                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
|                        | Tokens, by role                                | The `tokens \|` records of the lane's issues by role, in the format of "Tokens, by role" above, each issue counted once however many pull requests it has; `—` with none. The `master` and `canary` records are not here                                                                                                                                                                                                                                                                                                                                |
|                        | Minutes, diff / report / stack, Docker or test | The `time:` minutes of the lane's pull requests, added (0 where there is none)                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
|                        | Lead time, hours; median hours                 | For each merged pull request of the lane with an issue, the hours from the issue's first comment (anyone's) to the merge, to one decimal, and the median of those (`—` with none)                                                                                                                                                                                                                                                                                                                                                                       |
| Blocking by category   | Category, Findings                             | The `**B<n>.` lines of the reports, by the section 11 check (`Correctness`, `Contracts`, `Security`, `Tests`, `Documentation`, `Scope`) the `## ` heading above them starts with; any other heading is `uncategorised`; the Blocking of a first line the report does not list is `uncategorised`                                                                                                                                                                                                                                                        |
| Correction log         | Rows, With a destination, Learnings converted  | The rows of `docs/factory-log.md`; those whose Destination is not empty (`single …` and `declined` included); and those whose Destination is an issue, `#n`, the only ones that became a change                                                                                                                                                                                                                                                                                                                                                         |

The pull requests are those with the milestone, and those without any milestone whose body closes
or refers to one of its issues; one that belongs to another milestone is left out. The `Gate` lines
are the master's, and only comments by the maintainer's login are read. The one other thing read is
the failing `lint-issue` report that the `issue-ready` workflow posts: a comment by an app (a login
ending `[bot]`) whose first line is the marker `<!-- micelio:issue-ready -->` and the next one a
report with failing rules, so the bot's login does not matter. The workflow edits that one comment in
place, so the comment alone shows only its last state. `metrics` reads its edit history (GraphQL
`IssueComment.userContentEdits`, through `gh api graphql`, read only) and counts each version that
fails when the one before it did not: fail → pass counts 1, and fail → pass → fail counts 2. A
comment that was never edited counts 1 if it fails and 0 if it passes. `Gate` lines from the bot, or
the marker in a comment by a person, are not read.

A table after the correction log gives **Tokens of the milestone, by role**: input, output, cache reads
and input plus output of every `tokens |` record of the milestone (those of its issues and the
`master` and `canary` ones), one row per role in the order the roles first appear, and a total row;
`none` when there is no record.

Two lines follow. **Tokens per merged pull request without a later fix** is the tokens of every
`tokens |` record of the milestone's issues (input plus output; cache reads are not added; the
`master` and `canary` records are not in it) divided by the merged pull requests whose "Defects after
merge" is 0, with both numbers in brackets; `—` when there is no record or no such pull request. The
same line **with cache reads** adds the cache reads of those records to the tokens. The "Tokens, by
role" cell of an issue repeats on each of its pull requests, but both lines count the issue's
records once.

### The `tokens |` line

After each agent of a round ends, the master posts a comment on the issue with one line per agent
(the master's own record: `metrics` reads no Claude Code transcript and no telemetry):

```text
tokens | 2026-10-24 | #35 | worker | 1 | 120000 | 30000 | 900000
```

The fields are `tokens | <date> | <issue> | <role> | <round> | <input> | <output> | <cache read>`,
separated by `|`: the date is `YYYY-MM-DD`; the role is `worker`, `reviewer`, `verifier`, …; the three
numbers are the whole numbers the agent's session reports, with no separators. Only comments by the
maintainer's login are read; a line with another number of fields, a bad date, an empty field or a
number that is not whole is not read. Lines of the same role add up over the rounds, and a comment
may hold several lines. The `issue` field is not checked: the issue is the one the comment is on.
The roles `master` and `canary` are the exception: their lines belong to the milestone and not to the
issue the comment is on (the master posts its own on the epic at the end of each session, and the canary's at close), so they appear in the
milestone table only, never in a pull request's cell or in the per-pull-request lines.

### The `lane:` line

The master's `Gate 1` comment (its first line, without markup, starts `Gate 1`) may carry a line
`lane: <lane>`, with `express`, `normal` or `full` (case does not matter; a list bullet and
backticks around the lane are accepted):

```text
**Gate 1 (#237): ready**
lane: normal
```

Only the maintainer's comments are read, and the last `lane:` line of a `Gate 1` comment, over all
the issue's comments, wins. Any other word, a `lane:` line in another comment and a comment by
someone else are not read. An issue with no such line is `full`. `record.sh` keeps the line when it
records a comment. Writing the line is the master's job (#238); `metrics` only reads it.

### The `time:` line

The maintainer writes a `time:` note on each pull request, in a comment of its conversation or in a
review (approving or only commenting; factory pull requests are opened from the maintainer's own
account, so there may be no approval). It lists minutes, each followed by its kind:

```text
time: 10m diff
time: 5 minutes report
time: 3m diff, 0m docker
time: 2m diff, 2m test (the admin page, headed Chromium, on a host copy of the branch)
time: diff read not stated, 2m test
time: 4m diff, 2m stack
time: 5m docker (diff read time not given)
time: maintainer's Docker check 4m (the demo site)
time: maintainer's stack check 4m
```

| Part     | Accepted                                                                                                                       | Examples                       |
| -------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------ |
| `time:`  | At the start of the line; case does not matter                                                                                 | `time:`, `Time:`               |
| Minutes  | Whole minutes, then the unit `m`, `min`, `mins`, `minute` or `minutes`, with or without a space                                | `10m`, `2 minute`              |
| Kind     | `diff` (the maintainer read the diff first) or `report` (the reports); `stack`, `docker` or `test` (the hands-on check)        | `3m diff`, `2m test`           |
| Lists    | Clauses separated by commas; `diff read not stated` (or `not given`) gives no minutes                                          | `3m diff, 0m docker`           |
| Stack    | `maintainer's stack check <n>m` (`Docker` or `test` in place of `stack`), as the maintainer writes a check made after the note | `maintainer's Docker check 4m` |
| The rest | A remark may follow, in parentheses or after a full stop; any other text in the list makes the line no note                    | `time: 10m diff.`              |

The `stack`, `docker` and `test` minutes are one column, "Minutes, Docker or test"; `stack` is read
as `docker` is (the standard says "the stack", and the factory host runs Podman), and a note with
more than one adds them. A note that is in none of these forms is not read (`time: 10 hours diff`, `time: 10m`). If
there are several notes, the latest wins, column by column: a later note that gives a diff or report
time replaces the earlier one, and one that gives only the hands-on time (`time: 2m docker`) keeps
the earlier diff or report time, and the other way round. The kinds are those of "The maintainer's
review levels" of `docs/factory.md`.

### Recorded fixtures

`test/fixtures/metrics/` is the recording of the milestone "Micelio · Fábrica" of this repository
and its pull requests #46 to #49, made by `record.sh` with `gh api`. Each file is what GitHub
returned, cut down by `record.jq` to what `metrics` reads, so that nothing but a login stands for a
person; the tests run `record.jq` on a sample comment and check that it keeps every line the
parsers read (`factory-log |`, `tokens |`, `accepted:`, headings, finding lines and the mismatch
count). `factory-log.md` is a copy of `docs/factory-log.md`, and `expected.md` is the output the
tests compare with.

What GitHub does not have is written by hand in `test/fixtures/metrics/overlay/`, with the same
layout, and `fixtureSource` reads it after the recording: its rows are added to a list file (a row
with the `number` of a recorded one replaces it), and any other file of it wins over the recorded
one. It holds issue #9052 and its pull request #9053 (a Gate 3 and a Gate 4 with findings and no
`factory-log |` line, with numbers GitHub does not have) and the `tokens |` lines and the `passed by
the master` report that the master had not posted on #35 to #37 when it was recorded. A recording
never touches it. `record.sh` writes to a temporary directory and replaces the recorded files only
when every call has succeeded, so a failed run leaves the fixtures as they were. Every pull
request of the recording has a `time:` note, so its Silent approvals are 0; the tests build the
other cases. Record again with `ISSUES=51 test/fixtures/metrics/record.sh
bogd3v/micelio-engineering 2 46 47 48 49`.

### Limits

- "Pushed after the pull request opened" is the committer date of each commit against the
  pull request's `created_at`: GitHub's API has no push time, so a commit made before opening and
  pushed after counts as before. Required checks are those of `rules/branches/<base>`; a repository
  that protects the branch with the classic protection instead has none there, and every check
  counts.
- Blocking findings and rounds are per issue, because the master's `Gate` comments are on issues;
  an issue with two pull requests shows them once, and no column says which pull request they
  belong to.
- Report formats differ from round to round: a Blocking finding the report does not list as a
  `**B<n>.` line is counted from the first line and filed as `uncategorised`; a round whose first
  line has no count and whose report lists none counts 0.

The library exports `lintIssue`, `RULE_IDS`, `report` and `run`, `runReady`, `applyReadiness`, `neutralise`, `GhError`, `MARKER`, `READY_LABEL`, `TRUSTED_ASSOCIATIONS` and the types of `ready.ts`, the readers `issueFromGh`,
`issueFromMarkdown`, `parseTarget` and `sections`, `metrics`, `renderMetrics`, the sources `ghSource`
and `fixtureSource`, the parsers `parseTime`, `parseEvent`, `parseLogLines`, `blockingByCategory` and
`countLog`, and their types. Before 1.0.0 any of them may
change in a `0.y` release (standard, section 7).

## `lint-lane`

Sets an issue's lane at gate 1 and checks the diff against it at gate 2 (ADR-0003, D2 and D3,
`docs/adr/0003-route-each-issue-through-a-lane-set-by-its-risk.md`). Run it in the checkout of the
issue's repository: the globs come from the `## Lanes` block of the `AGENTS.md` in the current
directory.

```bash
node <checkout>/packages/factory-tools/dist/cli.js lint-lane bogd3v/micelio#729   # needs gh
node <checkout>/packages/factory-tools/dist/cli.js lint-lane --file <issue.md>    # first line "# <title>"
node <checkout>/packages/factory-tools/dist/cli.js lint-lane --diff "$(git merge-base HEAD origin/main)" --lane normal
```

**The issue form** prints `lane: express|normal|full` and one line per reason: the title's `!`, or
each path with the glob it matched (or `is normative`, or `matches no glob`). The paths are the
ones the body names in backticks: a token with a `/`, or one that ends in an extension that starts
with a letter; fenced blocks and HTML comments are not read. `gh` is needed only for
`<owner/repo#n>`.

**The diff form** takes the paths of `git diff --name-only <base>` plus the untracked files that git
does not ignore (add them with `git add -N .` or leave them untracked: both count). It exits 0 when
every path fits `--lane`; otherwise it exits 1, prints `lane: <the lane the diff fits>` and the
paths that raise it above `--lane`, each with its lane. Add the lane the diff fits to the issue
and run the gates it skipped.

Rules, in this order:

- `full`: a `!` in the title's conventional prefix (`feat(x)!:`), or a path that matches `stack:` or
  `contract:`.
- `express`: the issue names at least one path, every path matches `express:`, and none is normative.
- `normal`: the rest. A path that matches no glob, and an issue that names no path, are `normal`,
  never `express`.
- Normative paths are fixed in the code and never `express`: `docs/engineering-standard.md`,
  `docs/standard/`, `docs/factory.md`, `AGENTS.md`, `CLAUDE.md`, `.claude/`, `template/` and
  `herdr/`. A normative path that also matches `stack:` or `contract:` is `full`.
- With no `## Lanes` block, or no `AGENTS.md`, every issue is `full`, and a diff fits only `full`.

The block is a `## Lanes` heading in `AGENTS.md`, up to the next heading of level 1 or 2, with the
lines `stack:`, `contract:` and `express:`, each a comma-separated list of globs. A line may start
with a list bullet, a glob may be in backticks, and the lines may sit in a fenced block. A line
that is missing, or empty, is an empty list.

```text
## Lanes

stack: compose.yaml, images/**, **/Dockerfile
contract: api/**, docs/contracts/*.md
express: docs/**/*.md, README.md, .github/project-fields.json
```

A glob matches the whole path, written with `/`: `*` is any run of characters but `/`, `**` is any
run including `/` (`**/` also matches nothing), `?` is one character but `/`, and a glob that ends
in `/` is a folder and matches everything under it.

There is no option to force a lane: nobody lowers one with this command. Exit codes: 0 when the lane
is printed or the diff fits, 1 when the diff does not fit, 2 on a usage error or a file or `gh` that
cannot be read.
