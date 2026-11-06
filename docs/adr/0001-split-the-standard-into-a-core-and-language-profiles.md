# ADR-0001: Split the standard into a core and language profiles

**Status:** Proposed
**Date:** 2026-11-05
**Deciders:** The maintainer (bogd3v)

## Context

The standard binds only Micelio and only Node. Its first paragraph says "all of them on Node" and "The standard is Micelio's, not bogd3v's: other projects of the organisation, in other languages or under other licences, are not bound by it" (`docs/engineering-standard.md`, scoped that way in version 1.4, 2026-10-20). The organisation now plans a product in Rust that should run through the same factory (scope: "Home network security MVP · Scope", decided with the maintainer on 2026-11-05), and more repositories outside TypeScript are expected.

Read on `main` at `4a5c2b0` on 2026-11-05, Node and TypeScript are assumed here:

- `docs/engineering-standard.md`, sections 4, 10, 14 and 15: TypeScript `strict`, TSDoc, `.nvmrc`, the npm lockfile, the script names `npm run typecheck` … `npm run check`.
- `lint:standard` is `micelio-lint-standard`, shipped inside `@micelio/eslint-config` (`packages/eslint-config/src/lint-standard.ts`); a repository without npm cannot run it.
- `scripts/standard-sync.sh` raises `@micelio/eslint-config` in `package.json`; a repository with no `package.json`, `package-lock.json` or `.nvmrc` fails the run (`docs/standard-sync.md`, "The upgrade").
- `.github/workflows/check.yml` takes `package-manager` `npm` or `pnpm` and reads Node from `.nvmrc` (`docs/workflows.md`).
- `template/` and `scripts/template.mjs` produce a Node repository (`docs/template.md`).
- The role prompts `worker.md`, `verifier.md` and `planner.md`, the skills `verify-pr` and `ship-pr`, the pull request template, `docs/factory.md` and `herdr/master.md` name `npm run check`, TSDoc, `npm ci` and tests as `path/to/file.test.ts`.

`lint-issue` and `metrics` (`packages/factory-tools/`) do not depend on the language of the repository they read.

Opening the standard to other languages reverses the scope set in 1.4 and changes files that are synced to three repositories and hashes that are published on npm. That is expensive to undo, so this is a gate 0 decision (`docs/factory.md`, "Gate 0 · Decision"). This is the first record of the repository: `docs/adr/` did not exist.

## Decision

The standard is split into a language-neutral core and one profile per language. The TypeScript and Node profile holds today's rules unchanged; Rust is the first new profile. This record changes no rule by itself and relaxes none for a Micelio repository; the files it names change in the issues of the epic that follows it.

