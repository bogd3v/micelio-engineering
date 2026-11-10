#!/usr/bin/env bash
# factory-slot.sh — a machine-wide budget for the factory's heavy commands and long-lived agents.
#
#   factory-slot.sh run [--pool heavy] -- <command...>
#   factory-slot.sh acquire --pool workers --agent <name>     (exit 75 when the pool is full)
#   factory-slot.sh release --agent <name>
#   factory-slot.sh status
#   factory-slot.sh reap
#
# Environment: FACTORY_SLOT_DIR, FACTORY_TMP, FACTORY_CORES, FACTORY_HEAVY_SLOTS,
# FACTORY_WORKER_SLOTS, FACTORY_REAP_GRACE, FACTORY_AGENT, HC_TERMINAL_ID.
# See docs/factory.md, "Machine budget". Needs only bash, flock, ps, setsid and coreutils;
# `hc` (herdr-core) is called by `reap` alone.
set -u

DIR="${FACTORY_SLOT_DIR:-$HOME/Git/factory/run/slots}"
TMP_ROOT="${FACTORY_TMP:-$HOME/Git/factory/tmp}"
HEAVY="${FACTORY_HEAVY_SLOTS:-3}"
WORKERS="${FACTORY_WORKER_SLOTS:-6}"
GRACE="${FACTORY_REAP_GRACE:-300}"

