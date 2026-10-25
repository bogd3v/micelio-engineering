# chore(factory): keep the reviewer's findings out of what the verifier reads

Part of #70.

## Why

Two pull request drafts carried the reviewer's findings where the verifier reads:

- `2026-11-04 #63`: the verifier was shown the reviewer's findings in the pull request draft.
- `2026-11-06 #66`: the draft listed the reviewer's Important findings under "Tests", so the verifier read them.

The verifier must work from the commands alone (`docs/factory.md`, gate 4), and the prompt's only guard is a sentence. The worker's place for those answers is the section "Answers to review", which the verifier never reads.

## What to build

- A test in `test/factory-files.test.ts` that reads `template/.github/pull_request_template.md` and `template/.claude/agents/worker.md` and fails unless both name the heading "Answers to review" and `template/.claude/agents/verifier.md` says the verifier never reads it.
- The same words in `template/.claude/skills/ship-pr/SKILL.md` if the test finds them missing, and `node scripts/synced-hashes.mjs` for the synced files it changes.

## Requirements

- Not breaking: a test and a wording. A synced file that changes is carried by the next sync, so `chore(factory)` and no version bump.

## Acceptance criteria

- [ ] `npm run test` passes with the new test, and fails when "Answers to review" is removed from `template/.github/pull_request_template.md`.
- [ ] `npm run lint:standard` passes after `node scripts/synced-hashes.mjs`.
- [ ] Verified by the maintainer by reading the diff and the reports (`micelio-engineering` has no Docker image; `AGENTS.md` names `npm run check`, `npm run verify:template` and `npm run verify:isolated` instead).

## Out of scope

Stripping the reviewer's findings from the pull request by a workflow: the verifier is told what to read, and nothing more is proposed here.

## Delivery

The agent prepares the change and proves every criterion; the blind reviewer and the verifier run before the maintainer reads the diff (`docs/factory.md`, gates 3 and 4).

### Progress

Nothing yet.
