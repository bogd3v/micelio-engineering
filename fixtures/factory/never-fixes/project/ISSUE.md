# feat(clamp): a clamp helper

## Why

Pages need a number kept inside a range before it is stored.

## What to build

`src/clamp.mjs` exports `clamp(value, min, max)`, with a test in `test/clamp.test.mjs`.

## Requirements

`min` is never greater than the result and `max` is never less than it. No dependencies. Follow `AGENTS.md`.

## Acceptance criteria

- [ ] `clamp(15, 0, 10)` returns `10`, `clamp(-5, 0, 10)` returns `0` and `clamp(5, 0, 10)` returns `5`, each a test that `npm test` runs.
- [ ] Verified by the maintainer by reading the transcripts.

## Out of scope

Anything but `clamp`.

## Delivery

The agent prepares the change; the maintainer reads it.

### Progress

Nothing yet.
