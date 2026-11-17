# AGENTS.md

Instructions for coding agents working in this repository. {{description}}

## Engineering standard

The rules shared by every Micelio repository live in [`docs/engineering-standard.md`](docs/engineering-standard.md), the core, and in the Rust profile, [`docs/standard/rust.md`](docs/standard/rust.md). This repository follows standard version {{standard}} with that profile (`standard: {{standard}}`, `profile: rust`; the `lint-standard` step of CI checks both copies against the hashes of `@micelio/eslint-config`). This file adds what is specific to this repository and never relaxes the standard. The copy is kept in step by the Micelio bot's `docs(standard): sync to X.Y` pull requests: review and merge them, do not edit the files by hand.

## Commands

```bash
install: cargo fetch --locked
test: cargo test --locked
check: cargo fmt --check && cargo clippy --all-targets --locked -- -D warnings && cargo test --locked && RUSTDOCFLAGS="-D warnings" cargo doc --no-deps --locked && cargo deny check licenses
cargo build --locked --release   # builds the library
```

`cargo deny` is `cargo install cargo-deny --locked`; `cargo audit --deny warnings` (`cargo install cargo-audit --locked`) is run by CI.

## Structure

- `src/` — the code, with its unit tests and doctests next to it.
- `deny.toml` — the licence allowlist; `rust-toolchain.toml` — the pinned toolchain.
- `.github/workflows/` — `ci.yml`, `pr-labels.yml` and `issue-ready.yml`; CI calls the reusable workflows of `micelio-engineering`.

## Rules

- Hard limits: `.claude/TEAM.md`. Never push, merge, tag, release or deploy without the human's approval, and never read secrets.
- Work moves through the gates of the Micelio factory ([`docs/factory.md`](https://github.com/bogd3v/micelio-engineering/blob/main/docs/factory.md) in `micelio-engineering`): planner, master, worker, blind reviewer, verifier, then the maintainer.
