# ADR-0003: Route each issue through a lane set by its risk

**Status:** Accepted
**Date:** 2026-11-12
**Deciders:** The maintainer

## Context

Every issue goes through the same gates of [`docs/factory.md`](../factory.md): a worker, a blind reviewer, a verifier that re-creates the stack from scratch, and the fixed criterion "Verified by the maintainer on the stack". The epic that carries out this record is bogd3v/micelio-engineering#230, written by #231.

What the pull requests show, read from this repository by REST on 2026-11-12 (the 55 pull requests merged since 2026-11-05, the changed lines of each as GitHub reports them, the `time:` notes and `tokens |` lines from the comments of each issue):

- 27 of the 55 change 30 lines or fewer, and 37 change 100 or fewer.
- #214 (4 lines, the status of an ADR) and #206 (1 line of `AGENTS.md`) each went through a worker, a reviewer and a verifier. The `tokens |` lines on the issue (`herdr/master.md`, "tokens"; fields `<input> | <output> | <cache read>`), input plus output, read again for this record on 2026-11-12:

  | Issue | Worker       | Reviewer     | Verifier     | Sum   |
  | ----- | ------------ | ------------ | ------------ | ----- |
  | #214  | 25395 + 4767 | 24549 + 2196 | 34093 + 3972 | 94972 |
  | #206  | 19143 + 3902 | 23842 + 1944 | 33863 + 3641 | 86335 |

  That is about 95 K and 86 K tokens for the two changes; cache reads (292309 and 121547 and 362131 on #214; 175413 and 121648 and 272376 on #206) are not added.

- The 40 `time:` notes of those pull requests have a median of 4 minutes and a maximum of 8 (the maintainer's minutes, not the agents').
- #215 and #217 (30 and 14 changed lines) took 17 and 19 hours from the issue's first comment to the merge.
- The maintainer reports that a hands-on run on the stack is not needed for minor or documentation changes.
- `docs/factory-log.md` holds 411 rows of corrections (the lines that start with `| 20`, counted on `main` at `3c3ed18`), so the gates do find things; what is not known is in which kind of change.

The gates are written in the standard (sections 11 to 13), in the five role prompts and in `lint-issue`, so changing them is expensive to undo. That makes this a gate 0 decision (`docs/factory.md`, "Gate 0 · Decision"): the record comes before the issues that adopt it. The maintainer approved the decision in the chat on 2026-11-12, and the epic records it as D1 to D10.

The numbers show the cost, not the benefit: nothing here measures the defects that a lighter lane would have let through. The calibration of Decision 8 and the metrics of Decision 10 are what will.

## Decision

1. **Three lanes.** `express`, `normal` and `full`. `full` is today's pipeline, unchanged.
2. **A machine sets the lane at gate 1.** `factory-tools lint-lane` reads the title's prefix and the paths the issue names and compares them with the globs of the repository's `AGENTS.md` (`## Lanes`: `stack:`, `contract:`, `express:`). A path that matches no glob never lowers the lane. Nobody lowers a lane by hand; the maintainer may raise one.
3. **The diff confirms it at gate 2.** `lint-lane --diff` checks the diff against the lane. A diff that does not fit moves the issue to the lane it fits, and the gates it skipped run.
4. **`full` is** a `!` in the title, a contract of section 6 of the standard, security or permissions, a migration or a schema, an image or a compose file, or anything an operator or an editor sees.
5. **`express` is only** non-normative Markdown, `.github/project-fields.json`, the version files of a `chore(release)` and the status line of an ADR. The standard, the profiles, `docs/factory.md`, `AGENTS.md`, `CLAUDE.md`, the role prompts, the skills and `herdr/` are normative and never `express`; the maintainer chose the prudent option for `AGENTS.md`: `normal`.
6. **`normal` is everything else.**
7. **What each lane runs.**

   |                                     | express                                  | normal                                    | full                             |
   | ----------------------------------- | ---------------------------------------- | ----------------------------------------- | -------------------------------- |
   | Worker proves criteria on the stack | no                                       | no                                        | yes                              |
   | Gate 3, blind reviewer              | no: the check command                    | yes                                       | yes                              |
   | Gate 4                              | no                                       | `verify-draft`, a script, on a clean copy | the verifier, stack from scratch |
   | Fixed criterion                     | by reading the diff                      | by reading the diff                       | on the stack                     |
   | Maintainer                          | reads the diff, may sign several at once | reports, then the diff                    | the diff, then the stack         |

8. **Calibration.** One pull request in five of `express` and of `normal` runs every gate of `full`.
9. **No engine in the rule.** The lanes say "the stack" (standard 2.2). CI builds each image with Docker on every pull request whatever the lane (ADR-0002, Decision 4), which is part of what protects `normal`.
10. **`factory-tools metrics` reports per lane** the defects after merge, the tokens, the maintainer's minutes and the lead time.

## Options considered

### A. Three lanes set by a machine (chosen)

Each issue runs only the gates that can find something in its kind of change, and the choice is a function of the title and the paths, so two masters give the same lane and nobody argues a lane down. It keeps `full` as it is, which is what an incident would be fixed in. The calibration (Decision 8) and the per-lane metrics (Decision 10) give a way to see that a lane is wrong.

### B. One pipeline, as today

No new rule and no way to pick wrongly. It costs what the Context reads: about 95 K tokens and three agents for a 4-line change of an ADR's status, and the same fixed criterion on the stack for a document. It is the baseline, and the way back if this record is reversed.

### C. Two lanes, express and full

Simpler to write and to read. It leaves a middle that is large (27 of 55 pull requests are 30 lines or fewer, but code and prompts are among them) with no cheap home: either code changes go to `full` and the saving is small, or they go to `express` with no second reader. `normal` exists to keep the reviewer and a script that reruns the draft's commands where code changes but no operator or editor sees them.

### D. A lane picked by the master or the maintainer

Flexible, and it needs no globs. The choice then rests on the judgement of the one who wants the issue merged, which is the pressure this record guards against, and two masters would give two lanes for the same issue. A machine can be wrong too, but it is wrong the same way every time, and a wrong glob is a line to fix.

## Trade-offs

- **A wrong glob.** A glob that is too wide in `express:` or too narrow in `stack:` or `contract:` lowers the lane of a change that needed more. Decision 2 (a path that matches no glob never lowers the lane) and Decision 3 (the diff confirms the lane) limit it; they do not remove it, because a diff that fits a wrong glob fits the lane.
- **`express` has no second reader besides the maintainer.** The check command runs, and the maintainer reads the diff (and may sign several at once). No agent reads it blind. That is why `express` is limited to what cannot change behaviour, and why calibration runs one in five through `full`.
- **Three paths through texts that are already long.** The standard (sections 11 to 13), `docs/factory.md`, the five role prompts and `herdr/master.md` each gain a branch per lane. Each is a place where a reader, human or agent, can follow the wrong one. A repository with no `## Lanes` block runs every issue as `full` (epic, D13), so the prompts change nothing in a repository until it adopts the block.
- **What would make the decision worth revisiting:** a lane's defects after merge above `full`'s over two milestones, or calibration finding a Blocking in more than one sampled pull request in ten.

## Consequences

Nothing is adopted by this record: `docs/factory.md`, the standard and the prompts do not change with it. It adds this file and its row in [`docs/adr/README.md`](README.md); it becomes `Accepted` when its pull request is merged. No version changes: it is a document, and no published package is touched.

The issues of the epic (bogd3v/micelio-engineering#230) adopt it:

- #233 `docs(standard)`: sections 11 to 13 name the three lanes (standard 2.3).
- #234 `feat(factory-tools)`: `lint-lane` sets an issue's lane and checks a diff against it.
- #235 `feat(factory-tools)`: `lint-issue` checks the fixed criterion of the issue's lane.
- #236 `feat(factory-tools)`: `verify-draft` reruns a draft's commands and compares the numbers.
- #237 `feat(factory-tools)`: `metrics` reports defects, tokens, minutes and lead time per lane.
- #232 `chore(factory)`: the scribe runs when an issue closes, and the log takes only what can become a check.
- #238 `chore(factory)`: the role prompts and the runbook follow the issue's lane.
- #239 `chore(factory)`: one pull request in five of the lower lanes runs the full lane.
- #240 `chore(factory)`: a round with no Blocking is reread by a sonnet reviewer on the changed hunks.
- #241 `chore(factory)`: the gates are numbered lists, and `docs/factory.md` and `herdr/master.md` are half as long.
- One issue in each product repository (`micelio`, `micelio-cms`, `micelio-plugin-core`, `micelio-plugin-fediverse`) to write its `## Lanes` block in `AGENTS.md`, after #234 and #238; `micelio-plugin-fediverse` has no compose file, so its `stack:` is empty.

The Herdr mod, the globs of any repository and moving CI or production to another runtime are out of scope.
