#!/usr/bin/env bash
# A worker that never fixes anything, for the escalation test (fixtures/factory/RUN.md, run 3).
#
#   fixtures/factory/never-fixes/stub-worker.sh <draft> <round> <findings file>
#
# It answers the round the way a worker that does not understand the finding would: it appends an
# "Answers to review" section to the draft (`<dir>/draft.md` of build-scratch.sh, outside the
# repository) saying everything is fixed, and leaves the code, the tests and the Tests section
# exactly as they were. So the reviewer is red again every round. It exits 0, and prints the one
# line the master reads.
set -euo pipefail

usage='usage: stub-worker.sh <draft> <round> <findings file>'
draft="${1:?$usage}"
round="${2:?$usage}"
findings="${3:?$usage}"
[ -f "$draft" ] || { echo "no draft: $draft" >&2; exit 2; }
[ -f "$findings" ] || { echo "no findings file: $findings" >&2; exit 2; }

{
  printf '\n## Answers to review\n\n'
  printf 'Round %s: every finding is fixed. The code is correct as written and the tests pass.\n' "$round"
} >> "$draft"
echo "stub-worker round $round: answered $(grep -c . "$findings") lines of findings, changed nothing"
