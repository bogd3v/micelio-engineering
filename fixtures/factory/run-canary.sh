#!/usr/bin/env bash
# The master's canary (fixtures/factory/RUN.md, "Canary"): the three runs of agents, started with hc as herdr/master.md
# ("Starting an agent") says, each in a new terminal in the scratch directory of its run, each report moved out of the next agent's reach, and the two lane cases (runs 4 and 5), which run a command of
# the checkout and need no agent. Build the checkout first (npm run build).
#
#   fixtures/factory/run-canary.sh <label> <checkout>
#
# <label> is 1 to 15 of a-z, 0-9, dashes and underscores (it goes into agent names, which hc limits to
# 32 characters of a-z 0-9 - _). The scratch repositories are ~/Git/scratch-pages-<label> and
# ~/Git/scratch-clamps-<label>; the results, the reports and the token counts go to $CANARY_OUT (default
# ~/.cache/factory/packets/canary-<label>). All three directories must be empty or new: the script never
# reuses an earlier run. ONLY3=1 runs only run 3 (and no lane case). It reads no RUN.md: the agents never do.
#
# Exit status: 0 when every run started and gave its expected verdict; 1 when an agent did not start, a
# report is missing, a lane case gives another result, a round of run 3 is not red, has no findings or none on src/clamp.mjs:10, run 1 has no Blocking on package.json:8, or a verdict is not the expected one
# (the lines are in results.txt, after `FAILED:`); 2 for a bad argument or a directory in use.
set -uo pipefail

usage='usage: run-canary.sh <label> <checkout>'
L=${1:?$usage}
SRC=${2:?$usage}
[[ $L =~ ^[a-z0-9_-]{1,15}$ ]] || { echo "bad label: $L ($usage)" >&2; exit 2; }
SRC=$(cd "$SRC" && pwd) || { echo "no checkout: $2" >&2; exit 2; }
TOK="$SRC/fixtures/factory/tok.py"
OUT=${CANARY_OUT:-$HOME/.cache/factory/packets/canary-$L}
P=$HOME/Git/scratch-pages-$L
C=$HOME/Git/scratch-clamps-$L
for d in "$OUT" "$P" "$C"; do
  [ -z "$(ls -A "$d" 2>/dev/null)" ] || { echo "$d is not empty" >&2; exit 2; }
done
mkdir -p "$OUT" "$P" "$C"

nap() { sleep "${CANARY_NAP:-$1}"; }
note() { echo "$*" >> "$OUT/results.txt"; }
bad() { note "FAILED: $*"; }

# start <name> <dir> <agent> <model>: a new terminal in <dir> whose program enters the agent's slice, then claude
# with a session id the script chooses (SID, which finish writes down).
start() {
  local o
  SID=$(uuidgen 2> /dev/null || cat /proc/sys/kernel/random/uuid 2> /dev/null)
  [[ $SID =~ ^[0-9a-f-]{36}$ ]] || { bad "start failed $1: no session id (uuidgen and /proc/sys/kernel/random/uuid gave none)"; return 1; }
  o=$(hc run --bg --name "$1" --cwd "$2" --no-notify -- "$SRC/herdr/factory-agent.sh" enter "$1" 2>&1) || { bad "start failed $1: $o"; return 1; }
  hc wait "$1" > /dev/null 2>&1
  o=$(hc send "$1" "claude --agent $3 --model $4 --session-id $SID" 2>&1) || { bad "start failed $1: $o"; return 1; }
  hc wait "$1" > /dev/null 2>&1
}
# finish <name>: writes the session id the script gave claude, then ends the agent.
finish() {
  local i
  echo "$SID" > "$OUT/session-$1.txt"
  hc kill "$1" > /dev/null 2>&1
  for i in 1 2 3 4 5; do hc rm "$1" > /dev/null 2>&1 && break; nap 1; done
  "$SRC/herdr/factory-agent.sh" stop "$1" > /dev/null
}
# line1 <summary.md>: the verdict line, empty when the file is missing.
line1() { [ -f "$1" ] && sed -n 1p "$1"; }
# rev <dir> <round> <extra>: the reviewer's prompt of herdr/master.md, with the issue as a file.
rev() {
  echo "Use the blind-review skill (.claude/skills/blind-review/SKILL.md). Worktree: $1/repo. Branch: main. Issue: $1/repo/ISSUE.md. Maintainer's decisions: $1/packets/1/r$2/decisions.md. Draft, for its \"Instructions that were wrong or missing\" section only: $1/draft.md.$3 Write report.md and summary.md in $1/packets/1/r$2/review/."
}
# diff <dir> <round>: the round's diff.patch of the scratch repository.
diff_of() { git -C "$1/repo" diff "$(git -C "$1/repo" merge-base HEAD origin/main)" > "$1/packets/1/r$2/diff.patch"; }

