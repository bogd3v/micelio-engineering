# Contributing to Micelio

The terms of a contribution to any Micelio repository. Each repository has a short `CONTRIBUTING.md` that links this file and adds only what is specific to it (its commands, its structure, how to run it). The rules for the work itself, such as branches, commits, reviews and tests, are in the [engineering standard](engineering-standard.md); this file does not repeat them.

## License of your contribution

Micelio's code is licensed under the [GNU AGPL-3.0-only](https://github.com/bogd3v/micelio/blob/main/LICENSE). The frontend adds the [theme exception](https://github.com/bogd3v/micelio/blob/main/LICENSE-EXCEPTION.md), an additional permission under section 7 for themes that use only the theme contract. The shared tooling in `micelio-engineering` is MIT-0, as each package says. The repository you contribute to states its own license in its `LICENSE`.

By contributing you license your contribution under the license of the repository, and also:

- under any **additional permission** under section 7 of the AGPL that Micelio's maintainer (the section 14 proxy named in the repository's `LICENSE`) publishes later for Micelio, as was done for themes. Such a permission can only give everyone more rights over Micelio, never restrict them, and Micelio itself stays under the AGPL;
- under any later version of the GNU AGPL that the same proxy accepts for Micelio (section 14). This covers later versions of the AGPL only, never another license.

You keep your copyright; there is no CLA. The reasons are in [ADR 0007](https://github.com/bogd3v/micelio/blob/main/docs/adr/0007-license.md).

Only contribute work you have the right to contribute. Third-party material (code, fonts, images, logos) keeps its own license: add it only if that license allows it, keep its license file next to it, list it in the repository's `THIRD-PARTY.md` and annotate its path in `REUSE.toml` (`reuse lint` checks it in CI). New production dependencies must pass `npm run lint:licenses`, which section 10 of the standard describes.

## The theme exception

A theme that interacts with Micelio only through the theme contract (ADR 0005) is not covered by the AGPL and may be distributed under any license, including a proprietary one. That holds only while the theme stays inside the contract: a theme that imports internal components or composables, or uses non-public classes, is not covered. Changes to Micelio itself, including to the contract, stay under the AGPL. The exact text is in the [exception](https://github.com/bogd3v/micelio/blob/main/LICENSE-EXCEPTION.md).

## Developer Certificate of Origin

Every commit must be signed off, certifying the [Developer Certificate of Origin 1.1](https://developercertificate.org/):

```bash
git commit -s -m "fix(newsletter): …"
```

This adds a `Signed-off-by: Your Name <you@example.com>` line that must match the commit's author. The `DCO` check fails a pull request with a commit that lacks it; to fix the last commits, run `git rebase --signoff main` and force-push the branch.

The sign-off is a person's certification. A coding agent, or the Micelio bot, does not give it: the human who reviewed the change signs off, and the `Co-Authored-By` trailer names the tool (standard, section 13). The `DCO` check skips commits of the bot, which only syncs the standard and leaves the pull request to a human.

## Pull requests

Open the pull request from the repository's template (`.github/pull_request_template.md`): Problem, What changes, For review and Tests, with the real numbers of `npm run check`. What makes a change done is the **Done** list of section 11 of the standard, which the reviewer checks against the pull request.

## Conduct and security

Everyone taking part follows the Code of Conduct, and a vulnerability is reported privately, never in a public issue, pull request or discussion. Both documents are served to every repository from the organisation's [`bogd3v/.github`](https://github.com/bogd3v/.github) (`CODE_OF_CONDUCT.md` and `SECURITY.md`).

How decisions are made, and how someone becomes a maintainer, is in [governance.md](governance.md); what you may do with the Micelio name and logo is in [trademarks.md](trademarks.md).
