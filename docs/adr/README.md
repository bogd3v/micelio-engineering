# Architecture decision records

Decisions about the Micelio engineering standard and the shared tooling, the ones that are expensive to undo (standard, section 12). A record is never rewritten: a decision that changes gets a new record that supersedes the old one. Start from [`docs/adr-template.md`](../adr-template.md).

| Record                                                               | Decision                                                                 | Status   |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------ | -------- |
| [0001](0001-split-the-standard-into-a-core-and-language-profiles.md) | Split the standard into a core and language profiles                     | Accepted |
| [0002](0002-run-the-factory-stacks-on-rootless-podman.md)            | Run the factory host's stacks on rootless Podman behind `docker compose` | Accepted |
| [0003](0003-route-each-issue-through-a-lane-set-by-its-risk.md)      | Route each issue through a lane set by its risk                          | Proposed |
