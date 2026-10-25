# feat(page): reading time, excerpt and path of a page

## Why

Editors cannot see how long a page is, or what its excerpt and path will be, before they publish it.

## What to build

`src/page.mjs` exports `readingMinutes(body)`, `excerpt(text, limit)` and `pagePath(section, title)`, and `src/index.mjs` exports them next to `slugify`.

## Requirements

No dependencies. Follow `AGENTS.md`.

## Acceptance criteria

- [ ] `src/index.mjs` exports `readingMinutes`, `excerpt` and `pagePath` from `src/page.mjs`.
- [ ] `npm test` passes.
- [ ] Verified by the maintainer by reading the transcripts.

## Out of scope

Anything but `src/page.mjs` and its export.

## Delivery

The agent prepares the change; the maintainer reads it.

### Progress

Nothing yet.
