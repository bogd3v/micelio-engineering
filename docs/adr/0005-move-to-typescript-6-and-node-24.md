# ADR-0005: Move to TypeScript 6 and Node 24, and wait for TypeScript 7 until the tools run on it

**Status:** Proposed
**Date:** 2026-11-25
**Deciders:** The maintainer

## Context

Every repository pins TypeScript `^5.9.3` (`micelio-cms` writes `^5`) and Node 22 (`.nvmrc`). Node 22 is in maintenance and ends on 2027-04-30; Node 24 ends on 2028-04-30 and Node 26, LTS since 2026-10-28, on 2029-04-30 ([the Node release schedule](https://github.com/nodejs/Release), read 2026-11-25). TypeScript 6.0 (2026-03-23) is the last release on the JavaScript compiler ([announcement](https://devblogs.microsoft.com/typescript/announcing-typescript-6-0/), read 2026-11-25). TypeScript 7.0 (2026-07-08), the native compiler, shipped without a programmatic API ([announcement](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/), read 2026-11-25).

A higher minimum Node major is a MAJOR for an operator (section 7 of [the standard](../engineering-standard.md); before 1.0.0 it raises `y`), which makes the decision expensive to undo. The epic is bogd3v/micelio-engineering#440 and the issue of this record #447.

### Has a later release changed what 7.0 could not do

No, on 2026-11-25.

- The newest stable TypeScript is 7.0.2; 7.1 exists as `7.1.0-beta` of 2026-10-20 ([the registry's dist-tags](https://registry.npmjs.org/-/package/typescript/dist-tags), read 2026-11-25). Its [iteration plan](https://github.com/microsoft/TypeScript/issues/63703) (read 2026-11-25) had the stable release on 2026-11-24, which did not happen.
- The 7.1 beta ships a new API, different from the one of 6.0 ([announcement](https://devblogs.microsoft.com/typescript/announcing-typescript-7-1-beta/), read 2026-11-25), so a tool has to be ported to it.
- typescript-eslint and `vue-tsc` do not run on 7.0 (next table).

### What each tool supports

All read on 2026-11-25.

| Tool                     | Node                                                                                                            | TypeScript                                                                                                                                                                                                           | Sources                                                                                                                                                                                                                                                                          |
| ------------------------ | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Strapi 5.64.0            | The documentation: Active or Maintenance LTS, "currently v22, v24, and v26". The package: `>=22.0.0 <=26.x.x`   | The documentation names no version. `@strapi/typescript-utils` 5.64.0 depends on `typescript` 5.9.3 exactly                                                                                                          | [Installation](https://docs.strapi.io/cms/installation/cli), [TypeScript](https://docs.strapi.io/cms/typescript), [`@strapi/strapi`](https://registry.npmjs.org/@strapi/strapi/5.64.0), [`@strapi/typescript-utils`](https://registry.npmjs.org/@strapi/typescript-utils/5.64.0) |
| Nuxt 4.7.0               | The documentation: "22.x or newer", active LTS recommended. The package: `^22.22.3 \|\| ^24.15.0 \|\| >=26.0.0` | The documentation names no version and checks types with `vue-tsc`. With TypeScript 7, `nuxt typecheck` fails; the report is closed as not planned and a maintainer answers "we are all waiting"                     | [Installation](https://nuxt.com/docs/getting-started/installation), [TypeScript](https://nuxt.com/docs/guide/concepts/typescript), [the package](https://registry.npmjs.org/nuxt/4.7.0), [nuxt/nuxt#36440](https://github.com/nuxt/nuxt/issues/36440)                            |
| `vue-tsc` 3.3.14         | The package declares none                                                                                       | The peer range is `>=5.0.0`, but the published packages need the JavaScript API of TypeScript 6. Support for 7 is not published: the pull request for 7.1 is open, and the maintainers point to a third-party bridge | [The package](https://registry.npmjs.org/vue-tsc/3.3.14), [language-tools#5381](https://github.com/vuejs/language-tools/issues/5381), [#6124](https://github.com/vuejs/language-tools/issues/6124), [#6170](https://github.com/vuejs/language-tools/pull/6170)                   |
| typescript-eslint 8.74.0 | `^18.18.0 \|\| ^20.9.0 \|\| >=21.1.0`                                                                           | `>=4.8.4 <6.1.0`. TypeScript 7 is not supported; an experimental backend for 7.1 was merged on 2026-11-10                                                                                                            | [Dependency versions](https://typescript-eslint.io/users/dependency-versions), [#10940](https://github.com/typescript-eslint/typescript-eslint/issues/10940), [#12803](https://github.com/typescript-eslint/typescript-eslint/pull/12803)                                        |
| Vitest 5.1.2             | `^22.12.0 \|\| ^24.0.0 \|\| >=26.0.0`                                                                           | No TypeScript peer dependency. Its type checking mode runs `tsc` or `vue-tsc`, so it supports what they do                                                                                                           | [Getting started](https://vitest.dev/guide/), [Testing types](https://vitest.dev/guide/testing-types), [the package](https://registry.npmjs.org/vitest/5.1.2)                                                                                                                    |

`vue-tsc` was also run on a one-file Vue project with a type error, in `node:24`: with `typescript@6.0.3` and with `npm:@typescript/typescript6@6.0.2` it reported the error (TS2322); with `typescript@7.0.2` it stopped with `ERR_PACKAGE_PATH_NOT_EXPORTED` (`./lib/tsc`).

### Measurements

Taken on 2026-11-25 on this repository at `5455bbf` and on `micelio-plugin-core` at `9c9f7ee`, in the images `node:22` (`sha256:7702d8aa4d59`, Node 22.23.4, npm 10.9.9) and `node:24` (`sha256:49f7adaf9f15`, Node 24.22.3, npm 11.19.1) with rootless Podman 5.8.9 on an AMD Ryzen 5 5600X (12 threads), one clean clone per option and repository. "Wait for 7.1" is measured with `7.1.0-beta`, the only 7.1 there is; while waiting, a repository stays as in the first row.

| Option                                                      | Node, `@types/node` | `tsc` / API the linter loads | `typecheck` errors, this repository | `typecheck` errors, `plugin-core`: as is, then with its `tsconfig` changed | `lint` errors, each repository | `typecheck` wall time, this repository (s, 5 runs) | `typecheck` wall time, `plugin-core` (s, 5 runs) |
| ----------------------------------------------------------- | ------------------- | ---------------------------- | ----------------------------------- | -------------------------------------------------------------------------- | ------------------------------ | -------------------------------------------------- | ------------------------------------------------ |
| Stay                                                        | 22, 22              | 5.9.3 / 5.9.3                | 0                                   | 0, no change                                                               | 0 and 0                        | 4.70, 4.63, 4.18, 4.33, 4.85                       | 13.26, 13.03, 12.22, 12.86, 12.48                |
| TypeScript 6 with Node 24                                   | 24, 24.19.4         | 6.0.3 / 6.0.3                | 0                                   | 3, then 2                                                                  | 0 and 0                        | 4.13, 4.55, 3.94, 3.84, 4.48                       | 12.35, 10.98, 10.95, 12.88, 11.30                |
| TypeScript 6 for lint and editor, 7.0 `tsc` for `typecheck` | 24, 24.19.4         | 7.0.2 / 6.0.3                | 0                                   | 3, then 2                                                                  | 0 and 0                        | 0.50, 0.63, 0.52, 0.47, 0.56                       | 2.27, 1.87, 2.00, 2.30, 2.07                     |
| Wait for 7.1 (`7.1.0-beta`)                                 | 24, 24.19.4         | 7.1.0-beta / none            | 12                                  | 3, then 2                                                                  | ESLint does not start          | 0.41, 0.46, 0.37, 0.42, 0.41                       | 1.86, 1.64, 1.49, 1.58, 1.75                     |

The wall times were taken with other work on the host (1-minute load from 3.5 to 6.7), so read the order of magnitude, not the decimals. Node and the compiler change together between the first row and the others.

What the errors are:

- **`plugin-core`, as is (options 2 to 4).** Three, the sum over its three projects: `moduleResolution=node10` and `baseUrl` in `server/tsconfig.json`, and `baseUrl` in `admin/tsconfig.json`. 6.0 reports them as deprecated (TS5107, TS5101) and 7 as removed (TS5108, TS5102). `npm run typecheck` prints the two of `server` and stops there. The compiler checks no types until they are gone.
- **`plugin-core`, after the change.** For 6.0, `"ignoreDeprecations": "6.0"` in both files; for 7, `baseUrl` removed from both and `"moduleResolution": "bundler"` added to `server`. Two errors remain: TS2550, `Property 'at' does not exist on type 'string[]'`, in `server/src/code-highlight/rules.ts` and `server/src/site-export/names.ts`. They come from `@types/node` 24, not from the compiler: TypeScript 5.9.3 with `@types/node` 24.19.4 reports the same two. `@types/node` 22 declared `.at()` for every array, which hid that the preset of `@strapi/typescript-utils` sets `lib` to `ES2020`.
- **This repository, 7.1 beta.** Twelve, all in `packages/tsconfig/test/config.test.ts`, which imports the compiler's API from `typescript`. With option 3 that import still resolves to 6.0.
- **ESLint under 7.1 beta.** It exits 2 with `typescript-eslint does not support TS 7.0.` in both repositories. The other steps of `plugin-core`'s `lint` pass.

Also seen while installing:

- The published `@micelio/tsconfig` 0.1.0 and `@micelio/eslint-config` 0.2.11 declare `typescript` `^5.9.3` as a peer, and the first also `@types/node` `^22.20.5` ([`tsconfig`](https://registry.npmjs.org/@micelio/tsconfig/0.1.0), [`eslint-config`](https://registry.npmjs.org/@micelio/eslint-config/0.2.11), read 2026-11-25), so a repository that raises either gets `ERESOLVE overriding peer dependency` warnings until they are released again.
- `eslint-plugin-tsdoc` 0.5.4 depends on `@typescript-eslint/utils` `~8.56.0`, which accepts TypeScript below 6.0 ([the plugin](https://registry.npmjs.org/eslint-plugin-tsdoc/0.5.4), [the utils](https://registry.npmjs.org/@typescript-eslint/utils/8.56.1), read 2026-11-25), so npm installs a nested TypeScript 5.9.3 for it. `lint` passed.
- In `plugin-core`, `react-intl` 6 (a peer of Strapi's admin) declares the optional peer `typescript` `^4.7 || 5` ([`react-intl` 6.8.9](https://registry.npmjs.org/react-intl/6.8.9), read 2026-11-25): `npm ls` marks 6.0 as invalid. `npm ci` from the new lockfile succeeded.

#### Commands

Each clone was prepared in the container with:

| Option          | Edits to `package.json` (the root and, here, `packages/*` and `fixtures/*`, `devDependencies` and `peerDependencies`)  | Install, each with `--no-audit --no-fund` |
| --------------- | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| Stay            | None                                                                                                                   | `npm ci`                                  |
| TypeScript 6    | `typescript` `6.0.3`, `@types/node` `24.19.4`                                                                          | `npm install`                             |
| 6 and 7.0 `tsc` | `typescript` `npm:@typescript/typescript6@6.0.2`, `@typescript/native` `npm:typescript@7.0.2`, `@types/node` `24.19.4` | `npm install`                             |
| 7.1 beta        | `typescript` `7.1.0-beta`, `@types/node` `24.19.4`                                                                     | `npm install --force`                     |

In `plugin-core`, the three changed options also add npm `overrides` that point the peers of `@micelio/tsconfig` and `@micelio/eslint-config` at those versions. `npx tsc --version` was checked in every clone.

- Errors: `npm run typecheck` and `npm run lint`, then each of their steps on its own, so that the first failure hides no other. Here: `npx tsc -b packages/eslint-config packages/prettier-config packages/factory-tools`, `npx tsc -p tsconfig.json --noEmit`, `npx tsc --noEmit` and `npx eslint .` in `fixtures/basic`, and `npx eslint .` at the root. In `plugin-core`: `npx tsc -p <server/tsconfig.json | admin/tsconfig.json | tsconfig.json> --noEmit`, `npx eslint .`, `npm run lint:blocks`, `npm run lint:preview` and `npm run lint:icons`.
- Wall time: the steps of `typecheck` run with `node_modules/.bin/tsc`, joined with `;`, after removing every `dist/` and `*.tsbuildinfo` outside `node_modules`, timed with `date +%s%N` around them, in five rounds that go through the four options in turn. `plugin-core`'s changed options are timed with the changed `tsconfig` files, so all its projects are checked.

## Decision

1. **TypeScript 6.0 and Node 24 are the next majors.** `typescript` `^6.0.3` for the compiler, the linter and the editor; `.nvmrc` `24`; `engines.node` `>=24.15.0` (the floor [Nuxt 4.7.0](https://registry.npmjs.org/nuxt/4.7.0) and [`eslint-plugin-jsdoc` 65.5.5](https://registry.npmjs.org/eslint-plugin-jsdoc/65.5.5) ask of Node 24, read 2026-11-25), which in `micelio-cms` is `>=24.15.0 <=24.x.x`; `@types/node` `^24`.
2. **The move fixes what 7 removes instead of silencing it.** No repository sets `ignoreDeprecations`: `baseUrl` and `moduleResolution: node10` go, also where a Strapi preset sets them.
3. **TypeScript 7 is not adopted yet, not even for `typecheck` alone.** A new record decides it once typescript-eslint and `vue-tsc` publish releases that declare and run on a stable 7.x.
4. **The date.** Every repository has published its release on Node 24 by **2027-03-31**, a month before Node 22 ends.
5. **The order.** Each step is one pull request or more in its repository, and starts when the step before it is released.

| Step | Repository                 | What changes                                                                                                                                    | Release                                              |
| ---- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| 1    | `micelio-engineering`      | The configuration packages accept both: peers `typescript` `^5.9.3 \|\| ^6.0.3` and `@types/node` `^22.20.5 \|\| ^24`. `engines` stays          | A PATCH of each package that changes: nothing breaks |
| 2    | `micelio-plugin-core`      | TypeScript 6, Node 24, its `tsconfig` files and the two `.at()` errors, `docker/cms`                                                            | The next `y` (0.7.0 from 0.6.0), breaking            |
| 3    | `micelio-plugin-fediverse` | The same, and its `peerDependencies` accept the new core                                                                                        | The next `y` (0.8.0 from 0.7.3), breaking            |
| 4    | `micelio-cms`              | The same, `node:22-alpine` to `node:24-alpine`, and the two new plugin versions                                                                 | The next release line, with step 5                   |
| 5    | `micelio`                  | The same, the builder to `node:24-slim` and the runtime to `gcr.io/distroless/nodejs24-debian13` or `-debian12`                                 | The next release line (0.10 from 0.9), breaking      |
| 6    | `micelio-engineering`      | `.nvmrc`, `engines`, the template, `.github/actions/lint-standard` (which names Node 22 itself), the peers narrowed to TypeScript 6 and Node 24 | The next `y` of each package, breaking               |

`micelio` and `micelio-cms` raise the line together (section 7, "The release line"). An operator upgrades the CMS first, as always. The numbers are those that follow today's tags and are not a promise: if another release takes one, the move takes the next.

6. **What the upgrade notes say to an operator.** In each breaking release of steps 2 to 5, under "Breaking changes" and "Upgrade notes":

   > **Node 24.15 or later is now required.** Node 22 is no longer supported.
   >
   > - If you run the published images (`micelio`, `micelio-cms`, `micelio-builder`), they bring Node 24: pull the new tags. You install nothing, and this change needs no database migration and no new variable.
   > - If you build an image on top of one of them, rebuild it from the new tag, so that its native modules are compiled for Node 24.
   > - If you run from source, or install a `@micelio/strapi-plugin-*` package in your own Strapi, upgrade Node **before** you upgrade the package. In production, the core plugin refuses to boot on a Node outside its `engines` (its host check `node`).
   > - If you run the static site workflow or your own CI from a copy of the repository, merge the new `.nvmrc`.
   > - Upgrade the CMS first, then the frontend. Back up before upgrading: going back across a MINOR is not supported.

   Each release also states its minimum Node and PostgreSQL versions (section 7, "Release notes"), and the plugins state the release line they support.

## Options considered

### A. TypeScript 6 with Node 24 (chosen)

Every tool in the table supports it today. This repository passes `typecheck` and `lint` as it is; `plugin-core` needs two `tsconfig` changes and two lines of code. It does the part of the move to 7 that can be done now (the removed options) and leaves one compiler. It is not faster: the wall times are in the range of today's.

### B. Stay on 5.9 and 22

No work and no break for an operator until 2027-04-30, when Node 22 stops receiving security fixes. The move still has to happen, with less time. Not chosen.

### C. TypeScript 6 for lint and editor, 7.0 `tsc` for `typecheck`

`typecheck` took about 0.5 s here and 2 s in `plugin-core`, against 4 s and 11 to 13 s with 6.0. It costs two compilers that can disagree (7 orders types differently from 6.0), an npm alias under the name `typescript`, and a `tsconfig` that cannot silence a removed option. `micelio` would gain little or nothing: its `typecheck` runs `nuxi typecheck` and `vue-tsc`, which stay on the 6.0 API. At 13 seconds at most in the repositories measured, the gain does not pay for it. Worth reopening if a `typecheck` becomes slow enough to matter.

### D. Wait for 7.1

One move instead of two. But 7.1 has no stable release, typescript-eslint and `vue-tsc` have none for it, and with the beta ESLint does not start. Waiting ties the Node deadline to dates this project does not control. Not chosen; Decision 3 takes it up later.

### Node 26 instead of 24

LTS since 2026-10-28 and supported a year longer. Not chosen: it was not measured, `micelio-cms` declares `<=24.x.x`, and it has been LTS for four weeks.

## Trade-offs

- **Two moves of TypeScript.** 6.0 is a bridge: a second record and a second round of pull requests take the repositories to 7.
- **A window with two Node majors.** Section 10 of the TypeScript profile says all repositories run the same Node major. Between steps 2 and 6 they cannot. Accepting this record accepts that window, until 2027-03-31.
- **A break for operators who bring their own Node**, in four repositories.
- **`.nvmrc` `24` is not 24.15.** `engines` is the floor; an old Node 24 installed by hand fails it.
- **What would make the decision worth revisiting:** typescript-eslint and `vue-tsc` releasing 7 support before step 2 starts, or Strapi dropping Node 24.

### What was not measured

- `micelio`, `micelio-cms` and `micelio-plugin-fediverse`. Their `tsconfig` files were read: `micelio-cms`'s root one sets `moduleResolution: Node` with `module: CommonJS`, which 6.0 deprecates, and the server it compiles is what Strapi loads, so its step proves the build and the boot, not `typecheck` alone.
- Tests, builds, images and a running stack on Node 24 or TypeScript 6, in any repository.
- Typed lint rules (#443): at the commits measured, `lint` loads no type information, so these numbers say nothing about its time or errors with them.

## Consequences

Nothing is adopted by this record: no dependency, `.nvmrc` or `engines` changes with it, and neither does the standard; the line that bogd3v/micelio-engineering#446 adds to section 10 of the TypeScript profile points here. It adds this file and its row in [`docs/adr/README.md`](README.md). Once the maintainer accepts it, the issues of the six steps are written, one repository each.
