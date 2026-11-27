# Architecture decision records

Decisions about the Micelio engineering standard and the shared tooling, the ones that are expensive to undo (standard, section 12). A record is never rewritten: a decision that changes gets a new record that supersedes the old one. Start from [`docs/adr-template.md`](../adr-template.md).

| Record                                                               | Decision                                                                              | Status   |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | -------- |
| [0001](0001-split-the-standard-into-a-core-and-language-profiles.md) | Split the standard into a core and language profiles                                  | Accepted |
| [0002](0002-run-the-factory-stacks-on-rootless-podman.md)            | Run the factory host's stacks on rootless Podman behind `docker compose`              | Accepted |
| [0003](0003-route-each-issue-through-a-lane-set-by-its-risk.md)      | Route each issue through a lane set by its risk                                       | Accepted |
| [0004](0004-run-the-factory-from-a-herdr-mod.md)                     | Run the factory from a Herdr mod, whose click sends the maintainer's line to a master | Accepted |
| [0005](0005-move-to-typescript-6-and-node-24.md)                     | Move to TypeScript 6 and Node 24, and wait for TypeScript 7 until the tools run on it | Proposed |
| [0006](0006-what-main-runs-after-a-pull-request.md)                  | Reuse a pull request's result on main only where a push publishes nothing             | Proposed |
