#!/usr/bin/env bash
# Builds the scratch repository a factory fixture is run in (fixtures/factory/RUN.md).
#
#   fixtures/factory/build-scratch.sh planted-coverage|never-fixes <empty dir>
#
# It writes two things into <dir>, both built from the fixture's own files and nothing else:
#
# - <dir>/repo: the scratch repository. Its first commit is the base that the reviewer and the
#   verifier merge-base against, as `origin/main`, and holds `AGENTS.md` (which names the check),
#   `ISSUE.md` (the issue, numbered #1) and `docs/engineering-standard.md`. The work is left
#   uncommitted and marked with `git add -N`, like a worker's work before gate 5.
# - <dir>/draft.md: the pull request draft, outside the repository, like a worker's draft.
#
# RUN.md is never copied: it holds the expected results.
set -euo pipefail

usage='usage: build-scratch.sh planted-coverage|never-fixes <empty dir>'
here="$(cd "$(dirname "$0")" && pwd)"
fixture="${1:?$usage}"
target="${2:?$usage}"
case "$fixture" in
  planted-coverage | never-fixes) ;;
  *) echo "unknown fixture: $fixture" >&2; exit 2 ;;
esac
[ -z "$(ls -A "$target" 2>/dev/null)" ] || { echo "$target is not empty" >&2; exit 2; }
mkdir -p "$target/repo/docs"
target="$(cd "$target" && pwd)"
repo="$target/repo"
cp "$here/../../docs/engineering-standard.md" "$repo/docs/"

if [ "$fixture" = planted-coverage ]; then
  src="$here/planted-coverage"
  cp "$here/wrong-test-count.md" "$target/draft.md"
else
  src="$here/never-fixes/project"
  cp "$here/never-fixes/draft.md" "$target/draft.md"
fi
cd "$repo"

git init --quiet --initial-branch=main
git config user.name "A. Author"
git config user.email "author@example.invalid"

# The base.
cp "$src/AGENTS.md" "$src/ISSUE.md" "$src/package.json" .
if [ "$fixture" = planted-coverage ]; then
  mkdir src test
  cp "$src/src/slug.mjs" src/
  cp "$src/test/slug.test.mjs" test/
  printf "export { MAX_SLUG_LENGTH, slugify } from './slug.mjs'\n" > src/index.mjs
  node -e '
    const fs = require("node:fs")
    const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"))
    pkg.scripts.test = pkg.scripts.test.replace("--test-coverage-lines=50", "--test-coverage-lines=80")
    fs.writeFileSync("package.json", JSON.stringify(pkg, null, 2) + "\n")
  '
fi
git add -A
# The user's signing key and hooks have no place in a scratch commit.
git -c commit.gpgsign=false -c core.hooksPath=/dev/null commit --quiet -m "chore: start the project"
git update-ref refs/remotes/origin/main HEAD

# The work.
if [ "$fixture" = planted-coverage ]; then
  cp "$src/package.json" package.json
  cp "$src/src/index.mjs" "$src/src/page.mjs" src/
else
  mkdir -p src test
  cp "$src/src/clamp.mjs" src/
  cp "$src/test/clamp.test.mjs" test/
fi
git add -N .
git status --short
