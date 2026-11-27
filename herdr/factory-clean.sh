#!/usr/bin/env bash
# factory-clean.sh — removes what the factory left for an issue once it is closed.
#
#   factory-clean.sh <owner/repo#n> <name> --checkout <dir> --packets <dir> [--dry-run]
#
# <name> is the issue's name in herdr/master.md (<N>, or <tag><N>), [a-z0-9]{1,16}; --checkout is the
# repository's checkout whose sibling is wt-<name>; --packets holds <name>/. In this order it removes:
#   1. nothing, exit 1, while the issue is not closed or `factory-slot.sh status` lists an agent of it
#   2. the worktree wt-<name> and its branch, when clean and its pull request is MERGED (else `kept`)
#   3. the packet <packets>/<name>/, when the worktree was removed or did not exist
#   4. the scratch of worker-<name>, reviewer-<name>[-r<K>] and verifier-<name>[-r<K>] under FACTORY_TMP
#   5. the stacks <name> and <name>v, their volumes and local images, and the images tagged <name>[v]
#   6. each run-<PID> folder under FACTORY_RUN_TMP whose wrapper is dead and whose command has ended
# It prints `removed <what>` for each (`would remove <what>` with --dry-run, which removes nothing).
# A path rm cannot remove goes to `podman unshare rm -rf`; one that stays prints `stuck <path>`, exit 1.
#
# Environment: FACTORY_TMP, FACTORY_RUN_TMP, FACTORY_SLOT_DIR (read as factory-slot.sh reads them).
# See docs/factory.md, `B.5`, and herdr/master.md, "After the issue is closed". Needs bash, git, gh
# and coreutils; docker for step 5 only, podman for a stuck path only.
set -u

HERE="$(cd "$(dirname "$0")" && pwd)"
SLOT_DIR="${FACTORY_SLOT_DIR:-$HOME/Git/factory/run/slots}"
TMP_ROOT="${FACTORY_TMP:-$HOME/Git/factory/tmp}"
RUN_TMP_ROOT="${FACTORY_RUN_TMP:-$HOME/.cache/micelio-factory/tmp}"

usage() { sed -n '2,4p' "$0" | sed 's/^# \{0,1\}//' >&2; exit 2; }
refuse() { echo "factory-clean: $*" >&2; exit 1; }

positional=() checkout="" packets="" dry=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --checkout) [[ $# -ge 2 ]] || usage; checkout="$2"; shift 2 ;;
    --packets) [[ $# -ge 2 ]] || usage; packets="$2"; shift 2 ;;
    --dry-run) dry=1; shift ;;
    --*) usage ;;
    *) positional+=("$1"); shift ;;
  esac