"$SRC/fixtures/factory/build-scratch.sh" planted-coverage "$P" > /dev/null || { bad "build-scratch planted-coverage"; cat "$OUT/results.txt"; exit 1; }
"$SRC/fixtures/factory/build-scratch.sh" never-fixes "$C" > /dev/null || { bad "build-scratch never-fixes"; cat "$OUT/results.txt"; exit 1; }
for D in "$P" "$C"; do
  mkdir -p "$D/.claude/agents" "$D/.claude/skills" "$D/packets/1/r1/review"
  cp "$SRC/.claude/agents/reviewer.md" "$SRC/.claude/agents/verifier.md" "$D/.claude/agents/"
  cp -r "$SRC/.claude/skills/blind-review" "$SRC/.claude/skills/verify-pr" "$D/.claude/skills/"
  echo None > "$D/packets/1/r1/decisions.md"
  diff_of "$D" 1
done

run3() {
  local k a x n v
  for k in 1 2 3; do
    a=e94_c${L}_3_review-r$k
    x=""
    [ "$k" -gt 1 ] && x=" Read the hunks that changed since $C/packets/1/r$k/prev.patch first. A new Important finding in text that did not change is not a finding of this round: list it under \`Follow-up\` in the report."
    start "$a" "$C" reviewer opus || { bad "run3 r$k: agent did not start"; return 1; }
    hc send "$a" "$(rev "$C" "$k" "$x")" --wait --timeout 1800 > /dev/null
    finish "$a"
    mkdir -p "$OUT/clamps/r$k"
    mv "$C/packets/1/r$k/review" "$OUT/clamps/r$k/review" || { bad "run3 r$k: no review directory"; return 1; }
    v=$(line1 "$OUT/clamps/r$k/review/summary.md")
    note "run3 r$k: $v | $(grep -E '^B[0-9]' "$OUT/clamps/r$k/review/summary.md" | cut -c1-90 | head -2 | tr '\n' ' ')"
    [[ $v == "Verdict: Red"* ]] || { bad "run3 r$k: not red, the stub does not answer a round that passed ($v)"; return 1; }
    grep -E '^(B|I)[0-9]' "$OUT/clamps/r$k/review/summary.md" > "$OUT/findings-r$k.txt"
    [ -s "$OUT/findings-r$k.txt" ] || { bad "run3 r$k: red with no Blocking or Important line"; return 1; }
    grep -Eq '^B[0-9].*src/clamp\.mjs:10' "$OUT/findings-r$k.txt" || { bad "run3 r$k: no Blocking on src/clamp.mjs:10, the planted defect"; return 1; }
    if [ "$k" -lt 3 ]; then
      "$SRC/fixtures/factory/never-fixes/stub-worker.sh" "$C/draft.md" "$k" "$OUT/findings-r$k.txt" >> "$OUT/results.txt" || { bad "run3 r$k: the stub failed"; return 1; }
      n=$((k + 1))
      mkdir -p "$C/packets/1/r$n/review"
      echo None > "$C/packets/1/r$n/decisions.md"
      diff_of "$C" "$n"
      cp "$C/packets/1/r$k/diff.patch" "$C/packets/1/r$n/prev.patch"
      cmp -s "$C/packets/1/r$k/diff.patch" "$C/packets/1/r$n/diff.patch" && note "diff unchanged r$k->r$n"
    fi
  done
  note "run3: no fourth round started"
}

# tokens <pattern>: the token counts of the sessions found.
tokens() {
  local f
  for f in "$OUT"/$1; do
    [ -f "$f" ] || continue
    echo "$(basename "$f" .txt) $("$TOK" "$(cat "$f")" 2> /dev/null || echo 'no log')" >> "$OUT/tokens.txt"
  done
}
report() { cat "$OUT/results.txt"; cat "$OUT/tokens.txt" 2> /dev/null; grep -q '^FAILED:' "$OUT/results.txt" && exit 1; exit 0; }

# Run 3 — escalation after the third red round (never-fixes, three rounds with the stub, a new reviewer each)
run3 &
r3=$!
if [ "${ONLY3:-}" = 1 ]; then
  wait "$r3" || true
  tokens 'session-*3_review*.txt'; report
fi

