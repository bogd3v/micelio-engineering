# Contributing to {{title}}

Thanks for helping. The terms of a contribution are Micelio's, shared by every repository, and live in
[`micelio-engineering`](https://github.com/bogd3v/micelio-engineering/blob/main/docs/contributing.md): the
Developer Certificate of Origin and the pull request template. The license of your contribution is this
repository's, [{{license}}](LICENSE). The rules for the work are the
[engineering standard](docs/engineering-standard.md) and its [Rust profile](docs/standard/rust.md).

## What is specific to this repository

- Commands, structure and conventions are in [AGENTS.md](AGENTS.md).
- Run the check command of `AGENTS.md` before opening the pull request.
- Third-party material goes in [THIRD-PARTY.md](THIRD-PARTY.md) and [REUSE.toml](REUSE.toml); `reuse lint`
  checks it in CI.
- Decisions that are expensive to undo are ADRs in `docs/adr/`, written from the
  [template](https://github.com/bogd3v/micelio-engineering/blob/main/docs/adr-template.md).
- Report a vulnerability privately, through the repository's security policy.
