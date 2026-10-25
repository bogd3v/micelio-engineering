# docs(standard): name the synced files as read-only on a branch

Part of #70.

## Why

Two workers changed a synced file on their own branch instead of reporting it:

- `2026-11-03 #62`: a hand-edited copy of a synced prompt was committed and `lint:standard` failed.
- `2026-11-06 #65`: the synced `ship-pr` skill was edited on the branch instead of reported to the master.

The worker prompt says to report them (`template/.claude/agents/worker.md`), but the standard's section 13 names no such limit, so the rule lives in one prompt that a worker can read past. `lint:standard` catches it only after the commit.

## What to build

- A line in the hard limits of section 13 of `docs/engineering-standard.md`: a file listed in `.github/standard-sync.json` is changed only in `micelio-engineering`; from any other repository it is reported, not edited.
- The standard's version in `AGENTS.md` and the bundled hashes, as `docs/standard-sync.md` describes for a change of the standard.

## Requirements

- Not breaking for a consumer's code: a MINOR of the standard and of `@micelio/eslint-config` for the new hashes (section 7); the consumers follow in the sync pull request.
- The sentence must be checkable by reading it: it names `.github/standard-sync.json`.

## Acceptance criteria

- [ ] `npm run lint:standard` passes after the change, with the new hashes in `packages/eslint-config/standard-hashes.json`.
- [ ] `grep -n "standard-sync.json" docs/engineering-standard.md` finds the new line in section 13.
- [ ] Verified by the maintainer by reading the diff and the reports (`micelio-engineering` has no Docker image; `AGENTS.md` names `npm run check`, `npm run verify:template` and `npm run verify:isolated` instead).

## Out of scope

Blocking the edit in the worktree with a hook: a separate proposal if the line does not stop it.

## Delivery

The agent prepares the change and proves every criterion; it is a `docs(standard)` pull request of section 16, and the maintainer reads the whole diff before merging.

### Progress

Nothing yet.
