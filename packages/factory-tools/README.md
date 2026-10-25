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
cannot be read. The output is four tables; a total row ends the first two.

| Table                  | Column                   | Counts                                                                                                                                                                                                                                                                                                                                                               |
| ---------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Issues (one per issue) | Times returned at gate 1 | The maintainer's comments whose first line starts `Gate 1` and says `not ready`, `not started` or `held`, and `lint-issue` reports that name a failing rule, from the maintainer or from the `issue-ready` bot (below); each maintainer comment counts, so an issue held twice counts 2, and the bot's comment counts each time its edit history turns it to failing |
|                        | Gate 3 rounds            | The highest `round N` of the comments whose first line starts `Gate 3`                                                                                                                                                                                                                                                                                               |
|                        | Blocking findings        | Over all the rounds: the `K Blocking` of the first line; if it has none, the lines of the report that start `**B<n>.`                                                                                                                                                                                                                                                |
|                        | Verifier mismatches      | Over the `Gate 4` comments: the `K mismatch(es)` of the first line; if it has none, the `**Mismatches: K.**` line of the report; else 0                                                                                                                                                                                                                              |
| Pull requests          | Issue                    | The issue of the milestone the body closes or refers to (`Closes`, `Fixes`, `Resolves` or `Refs #n`), `—` if none                                                                                                                                                                                                                                                    |
|                        | Changed lines            | Additions plus deletions                                                                                                                                                                                                                                                                                                                                             |
|                        | Maintainer corrections   | Comments on the diff (`pulls/<n>/comments`) by the maintainer                                                                                                                                                                                                                                                                                                        |
|                        | Red required checks      | Over the commits pushed after the pull request opened (committer date later than `created_at`), the checks required on its base branch (`rules/branches/<base>`) that ended `failure`, `timed_out`, `cancelled`, `action_required` or `startup_failure`; once per commit and check. If the branch requires none, every check counts                                  |
|                        | Defects after merge      | For a merged pull request, the `fix` issues (title starts `fix`) of the repository whose body cites it as `#n` or `/pull/n`                                                                                                                                                                                                                                          |
|                        | Minutes, diff / report   | The maintainer's `time:` line on the pull request, in its kind's column and 0 in the other; `—` in both when there is none                                                                                                                                                                                                                                           |
| Blocking by category   | Category, Findings       | The `**B<n>.` lines of the reports, by the section 11 check (`Correctness`, `Contracts`, `Security`, `Tests`, `Documentation`, `Scope`) the `## ` heading above them starts with; any other heading is `uncategorised`; the Blocking of a first line the report does not list is `uncategorised`                                                                     |
| Correction log         | Rows, With a destination | The rows of `docs/factory-log.md` and those whose Destination is not empty                                                                                                                                                                                                                                                                                           |

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

### The `time:` line

The maintainer writes one line on each pull request, in a comment of its conversation or in a
review (approving or only commenting; factory pull requests are opened from the maintainer's own
account, so there may be no approval):

```text
time: 10m diff
time: 2 minute diff
time: 5 minutes report
```

| Part     | Accepted                                                              | Examples          |
| -------- | --------------------------------------------------------------------- | ----------------- |
| `time:`  | At the start of the line; case does not matter                        | `time:`, `Time:`  |
| Number   | Whole minutes                                                         | `10`, `2`         |
| Unit     | `m`, `min`, `mins`, `minute` or `minutes`, with or without a space    | `10m`, `2 minute` |
| Kind     | `diff` (the maintainer read the diff first) or `report` (the reports) | `diff`, `report`  |
| The rest | Nothing else on the line; a final full stop is allowed                | `time: 10m diff.` |

If there are several, the latest wins. The kinds are those of "The maintainer's review levels" of
`docs/factory.md`.

### Recorded fixtures

`test/fixtures/metrics/` is the recording of the milestone "Micelio · Fábrica" of this repository
and its pull requests #46 to #49, made by `record.sh` with `gh api`. Each file is what GitHub
returned, cut down by `record.jq` to what `metrics` reads, so that nothing but a login stands for a
person: a comment keeps its first line, its `factory-log |` lines and the headings and finding
lines of a review report, and the `issue-ready` bot's comments also keep the line after the marker
and their edit history (`comment-edits/`). `factory-log.md` is a copy of `docs/factory-log.md`, and `expected.md` is
the output the tests compare with. Record again with `ISSUES=51 test/fixtures/metrics/record.sh
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
