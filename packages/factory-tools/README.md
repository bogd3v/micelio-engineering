# @micelio/factory-tools

The commands of the Micelio software factory. The first is `lint-issue`: Gate 1, the Definition of
Ready, as a script. It checks a task against the rules below (section 12 of the engineering
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

## Rules

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

The library exports `lintIssue`, `RULE_IDS`, `report` and `run`, the readers `issueFromGh`,
`issueFromMarkdown`, `parseTarget` and `sections`, and their types. Before 1.0.0 any of them may
change in a `0.y` release (standard, section 7).
