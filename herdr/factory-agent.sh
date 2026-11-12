#!/usr/bin/env bash
# factory-agent.sh — each agent in its own systemd slice, and its containers in it.
#
#   factory-agent.sh enter <agent> [-- <command...>]   (default command: an interactive $SHELL)
#   factory-agent.sh docker -- <args...>               (the shim `docker` of an agent's PATH)
#   factory-agent.sh stop <agent>
#
# Environment: FACTORY_AGENT_MEMORY (10G), FACTORY_AGENT_CPU (800%), FACTORY_AGENT_DIR,
# FACTORY_DOCKER (/usr/bin/docker), FACTORY_SLICE, FACTORY_AGENT.
# See docs/factory.md, "Machine budget". Needs only bash, coreutils, systemd-run, systemctl
# and the docker CLI. It reads a repository's compose files for `config --services` alone.
set -u

AGENT_DIR="${FACTORY_AGENT_DIR:-$HOME/Git/factory/run/agents}"
REAL_DOCKER="${FACTORY_DOCKER:-/usr/bin/docker}"
SELF="$(readlink -f "${BASH_SOURCE[0]}")"

die() { echo "factory-agent: $*" >&2; exit 2; }
usage() { sed -n '2,6p' "$0" | sed 's/^# \{0,1\}//' >&2; exit 2; }

valid_agent() { [[ "$1" =~ ^[a-z][a-z0-9_-]{0,31}$ ]]; }

# --- enter -------------------------------------------------------------------------------

