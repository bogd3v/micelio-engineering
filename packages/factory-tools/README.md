# @micelio/factory-tools

The commands of the Micelio software factory: `lint-issue` (Gate 1, the Definition of Ready, as a
script), [`issue-ready`](#issue-ready) (what the workflow does with its result) and
[`metrics`](#metrics) (the factory's numbers for a milestone).

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

```text
**lint-issue** · `bogd3v/micelio#729` · 2026-10-24 · 1 of 7 rules fail

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
  [--ready-status Ready] [--not-ready-status Todo]
```

An issue that is closed, or whose author is not an `OWNER`, `MEMBER` or `COLLABORATOR`, is skipped
(`skipped: …`, exit 0). A pass adds the issue to the project and sets Ready; a fail never adds it
and only moves a Status that is Ready back to Todo.

It prints one line per change and exits 0, or 2 with the reason (for example a Status option the
project does not have; nothing is changed then). The logic is tested against recorded API
responses in `test/fixtures/ready/`, with no network.

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
cannot be read. The output is five tables, a total row ending the first two, and two summary lines.

| Table                  | Column                                        | Counts                                                                                                                                                                                                                                                                                                                                                               |
| ---------------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Issues (one per issue) | Times returned at gate 1                      | The maintainer's comments whose first line starts `Gate 1` and says `not ready`, `not started` or `held`, and `lint-issue` reports that name a failing rule, from the maintainer or from the `issue-ready` bot (below); each maintainer comment counts, so an issue held twice counts 2, and the bot's comment counts each time its edit history turns it to failing |
|                        | Gate 3 rounds                                 | The highest `round N` of the comments whose first line starts `Gate 3`                                                                                                                                                                                                                                                                                               |
|                        | Blocking findings                             | Over all the rounds: the `K Blocking` of the first line; if it has none, the lines of the report that start `**B<n>.`                                                                                                                                                                                                                                                |
|                        | Verifier mismatches                           | Over the maintainer's verification reports: the `K mismatch(es)` of the first line; if it has none, the `**Mismatches: K.**` line of the report; else 0. A report is a comment whose first line, without its markup (`<details><summary><b>…`, `# `, `**`), starts `Gate 4` or `Verification report`                                                                 |
|                        | False reds, gate 3                            | The `accepted: n` line of the maintainer's `Gate 3` comments, summed: the Important findings the worker justified in "Answers to review" and the master accepted (0 without the line)                                                                                                                                                                                |
|                        | False reds, gate 4                            | The maintainer's `Gate 4` comments whose first line, without its markup, says `passed by the master`: reports whose discrepancies the master let through as noise                                                                                                                                                                                                    |
| Pull requests          | Issue                                         | The issue of the milestone the body closes or refers to (`Closes`, `Fixes`, `Resolves` or `Refs #n`), `—` if none                                                                                                                                                                                                                                                    |
|                        | Changed lines                                 | Additions plus deletions                                                                                                                                                                                                                                                                                                                                             |
|                        | Maintainer corrections                        | Comments on the diff (`pulls/<n>/comments`) by the maintainer                                                                                                                                                                                                                                                                                                        |
|                        | Red required checks                           | Over the commits pushed after the pull request opened (committer date later than `created_at`), the checks required on its base branch (`rules/branches/<base>`) that ended `failure`, `timed_out`, `cancelled`, `action_required` or `startup_failure`; once per commit and check. If the branch requires none, every check counts                                  |
|                        | Findings without a log row                    | The `Gate 3` and `Gate 4` comments of the maintainer's with findings (a Blocking or an Important in a review, a mismatch in a verification) on the pull request's issue, when that issue has no `factory-log \| ` comment by the maintainer; 0 when it has one, or when the pull request has no issue                                                                |
|                        | Defects after merge                           | For a merged pull request, the `fix` issues (title starts `fix`) of the repository whose body cites it as `#n` or `/pull/n`                                                                                                                                                                                                                                          |
|                        | Minutes, diff / report                        | The maintainer's `time:` notes on the pull request, put together (see below): the minutes of the first reading in its column, 0 in the other, `—` in both when the note has none; `—` in all three when there is no note                                                                                                                                             |
|                        | Minutes, Docker or test                       | The `docker` or `test` minutes of the maintainer's `time:` notes, `—` when no note gives them                                                                                                                                                                                                                                                                        |
|                        | Silent approvals                              | The maintainer's reviews, approved or commented, with no text and no inline comment, on a pull request with no `time:` note from the maintainer                                                                                                                                                                                                                      |
|                        | Reports read first                            | 1 when the maintainer's `time:` notes say `report` (the reports were read first), 0 when there is a note that does not, `—` when there is none                                                                                                                                                                                                                       |
|                        | Tokens, by role                               | From the master's `tokens \|` comments on the pull request's issue (below): input plus output by role, in the order the roles first appear, with the cache reads in brackets (`worker 225000 (cache 1400000)`); `—` when the issue has no such comment, never 0. The pull requests of one issue show the same cell, and its total row is empty                       |
| Blocking by category   | Category, Findings                            | The `**B<n>.` lines of the reports, by the section 11 check (`Correctness`, `Contracts`, `Security`, `Tests`, `Documentation`, `Scope`) the `## ` heading above them starts with; any other heading is `uncategorised`; the Blocking of a first line the report does not list is `uncategorised`                                                                     |
| Correction log         | Rows, With a destination, Learnings converted | The rows of `docs/factory-log.md`; those whose Destination is not empty (`single …` and `declined` included); and those whose Destination is an issue, `#n`, the only ones that became a change                                                                                                                                                                      |

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
time: 5m docker (diff read time not given)
time: maintainer's Docker check 4m (the demo site)
```

| Part     | Accepted                                                                                                       | Examples                       |
| -------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| `time:`  | At the start of the line; case does not matter                                                                 | `time:`, `Time:`               |
| Minutes  | Whole minutes, then the unit `m`, `min`, `mins`, `minute` or `minutes`, with or without a space                | `10m`, `2 minute`              |
| Kind     | `diff` (the maintainer read the diff first) or `report` (the reports); `docker` or `test` (the hands-on check) | `3m diff`, `2m test`           |
| Lists    | Clauses separated by commas; `diff read not stated` (or `not given`) gives no minutes                          | `3m diff, 0m docker`           |
| Docker   | `maintainer's Docker check <n>m`, as the maintainer writes a check made after the note                         | `maintainer's Docker check 4m` |
| The rest | A remark may follow, in parentheses or after a full stop; any other text in the list makes the line no note    | `time: 10m diff.`              |

The `docker` and `test` minutes are one column, "Minutes, Docker or test"; a note with both adds
them. A note that is in none of these forms is not read (`time: 10 hours diff`, `time: 10m`). If
there are several notes, the latest wins, column by column: a later note that gives a diff or report
time replaces the earlier one, and one that gives only the hands-on time (`time: 2m docker`) keeps
the earlier diff or report time, and the other way round. The kinds are those of "The maintainer's
review levels" of `docs/factory.md`.

### Recorded fixtures

`test/fixtures/metrics/` is the recording of the milestone "Micelio · Fábrica" of this repository
and its pull requests #46 to #49, made by `record.sh` with `gh api`. Issue #9052 and its pull request #9053 are the exception: they are written by hand (a Gate 3 and a Gate 4 with findings and no `factory-log |` line, which no recorded issue has), with numbers GitHub does not have, and recording again does not touch them. Each other file is what GitHub
returned, cut down by `record.jq` to what `metrics` reads, so that nothing but a login stands for a
person: a comment keeps its first line, its `factory-log |` and `tokens |` lines, its `accepted:` line and the headings and finding
lines of a review report, and the `issue-ready` bot's comments also keep the line after the marker
and their edit history (`comment-edits/`). `factory-log.md` is a copy of `docs/factory-log.md`, and `expected.md` is
the output the tests compare with. The master had not posted `tokens |` lines, `accepted:` lines or a `passed by the master` report
yet when it was recorded: the ones in `comments/35.json`, `36.json` and `37.json` were added by
hand in the form `record.jq` keeps, and a new recording keeps them once GitHub has them. Every
pull request of the recording has a `time:` note, so its Silent approvals are 0; the tests build
the other cases. Record again with `ISSUES=51 test/fixtures/metrics/record.sh
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
