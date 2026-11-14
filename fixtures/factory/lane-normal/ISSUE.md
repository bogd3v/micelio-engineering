# feat(page): export slugify from the index

## Why

Callers import every helper from one place.

## What to build

`src/index.mjs` exports `MAX_SLUG_LENGTH` and `slugify` from `src/slug.mjs`.

## Requirements

No dependencies. Follow `AGENTS.md`.

## Acceptance criteria

- [ ] `src/index.mjs` exports `MAX_SLUG_LENGTH` and `slugify`.
- [ ] `npm test` passes.
- [ ] Verified by the maintainer by reading the diff.

## Out of scope

Anything but `src/index.mjs`.

## Delivery

The agent prepares the change; the maintainer reads it.

### Progress

Nothing yet.
