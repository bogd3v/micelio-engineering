# Governance

How decisions are made in Micelio today. It is a small project with one maintainer, and this document says so instead of pretending otherwise. It changes as the project does. It covers every Micelio repository.

## Who decides

Micelio has one maintainer, Alejandro Ramirez Garcia, who decides what is merged, released and recorded as a decision. Everyone else contributes through issues and pull requests, under the terms of [contributing.md](contributing.md) and the Code of Conduct of the organisation's [`bogd3v/.github`](https://github.com/bogd3v/.github).

The maintainer is also the proxy of section 14 of the AGPL named in the `LICENSE` of the Micelio repositories: a public statement of acceptance by the proxy authorizes a later version of the AGPL for Micelio, and nothing else. The reasons are in [ADR 0007](https://github.com/bogd3v/micelio/blob/main/docs/adr/0007-license.md).

## How a decision is proposed and recorded

1. **Propose it** as an issue from the proposal template. Bugs and proposals are how anyone reports; tasks and epics are the plan, written by maintainers and agents.
2. **Discuss it** in the issue. Questions that are not proposals belong in Discussions; an answer given twice becomes documentation.
3. **Decide it.** The maintainer accepts, declines or asks for changes, and says why in the issue.
4. **Record it** when it is expensive to undo, as an ADR written from the [template](adr-template.md). Where it lives, and which decisions need one, is section 12 of the [engineering standard](engineering-standard.md). Nothing normative lives only in an issue or a chat.

While the version is `0.y.z`, contracts may break without an ADR, as [ADR 0010](https://github.com/bogd3v/micelio/blob/main/docs/adr/0010-semantic-versioning.md) explains. An expensive decision still gets one.

## How the standard changes

By a `docs(standard)` pull request to its canonical copy in this repository, as section 16 of the standard says. An exception for one repository is an ADR there, not an edit to the standard.

## Becoming a maintainer

There is no fixed list of requirements. The maintainer invites someone after a sustained record of contributions that were merged with little rework, reviews of other people's pull requests, and conduct that follows the Code of Conduct. The invitation is recorded in an ADR, which also says what the new maintainer may merge or decide. A maintainer who is no longer active is thanked and moved to emeritus the same way.

If the maintainer stops working on the project, the section 14 proxy and the trademark in [trademarks.md](trademarks.md) pass to whoever the maintainer assigns them to. That succession is itself recorded in an ADR.

## Conduct

Reports under the Code of Conduct are handled by the maintainer. Anyone who is the subject of a report is not involved in deciding it.
