# fixture-rust-basic

A minimal Rust library with one test. `ci.yml` calls `check.yml` on it with `profile: rust`,
which installs the toolchain of `rust-toolchain.toml` and runs the `check:` line of `AGENTS.md`.
