# Standard sync

The engineering standard has one canonical copy, `docs/engineering-standard.md` in this repository. Every other Micelio repository keeps a copy of it for its agents, and nobody edits that copy by hand: the Micelio bot carries it over, and `lint:standard` fails when a copy differs from the version a repository pins.

## Releasing a new version of the standard

1. Open a pull request titled `docs(standard): …` that changes `docs/engineering-standard.md`, raises its `Version X.Y` line, adds a row to the table of section 16, and adds the SHA-256 of the new file to `packages/eslint-config/standard-hashes.json` (`sha256sum docs/engineering-standard.md`). The tests fail when the hash and the file disagree, and a published version never changes: a fix is the next version. The pin in this repository's `AGENTS.md` moves in the same pull request.
2. Merge it, raise `@micelio/eslint-config` in a `chore(release)` pull request and publish it (`eslint-config-vX.Y.Z`, `publish-packages.yml`), so that the new hash is on npm.
3. Create a GitHub release of this repository, by hand or with the bot, whose notes contain a line `Standard: X.Y`. Publishing it starts `standard-sync.yml`.

`standard-sync.yml` can also be started by hand (Actions, Standard sync) with a version and `dry-run`, which lists what would change without opening anything.

## What the workflow does

For each repository in `.github/standard-sync.json` it clones the repository as the Micelio bot, replaces `docs/engineering-standard.md`, moves the pin in `AGENTS.md` (the `` `standard: X.Y` `` token and the sentence "follows standard version X.Y") and opens or updates the pull request `docs(standard): sync to X.Y` from the branch `docs/standard-sync-X.Y`. A repository that is already on the version is skipped, and one whose `AGENTS.md` has no pin is reported and fails the run without stopping the others.

- **The bot never merges.** It has contents and pull-request write on the listed repositories and nothing else; a human reviews and merges. A repository may stay on an older version on purpose: close the pull request.
- **The bot's commits are not signed off** (section 13: the sign-off is a person's certification), so `dco.yml` skips them like Dependabot's. A repository's own copy of the DCO workflow needs the same exemption until it calls the reusable one.
- **The private key** is the organisation secret `MICELIO_BOT_PRIVATE_KEY` and the app id the variable `MICELIO_BOT_APP_ID`. Only the token step reads the key; it never reaches a repository or a log.
- **Adding a repository** is an entry in `.github/standard-sync.json` and in the `repositories` of the token step, which a test keeps equal.

## `lint:standard`

`@micelio/eslint-config` ships the command `micelio-lint-standard`; a repository's script is `"lint:standard": "micelio-lint-standard"`, and it belongs in `npm run check`. It reads the pin from `AGENTS.md` and compares the SHA-256 of `docs/engineering-standard.md` with the one published for that version in `standard-hashes.json`. The pinned version is checked, not the latest. A version newer than the installed package knows fails with a message that says to upgrade the package: the pull request of a sync to a new version needs that upgrade too.
