# feat(page): export slugify from the index

## Problem

Callers import every helper from one place, and `src/index.mjs` does not exist yet.

## What changes

`src/index.mjs` exports `MAX_SLUG_LENGTH` and `slugify` from `src/slug.mjs`.

## For review

One file, no dependencies.

## Tests

- `npm test`: exit 0, 4 tests, 4 pass, 0 fail (`logs/npm-test.log`)

## Instructions that were wrong or missing

Nothing.

## What I could not verify

Nothing.

Closes #1