die() { echo "factory-slot: $*" >&2; exit 2; }
usage() { sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//' >&2; exit 2; }

positive() { [[ "$1" =~ ^[1-9][0-9]*$ ]] || die "$2 must be a positive whole number, got '$1'"; }
positive "$HEAVY" FACTORY_HEAVY_SLOTS
positive "$WORKERS" FACTORY_WORKER_SLOTS
[[ "$GRACE" =~ ^[0-9]+$ ]] || die "FACTORY_REAP_GRACE must be a whole number of seconds, got '$GRACE'"

valid_agent() { [[ "$1" =~ ^[a-z][a-z0-9_-]{0,63}$ ]]; }
alive() { [[ "$1" =~ ^[0-9]+$ ]] && kill -0 "$1" 2>/dev/null; }
field() { sed -n "s/^$2=//p" "$1" | head -n 1; }

# --- run ---------------------------------------------------------------------------------

cmd_run() {
  local pool=heavy
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --pool) pool="${2:-}"; shift 2 ;;
      --) shift; break ;;
      *) usage ;;
    esac
  done
  [[ "$pool" == heavy ]] || die "run takes the pool heavy only"
  [[ $# -gt 0 ]] || usage

  local pdir="$DIR/heavy" ticket slot fd i
  mkdir -p "$pdir/queue" || die "cannot create $pdir"
  ticket="$pdir/queue/$(printf '%020d' "$(date +%s%N)")-$$"
  : >"$ticket"
  trap 'rm -f "$ticket"' EXIT

  while true; do
    # Drop tickets of waiters that died, then see whether ours is the oldest.
    local oldest="" t
    for t in "$pdir"/queue/*; do
      [[ -e "$t" ]] || continue
      if ! alive "${t##*-}"; then rm -f "$t"; continue; fi
      oldest="$t"
      break
    done
    if [[ "$oldest" == "$ticket" ]]; then
      for ((i = 1; i <= HEAVY; i++)); do
        exec {fd}>>"$pdir/slot-$i.lock"
        if flock -n "$fd"; then slot=$i; break 2; fi
        exec {fd}>&-
      done
    fi
    sleep 0.1
  done
  rm -f "$ticket"

  local cores="${FACTORY_CORES:-$(nproc)}"
  positive "$cores" FACTORY_CORES
  local per=$((cores / HEAVY))
  ((per >= 1)) || per=1
  local agent="${FACTORY_AGENT:-${HC_TERMINAL_ID:-}}"
  local owner="$pdir/slot-$slot.owner"

  # The lock descriptor stays open in the command: the slot is held while any of its processes lives.
  VITEST_MAX_WORKERS="$per" setsid "$@" &
  local pid=$!
  {
    echo "pid=$pid"
    echo "pgid=$pid"
    echo "wrapper=$$"
    echo "agent=$agent"
    echo "start=$(date +%s)"
    echo "command=$*"
  } >"$owner.tmp" && mv "$owner.tmp" "$owner"
  trap 'kill -TERM -- "-$pid" 2>/dev/null' INT TERM
  trap 'rm -f "$owner"' EXIT
  local rc
  wait "$pid"
  rc=$?
  # A trapped signal interrupts the first wait; wait again for the real exit code.
  while alive "$pid"; do wait "$pid"; rc=$?; done
  exit "$rc"
}

# --- leases ------------------------------------------------------------------------------

cmd_acquire() {
  local pool="" agent=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --pool) pool="${2:-}"; shift 2 ;;
      --agent) agent="${2:-}"; shift 2 ;;
      *) usage ;;
    esac
  done
  [[ "$pool" == workers ]] || die "acquire takes --pool workers"
  valid_agent "$agent" || die "--agent needs a name"
  local pdir="$DIR/workers" file n
  mkdir -p "$pdir" || die "cannot create $pdir"
  file="$pdir/lease-${agent}"
  exec {n}>>"$pdir/.lock"
  flock "$n"
  if [[ ! -e "$file" ]]; then
    local count
    count=$(find "$pdir" -maxdepth 1 -name 'lease-*' | wc -l)
    if ((count >= WORKERS)); then
      echo "factory-slot: workers pool full ($count of $WORKERS)" >&2
      exit 75
    fi
    printf 'agent=%s\nstart=%s\n' "$agent" "$(date +%s)" >"$file.tmp" && mv "$file.tmp" "$file"
  fi
  exit 0
}

cmd_release() {
  local agent=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --agent) agent="${2:-}"; shift 2 ;;
      *) usage ;;
    esac
  done
  valid_agent "$agent" || die "--agent needs a name"
  rm -f "$DIR/workers/lease-${agent}"
}

# --- status and reap ---------------------------------------------------------------------

fmt_time() { date -d "@$1" '+%Y-%m-%dT%H:%M:%S%z' 2>/dev/null || echo "$1"; }

# Prints "pool<TAB>slot<TAB>agent<TAB>pid<TAB>start<TAB>command<TAB>state" per slot and lease.
list_entries() {
  local f pid
  for f in "$DIR"/heavy/slot-*.owner; do
    [[ -e "$f" ]] || continue
    pid=$(field "$f" pid)
    printf 'heavy\t%s\t%s\t%s\t%s\t%s\t%s\n' "$(basename "$f" .owner | sed 's/^slot-//')" \
      "$(field "$f" agent)" "$pid" "$(fmt_time "$(field "$f" start)")" "$(field "$f" command)" \
      "$(alive "$pid" && echo alive || echo dead)"
  done
  for f in "$DIR"/workers/lease-*; do
    [[ -e "$f" ]] || continue
    printf 'workers\t%s\t%s\t-\t%s\t-\t-\n' "$(field "$f" agent)" "$(field "$f" agent)" \
      "$(fmt_time "$(field "$f" start)")"
  done
}

descends_from() { # $1 pid, $2 ancestor
  local p="$1"
  while [[ -n "$p" && "$p" -gt 1 ]]; do
    [[ "$p" == "$2" ]] && return 0
    p=$(ps -o ppid= -p "$p" 2>/dev/null | tr -d ' ')
  done
  return 1
}

cmd_status() {
  list_entries
  local root="${TMP_ROOT%/}" pgids="" wrappers="" f p cwd
  for f in "$DIR"/heavy/slot-*.owner; do
    [[ -e "$f" ]] && pgids+=" $(field "$f" pgid)" && wrappers+=" $(field "$f" wrapper)"
  done
  # Waiting wrappers hold a ticket named <time>-<pid>.
  for f in "$DIR"/heavy/queue/*; do
    [[ -e "$f" ]] && wrappers+=" ${f##*-}"
  done
  for p in /proc/[0-9]*; do
    p="${p#/proc/}"
    cwd=$(readlink "/proc/$p/cwd" 2>/dev/null) || continue
    [[ "$cwd" == "$root" || "$cwd" == "$root"/* ]] || continue
    [[ "$p" == "$$" || " $wrappers " == *" $p "* ]] && continue
    descends_from "$p" "$$" && continue
    descends_from "$$" "$p" && continue
    local pg
    pg=$(ps -o pgid= -p "$p" 2>/dev/null | tr -d ' ')
    [[ -n "$pg" && " $pgids " == *" $pg "* ]] && continue
    printf 'orphan\t%s\t%s\t%s\n' "$p" "$cwd" "$(tr '\0' ' ' <"/proc/$p/cmdline" 2>/dev/null)"
  done
}

# Prints ended, running or unknown for an agent, asking herdr-core.
agent_state() {
  local out rc
  command -v hc >/dev/null 2>&1 || { echo unknown; return; }
  # hc writes its not_found answer to stderr, so read both streams.
  out=$(hc get "$1" --json 2>&1)
  rc=$?
  # Top-level state only: the nested status of the app has a "state" of its own, but no "finished_ms".
  if ((rc == 0)) && grep -Eq '"state"[[:space:]]*:[[:space:]]*"finished"' <<<"$out" &&
    grep -Eq '"finished_ms"[[:space:]]*:[[:space:]]*[0-9]' <<<"$out"; then
    echo ended
  elif ((rc == 3)) && grep -Eq '"kind"[[:space:]]*:[[:space:]]*"not_found"' <<<"$out"; then
    echo ended
  elif ((rc == 0)) && grep -Eq '"state"[[:space:]]*:[[:space:]]*"[a-z_]+"' <<<"$out"; then
    echo running
  else
    echo unknown
  fi
}

kill_group() {
  local pg="$1" i
  [[ "$pg" =~ ^[0-9]+$ && "$pg" -gt 1 ]] || return 0
  kill -TERM -- "-$pg" 2>/dev/null || return 0
  for ((i = 0; i < 100; i++)); do
    kill -0 -- "-$pg" 2>/dev/null || return 0
    sleep 0.1
  done
  kill -KILL -- "-$pg" 2>/dev/null
}

cmd_reap() {
  declare -A state
  local f agent pid st now
  now=$(date +%s)
  # Asks hc once per agent: the answer is cached in the shell, not in a subshell.
  lookup() { [[ -n "${state[$1]:-}" ]] || state[$1]=$(agent_state "$1"); }

  for f in "$DIR"/heavy/slot-*.owner; do
    [[ -e "$f" ]] || continue
    pid=$(field "$f" pid)
    agent=$(field "$f" agent)
    if ! alive "$pid"; then rm -f "$f"; echo "removed $f"; continue; fi
    [[ -n "$agent" ]] || continue
    lookup "$agent"
    case "${state[$agent]}" in
      ended) kill_group "$(field "$f" pgid)"; rm -f "$f"; echo "killed $f" ;;
      unknown) echo "unknown $f" ;;
    esac
  done
  for f in "$DIR"/workers/lease-*; do
    [[ -e "$f" ]] || continue
    agent=$(field "$f" agent)
    st=$(field "$f" start)
    [[ "$st" =~ ^[0-9]+$ ]] || st=0
    ((now - st < GRACE)) && continue
    lookup "$agent"
    case "${state[$agent]}" in
      ended) rm -f "$f"; echo "released $f" ;;
      unknown) echo "unknown $f" ;;
    esac
  done
  return 0
}

case "${1:-}" in
  run) shift; cmd_run "$@" ;;
  acquire) shift; cmd_acquire "$@" ;;
  release) shift; cmd_release "$@" ;;
  status) cmd_status ;;
  reap) cmd_reap ;;
  *) usage ;;
esac
