# feat(widgets): a counter widget for the example site

Part of example/site#1.

## Why

The example site at `https://example.com` shows no count of its pages. ADR-0001 says every widget is a component of its own.

## What to build

- `src/widgets/counter.ts`, a component that renders the number of pages.
- A row for it in `docs/widgets.md`.

## Requirements

- Additive: `feat`, a minor of the example package.

## Acceptance criteria

- [ ] `npm run test` passes with a unit test of `counter.ts`.
- [ ] The widget renders "3 pages" on a site with three pages.

## Delivery

The agent prepares the change and proves every criterion; the maintainer reviews the whole diff before merging.

### Progress

Nothing yet.