# Run 4 — the express diff is raised to normal (lane-express: lint-lane --diff of a diff that touches AGENTS.md)
run4() {
  local d=$OUT/lane-express out rc base cli=$SRC/packages/factory-tools/dist/cli.js
  "$SRC/fixtures/factory/build-scratch.sh" lane-express "$d" > /dev/null || { bad "build-scratch lane-express"; return 1; }
  base=$(git -C "$d/repo" merge-base HEAD origin/main)
  out=$(cd "$d/repo" && node "$cli" lint-lane --file ISSUE.md | sed -n 1p)
  [ "$out" = "lane: express" ] || { bad "run4: the issue is not express ($out)"; return 1; }
  out=$(cd "$d/repo" && node "$cli" lint-lane --diff "$base" --lane express); rc=$?
  note "run4: exit $rc | $(sed -n 1p <<<"$out")"
  [ "$rc" = 1 ] && grep -q '^lane: normal' <<<"$out" && grep -q 'AGENTS.md' <<<"$out" || bad "run4: expected exit 1, 'lane: normal' and AGENTS.md ($rc)"
}
# Run 5 — verify-draft catches the count (lane-normal: the draft's tests and pass against a clean copy)
run5() {
  local d=$OUT/lane-normal out rc base cli=$SRC/packages/factory-tools/dist/cli.js
  "$SRC/fixtures/factory/build-scratch.sh" lane-normal "$d" > /dev/null || { bad "build-scratch lane-normal"; return 1; }
  base=$(git -C "$d/repo" merge-base HEAD origin/main)
  git clone --quiet "$d/repo" "$d/clean" && git -C "$d/clean" checkout --quiet "$base" || { bad "run5: no clean copy"; return 1; }
  git -C "$d/repo" diff --binary "$base" | git -C "$d/clean" apply || { bad "run5: the diff does not apply"; return 1; }
  mkdir -p "$d/logs"
  printf '> npm test\n\n4 tests\n4 pass\n0 fail\n' > "$d/logs/npm-test.log"
  out=$("$SRC/herdr/factory-slot.sh" run -- node "$cli" verify-draft --draft "$d/draft.md" --logs "$d/logs" --cwd "$d/clean"); rc=$?
  note "run5: exit $rc | $(tail -1 <<<"$out")"
  [ "$rc" = 1 ] && grep -q '^mismatch: npm test' <<<"$out" && [[ $(tail -1 <<<"$out") == "Verdict: Red · 1 mismatches" ]] || bad "run5: expected exit 1, one mismatch of npm test and 'Verdict: Red · 1 mismatches' ($rc)"
}
run4; run5

# Run 1 — the reviewer flags a lowered threshold (planted-coverage)
run1() {
  local a=e94_c${L}_1_review v
  start "$a" "$P" reviewer opus || return 1
  hc send "$a" "$(rev "$P" 1 "")" --wait --timeout 1800 > /dev/null
  finish "$a"
  mkdir -p "$OUT/pages"
  mv "$P/packets/1/r1/review" "$OUT/pages/review" || { bad "run1: no review directory"; return 1; }
  v=$(line1 "$OUT/pages/review/summary.md")
  note "run1: $v | $(grep -E '^B[0-9]' "$OUT/pages/review/summary.md" | grep -E 'package.json' | cut -c1-110)"
  [[ $v == "Verdict: Red"* ]] || { bad "run1: not red ($v)"; return 1; }
  grep -Eq '^B[0-9].*package\.json:8' "$OUT/pages/review/summary.md" || { bad "run1: no Blocking on package.json:8, the lowered threshold"; return 1; }
}
# Run 2 — the verifier reports one mismatch (wrong-test-count, the draft planted-coverage copies, on the same directory as run 1)
run2() {
  local a=e94_c${L}_2_verify lg="" v
  mkdir -p "$P/packets/1/r1/verify"
  if grep -q "logs/npm-test.log" "$P/draft.md"; then
    mkdir -p "$P/logs"
    printf "> npm test\n\nℹ tests 4\nℹ pass 4\nℹ fail 0\n" > "$P/logs/npm-test.log"
    lg=" Logs: $P/logs/."
  fi
  start "$a" "$P" verifier sonnet || return 1
  hc send "$a" "Use the verify-pr skill (.claude/skills/verify-pr/SKILL.md). Worktree: $P/repo. Branch: main. Issue: $P/repo/ISSUE.md. Draft without its Answers to review: $P/draft.md.$lg Maintainer's decisions: $P/packets/1/r1/decisions.md. factory-slot.sh: $SRC/herdr/factory-slot.sh. Write report.md and summary.md in $P/packets/1/r1/verify/." --wait --timeout 1800 > /dev/null
  finish "$a"
  cp -r "$P/packets/1/r1/verify" "$OUT/pages/verify" || { bad "run2: no verify directory"; return 1; }
  v=$(line1 "$OUT/pages/verify/summary.md")
  note "run2: $v | $(tail -1 "$OUT/pages/verify/report.md") | $(sed -n 2p "$OUT/pages/verify/summary.md" | cut -c1-110)"
  [[ $v == "Verdict: Red · 1 mismatches"* ]] || bad "run2: expected 'Verdict: Red · 1 mismatches' ($v)"
}
run1 && run2
wait "$r3" || true
tokens 'session-*.txt'; report