cmd_enter() {
  local agent="${1:-}"
  [[ $# -gt 0 ]] && shift
  valid_agent "$agent" || die "agent name must match [a-z][a-z0-9_-]{0,31}, got '$agent'"
  if [[ $# -gt 0 ]]; then
    [[ "$1" == -- ]] || usage
    shift
  fi
  local slice="factory-${agent//-/_}.slice"
  local bin="$AGENT_DIR/$agent/bin"
  mkdir -p "$bin" || die "cannot create $bin"
  printf '#!/usr/bin/env bash\nexec %q docker -- "$@"\n' "$SELF" >"$bin/docker"
  chmod +x "$bin/docker"

  systemctl --user set-property "$slice" \
    "MemoryMax=${FACTORY_AGENT_MEMORY:-10G}" \
    "MemorySwapMax=0" \
    "CPUQuota=${FACTORY_AGENT_CPU:-800%}" || die "cannot set the limits of $slice"

  export DOCKER_HOST="unix://${XDG_RUNTIME_DIR:-/run/user/$(id -u)}/podman/podman.sock"
  export FACTORY_AGENT="$agent" FACTORY_SLICE="$slice"
  export PATH="$bin:$PATH"
  if [[ $# -eq 0 ]]; then set -- "${SHELL:-/bin/bash}" -i; fi
  exec systemd-run --user --scope --quiet --slice="$slice" "$@"
}

# --- docker shim -------------------------------------------------------------------------

# Compose files used when neither -f nor COMPOSE_FILE is given: what compose itself finds, the
# first of its four names walking up from the project directory, and the first of its four
# override names beside it (whatever the base name).
default_files() {
  local dir="$1" n o
  dir="$(cd "$dir" 2>/dev/null && pwd)" || return 1
  while true; do
    for n in compose.yaml compose.yml docker-compose.yml docker-compose.yaml; do
      if [[ -f "$dir/$n" ]]; then
        printf '%s\n' "$dir/$n"
        for o in compose.override.yml compose.override.yaml \
          docker-compose.override.yml docker-compose.override.yaml; do
          [[ -f "$dir/$o" ]] && { printf '%s\n' "$dir/$o"; break; }
        done
        return 0
      fi
    done
    [[ "$dir" == / ]] && return 1
    dir="$(dirname "$dir")"
  done
}

shim_compose() {
  shift # compose
  local globals=() files=() projdir="" a
  while [[ $# -gt 0 ]]; do
    a="$1"
    case "$a" in
      -f | --file) files+=("${2:-}"); globals+=("$a" "${2:-}"); shift 2 || shift ;;
      --file=*) files+=("${a#--file=}"); globals+=("$a"); shift ;;
      --project-directory) projdir="${2:-}"; globals+=("$a" "${2:-}"); shift 2 || shift ;;
      --project-directory=*) projdir="${a#*=}"; globals+=("$a"); shift ;;
      -p | --project-name | --env-file | --profile | --ansi | --parallel | --progress)
        globals+=("$a" "${2:-}"); shift 2 || shift ;;
      -*) globals+=("$a"); shift ;;
      *) break ;;
    esac
  done
  # $@ now starts with the subcommand (or is empty).
  [[ $# -gt 0 ]] || exec "$REAL_DOCKER" compose "${globals[@]}"

  local sep="${COMPOSE_PATH_SEPARATOR:-:}" mode listing=""
  local -a list=()
  if ((${#files[@]} > 0)); then
    mode=flag; list=("${files[@]}")
  elif [[ -n "${COMPOSE_FILE:-}" ]]; then
    mode=env; IFS="$sep" read -r -a list <<<"$COMPOSE_FILE"
  else
    mode=flag
    mapfile -t list < <(default_files "${projdir:-.}") || true
    ((${#list[@]} > 0)) || exec "$REAL_DOCKER" compose "${globals[@]}" "$@"
    # compose without -f takes its project name from the directory of the first file
    [[ -n "$projdir" ]] || globals+=(--project-directory "$(dirname "${list[0]}")")
  fi

  local services
  if [[ $mode == env ]]; then
    services="$("$REAL_DOCKER" compose "${globals[@]}" config --services 2>/dev/null)" || services=""
  else
    local cfg=() f
    for f in "${list[@]}"; do cfg+=(-f "$f"); done
    services="$("$REAL_DOCKER" compose "${globals[@]}" "${cfg[@]}" config --services 2>/dev/null)" ||
      services=""
  fi
  # No services: a command that reads no project (version, ls) or a project that is invalid,
  # which the real command reports itself.
  [[ -n "$services" ]] || exec "$REAL_DOCKER" compose "${globals[@]}" "$@"

  local key hash override s
  key="$(printf '%s\n' "$PWD" "${list[@]}")"
  hash="$(printf '%s' "$key" | cksum | cut -d' ' -f1)"
  mkdir -p "${AGENT_DIR}/${FACTORY_AGENT:-agent}" || exit 2
  override="${AGENT_DIR}/${FACTORY_AGENT:-agent}/override-${hash}.yml"
  {
    echo "services:"
    while IFS= read -r s; do
      [[ -n "$s" ]] || continue
      printf '  %s:\n    cgroup_parent: %s\n' "$s" "$FACTORY_SLICE"
    done <<<"$services"
  } >"$override"

  if [[ $mode == env ]]; then
    COMPOSE_FILE="$COMPOSE_FILE$sep$override" exec "$REAL_DOCKER" compose "${globals[@]}" "$@"
  fi
  local out=()
  for f in "${list[@]}"; do out+=(-f "$f"); done
  # a -f among the globals (mode flag with files given) is already in globals: add only the override
  if ((${#files[@]} > 0)); then
    exec "$REAL_DOCKER" compose "${globals[@]}" -f "$override" "$@"
  fi
  exec "$REAL_DOCKER" compose "${globals[@]}" "${out[@]}" -f "$override" "$@"
}

cmd_docker() {
  [[ "${1:-}" == -- ]] && shift
  [[ -n "${FACTORY_SLICE:-}" ]] || exec "$REAL_DOCKER" "$@"
  local first="${1:-}" second="${2:-}" a
  if [[ "$first" == compose ]]; then
    shim_compose "$@"
  fi
  local sub=""
  if [[ "$first" == run || "$first" == create ]]; then
    sub=1
  elif [[ "$first" == container && ( "$second" == run || "$second" == create ) ]]; then
    sub=2
  fi
  if [[ -n "$sub" ]]; then
    for a in "$@"; do
      [[ "$a" == --cgroup-parent || "$a" == --cgroup-parent=* ]] && exec "$REAL_DOCKER" "$@"
    done
    local head=("${@:1:sub}") tail=("${@:sub+1}")
    exec "$REAL_DOCKER" "${head[@]}" "--cgroup-parent=$FACTORY_SLICE" "${tail[@]}"
  fi
  exec "$REAL_DOCKER" "$@"
}

# --- stop --------------------------------------------------------------------------------

cmd_stop() {
  local agent="${1:-}"
  valid_agent "$agent" || die "agent name must match [a-z][a-z0-9_-]{0,31}, got '$agent'"
  rm -rf "${AGENT_DIR:?}/$agent"
}

case "${1:-}" in
  enter) shift; cmd_enter "$@" ;;
  docker) shift; cmd_docker "$@" ;;
  stop) shift; cmd_stop "$@" ;;
  *) usage ;;
esac
