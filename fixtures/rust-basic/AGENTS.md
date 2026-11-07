# AGENTS.md

The fixture of the `rust` profile of `.github/workflows/check.yml`.

## Commands

```bash
check: cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test
```
