# AGENTS.md

The fixture of the `rust` profile of `.github/workflows/check.yml`.

## Commands

```bash
check: cargo fmt --check && cargo deny --version && reuse --version && cargo clippy --all-targets -- -D warnings && cargo test
```