done
[[ ${#positional[@]} -eq 2 && -n "$checkout" && -n "$packets" ]] || usage
issue="${positional[0]}"
name="${positional[1]}"

# --- step 1: the guards ------------------------------------------------------------------

# The name is part of every path below: nothing else may reach them.
[[ "$name" =~ ^[a-z0-9]{1,16}$ ]] || refuse "the name must match [a-z0-9]{1,16}, got '$name'"
[[ "$issue" =~ ^([A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+)#([0-9]+)$ ]] || refuse "the issue must be owner/repo#n, got '$issue'"
repo="${BASH_REMATCH[1]}"
number="${BASH_REMATCH[2]}"
[[ -d "$checkout" ]] || refuse "no checkout at $checkout"
# Physical, as `git worktree list` prints the paths.
checkout="$(cd "$checkout" && pwd -P)"

# A refused call prints the error body on stdout, so its output is no state.
state=$(gh api "repos/$repo/issues/$number" --jq .state 2>/dev/null) || state=""
[[ "$state" == closed ]] || refuse "$issue is not closed (state: ${state:-unknown})"

# An agent of the issue: worker-<name>, reviewer-<name>[-r<K>], verifier-<name>[-r<K>].
agents="^(worker-$name|(reviewer|verifier)-$name(-r[0-9]+)?)\$"
slots=$(FACTORY_SLOT_DIR="$SLOT_DIR" bash "$HERE/factory-slot.sh" status) || refuse "factory-slot.sh status failed"
while IFS=$'\t' read -r pool _ agent _; do
  [[ "$pool" == heavy || "$pool" == workers ]] || continue
  [[ "$agent" =~ $agents ]] && refuse "$agent holds a $pool entry: end it first"
done <<<"$slots"

rc=0

# Removes a path, through `podman unshare` when rm cannot; prints stuck and sets rc=1 when it stays.
remove_path() { # $1 path
  local p="$1"
  [[ -e "$p" || -L "$p" ]] || return 0
  if ((dry)); then echo "would remove $p"; return 0; fi
  rm -rf -- "$p" 2>/dev/null
  if [[ -e "$p" || -L "$p" ]] && command -v podman >/dev/null 2>&1; then
    podman unshare rm -rf -- "$p" >/dev/null 2>&1
  fi
  if [[ -e "$p" || -L "$p" ]]; then
    echo "stuck $p"
    rc=1
  else
    echo "removed $p"
  fi
}

# --- step 2: the worktree and its branch -------------------------------------------------

wt="$(dirname "$checkout")/wt-$name"
worktree_gone=1
if [[ -e "$wt" ]]; then
  worktree_gone=0
  # The porcelain list gives one block per worktree: "worktree <path>", then "branch refs/heads/<b>".
  listed=0 branch="" current=""
  while IFS= read -r line; do
    [[ "$line" == "worktree "* ]] && current="${line#worktree }"
    [[ "$current" == "$wt" ]] || continue
    listed=1
    [[ "$line" == "branch refs/heads/"* ]] && branch="${line#branch refs/heads/}"
  done < <(git -C "$checkout" worktree list --porcelain 2>/dev/null)
  if ((!listed)); then
    echo "kept $wt: not a worktree of $checkout"
  elif ! changes=$(git -C "$wt" status --short 2>/dev/null); then
    echo "kept $wt: git status failed"
  elif [[ -n "$changes" ]]; then
    echo "kept $wt: uncommitted work"
  elif [[ -z "$branch" ]]; then
    echo "kept $wt: no branch checked out"
  elif ! merged=$(gh api "repos/$repo/pulls?head=${repo%/*}:$branch&state=closed&per_page=100" \
    --jq '.[] | select(.merged_at != null) | .number' 2>/dev/null); then
    echo "kept $wt: cannot read the pull requests of $branch"
  elif [[ -z "$merged" ]]; then
    echo "kept $wt: the pull request of $branch is not merged"
  elif ((dry)); then
    echo "would remove $wt"
    echo "would remove branch $branch"
    worktree_gone=1
  elif git -C "$checkout" worktree remove "$wt" >/dev/null 2>&1; then
    echo "removed $wt"
    worktree_gone=1
    if git -C "$checkout" branch -D "$branch" >/dev/null 2>&1; then
      echo "removed branch $branch"
    else
      echo "stuck branch $branch"
      rc=1
    fi
  else
    echo "stuck $wt"
    rc=1
  fi
fi

# --- step 3: the packet ------------------------------------------------------------------

if ((worktree_gone)); then
  remove_path "${packets%/}/$name"
elif [[ -e "${packets%/}/$name" ]]; then
  echo "kept ${packets%/}/$name: its worktree stays"
fi

# --- step 4: the agents' scratch ---------------------------------------------------------

for p in "${TMP_ROOT%/}"/worker-"$name" "${TMP_ROOT%/}"/reviewer-"$name"* "${TMP_ROOT%/}"/verifier-"$name"*; do
  [[ "${p##*/}" =~ $agents ]] || continue
  remove_path "$p"
done

# --- step 5: the stacks and their images -------------------------------------------------

if ! command -v docker >/dev/null 2>&1; then
  echo "skipped stacks: no docker"
else
  for project in "$name" "${name}v"; do
    if ((dry)); then
      echo "would remove stack $project"
    # From / no compose file is found, so the project's own labels say what goes.
    elif (cd / && docker compose -p "$project" down -v --rmi local) >/dev/null 2>&1; then
      echo "removed stack $project"
    else
      echo "stuck stack $project"
      rc=1
    fi
  done
  while IFS= read -r image; do
    [[ "${image##*:}" == "$name" || "${image##*:}" == "${name}v" ]] || continue
    if ((dry)); then
      echo "would remove image $image"
    elif docker image rm "$image" >/dev/null 2>&1; then
      echo "removed image $image"
    else
      echo "stuck image $image"
      rc=1
    fi
  done < <(docker image ls --format '{{.Repository}}:{{.Tag}}' 2>/dev/null)
fi

# --- step 6: the run folders reap left ---------------------------------------------------

alive() { [[ "$1" =~ ^[0-9]+$ ]] && { kill -0 "$1" 2>/dev/null || [[ -e "/proc/$1" ]]; }; }

# True while an owner file names this wrapper and a command that is alive (as factory-slot.sh reap).
command_runs() { # $1 wrapper PID
  local f
  for f in "$SLOT_DIR"/heavy/slot-*.owner; do
    [[ -e "$f" ]] || continue
    [[ "$(sed -n 's/^wrapper=//p' "$f" | head -n 1)" == "$1" ]] || continue
    alive "$(sed -n 's/^pid=//p' "$f" | head -n 1)" && return 0
  done
  return 1
}

for p in "${RUN_TMP_ROOT%/}"/run-*; do
  [[ -d "$p" && "${p##*/run-}" =~ ^[0-9]+$ ]] || continue
  alive "${p##*/run-}" && continue
  command_runs "${p##*/run-}" && continue
  remove_path "$p"
done

exit "$rc"