1. **Which sections are core and which move.** Core: sections 1, 2, 3, 5, 6, 7, 8 (without the Strapi and Playwright lines, which move to the TypeScript profile as examples of its levels), 11, 12, 13 and 16. Profile: sections 4, 10, 14 and 15; the core states what each of them must achieve (typed code with documented exports, a pinned runtime, a lockfile, the required checks) and the profile states how. Section 9 is split: the core keeps the rules for any software (validate input at the boundary, least privilege, rate limiting, security fixes as their own pull request, private reports, OWASP ASVS, privacy and minimal personal data); the rules for a site engine (server-side HTML sanitizing, Content Security Policy, `security.txt`, WCAG 2.2, page budgets and sustainability) move to a "site engine" profile that only the repositories that serve sites adopt. The core stays at `docs/engineering-standard.md`, so the synced path does not move; profiles live at `docs/standard/<profile>.md`.
2. **Who is bound.** Every Micelio repository keeps core plus the TypeScript profile (plus the site engine profile where it serves sites). A repository outside Micelio adopts core plus one language profile by pinning it, and is bound by exactly that. The first paragraph of the standard is rewritten to say so, in place of the sentence quoted in Context.
3. **How a repository declares its profile.** `AGENTS.md` carries two pins on one line: `` `standard: 2.0` `` as today and `` `profile: typescript` `` (or `rust`, with `site-engine` added as a third, comma-separated). A repository with no `profile:` pin is read as `typescript` until the first release after the split, so no existing `AGENTS.md` breaks.
4. **The version that carries the split.** Version 2.0 (section 16), released once: the pin format, the layout of the documents and the scope of the standard change together, and a half-split standard would leave two meanings of "1.9". The work lands in several pull requests on one branch line and the version is raised and published only by the last, so `main` never carries a standard that `lint:standard` cannot check. The Rust profile is added in 2.1, not in 2.0, so 2.0 is a pure restructuring with no new rule.
5. **How `lint:standard` runs without npm.** The check keeps one implementation, `micelio-lint-standard`, and the hashes stay in `packages/eslint-config/standard-hashes.json`. A composite action of this repository (`.github/actions/lint-standard`) sets up Node and runs the published tool against the repository's copy, so a repository without npm calls the action in its CI and a command documented in its `AGENTS.md` instead of `npm run lint:standard`. The hashes cover the core and each profile file separately, keyed by version and profile.
6. **How `standard-sync` treats a repository with no `package.json`.** The sync reads the profile pin from `AGENTS.md` and runs only the steps that profile defines: for `typescript` the `@micelio/eslint-config` bump, the lockfile and `.nvmrc`; for any other profile it replaces the standard files and the `standard:` and `profile:` pins and nothing else. A repository outside Micelio joins `.github/standard-sync.json` only by a pull request here that lists it with its profile, and the Micelio bot is installed on it by the maintainer; a repository that does not join pins and copies by hand and `lint:standard` checks the pinned version.
7. **The check command.** The role prompts and the factory say "the check command" and "the test command" and never `npm run check`. A repository states its check command in the first block of `## Commands` in `AGENTS.md`, on a line that starts with `check:`; the profile defines the default (`npm run check` for TypeScript) and the repository's `AGENTS.md` wins. `ship-pr`, `verify-pr`, the draft and the verifier all run that one line.
8. **What stays Micelio's alone.** The licence policy and its allowlist (ADR 0007 of `bogd3v/micelio`: AGPL-3.0-only, the theme exception, the DCO), governance, trademarks, the sync bot's reach and the product contracts of section 6 that name Micelio's repositories. They move into a section marked "Micelio only" of the core, which binds the repositories of section 1 and nothing else. A repository outside Micelio chooses its own licence policy and records it in an ADR.
9. **The names.** "Micelio engineering standard", "Micelio factory" and the `@micelio/*` packages stay as they are, including when a repository outside Micelio uses them: the standard is still Micelio's, and a repository that adopts it says "follows the Micelio engineering standard, core plus the Rust profile" without claiming to be part of Micelio. Use of the name follows `docs/trademarks.md`. Renaming would break the published package names and the pins, and is a separate decision if it is ever wanted.

## Options considered

### A. A core and one profile per language

One standard, one place to change a rule that is not about a language, and one version to pin. The factory, which is language-neutral in its gates and roles, keeps one process. The TypeScript profile is today's text moved without edits, so no Micelio rule changes. Chosen.

### B. Make only the factory neutral and leave the standard as it is

The role prompts and the factory documents would stop naming npm, and the standard would stay Node-only. This is cheaper at first and touches no hash. It was not chosen because a Rust repository would then follow the factory with no standard to cite for its code, tests, dependencies and checks, and every such rule would be invented in its `AGENTS.md`, where the order of section 1 puts it below the standard it is not allowed to relax.

### C. One independent standard per language

Each language would have a full standard of its own. It gives each stack the most freedom. It was not chosen because the neutral sections (principles, contracts, versions, tests, git, documentation, agents, change control) would be copied and drift apart, and a fix to the review rules would be made once per language.

## Trade-offs

The standard becomes more than one file, so a reader needs the core and a profile, and the agent roles load more sections by name. A synced file set that is published on npm is changed once, with a major version, and the hashes of two documents have to be kept in step. Section 9 is split by judgement, and a rule may land in the wrong half until it is used in a second language. The decision is worth revisiting if a second profile after Rust shows that the core needs rules that only some languages can follow, or if the number of profiles makes one sync per profile too costly.

## Consequences

Nothing changes on the day this record is merged except the record: `docs/engineering-standard.md`, the files synced under `template/`, `scripts/standard-sync.sh`, the workflows and the packages are untouched, and no package version is bumped (section 7).

The epic that is created once this record is `Proposed` carries the work, in this order: the split of `docs/engineering-standard.md` into the core and `docs/standard/typescript.md` (and `site-engine.md`) with their hashes and the `profile:` pin in `lint:standard`; `.github/actions/lint-standard`; the profile steps of `scripts/standard-sync.sh` and `docs/standard-sync.md`; the neutral wording of the role prompts, the skills, the pull request template, `docs/factory.md` and `herdr/master.md`, and the "check command" line in `AGENTS.md` and `template/`; `check.yml` and `scripts/template.mjs` per profile; and, in 2.1, the Rust profile. Each is a pull request with the `docs(standard)` or `chore(factory)` prefix of its files, and the synced ones follow to the other repositories through the bot. The status of this record becomes `Accepted` when its pull request is merged; the maintainer reads and agrees each of the nine points before that.
