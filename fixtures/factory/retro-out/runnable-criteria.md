# chore(factory): fail a criterion whose command needs an unpublished package

Part of #70.

## Why

Two issues of the milestone asked for a command nobody could run before the release:

- `2026-11-03 #61`: the criterion ran `npx @example/tool`, a package that is not published yet.
- `2026-11-05 #64`: the criterion used `npx @example/tool`, which cannot run before the release.

Both got past `lint-issue` because the `criteria` rule only asks for a backtick or `npm run`.

## What to build

- A rule in `packages/factory-tools/src/rules.ts`: an item of "Acceptance criteria" whose only command starts with `npx` fails `criteria`, and the report says to use `npm run <script> --workspace <package>` until the package is published.
- The rule row in `packages/factory-tools/README.md`, and a fixture `packages/factory-tools/test/fixtures/fail-npx.md`.

## Requirements

- Not breaking: a stricter rule for `lint-issue`, so `chore(factory)` and a PATCH of `@micelio/factory-tools` (section 7).
- An item with `npx` and another command that can run still passes.

## Acceptance criteria

- [ ] `npm run test` passes, with a test that reads `packages/factory-tools/test/fixtures/fail-npx.md` and expects `criteria` to fail.
- [ ] `npm run lint-issue --workspace packages/factory-tools -- --file test/fixtures/pass.md` still exits 0.
- [ ] Verified by the maintainer by reading the diff and the reports (`micelio-engineering` has no Docker image; `AGENTS.md` names `npm run check`, `npm run verify:template` and `npm run verify:isolated` instead).

## Out of scope

Reading the registry to learn whether a package is published: the rule needs no network.

## Delivery

The agent prepares the change and proves every criterion; the blind reviewer and the verifier run before the maintainer reads the diff (`docs/factory.md`, gates 3 and 4).

### Progress

Nothing yet.
