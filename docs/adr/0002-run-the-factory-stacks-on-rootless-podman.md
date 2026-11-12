# ADR-0002: Run the factory host's stacks on rootless Podman behind `docker compose`

**Status:** Accepted
**Date:** 2026-11-11
**Deciders:** The maintainer (bogd3v)

## Context

On the factory host (ASUS ROG Strix G614PR, 16 cores, 32 threads, 64 GB of RAM; Ultramarine, a Fedora 44 base) three masters run their milestones in parallel. Workers and verifiers start their stacks with `docker compose` (`AGENTS.md` of each repository, "The factory"). bogd3v/micelio-engineering#195 limits how many heavy commands run at once, but it cannot limit one agent: with Docker the containers run under the daemon (`docker.service`, in the system slice), outside any `systemd-run --user` scope or slice the agent was started in. A worker capped at 8 cores and 10 GB still has its Strapi, PostgreSQL and Nuxt containers use what they want, and when memory runs short `systemd-oomd`, which acts on the user's slice, can take down Herdr with every agent in it (this issue's "Why", #196).

Changing the runtime of the host is expensive to undo: every repository's `AGENTS.md`, the role prompts, `fixtures/factory/build-scratch.sh` and the maintainer's habits name Docker. This is a gate 0 decision (`docs/factory.md`, "Gate 0 · Decision"). The evidence is [`docs/adr/0002-measurements.md`](0002-measurements.md): two runs of each measurement on each runtime, on the factory host, with `bogd3v/micelio-cms` at `1d8f43c` and its `docker-compose.yml` unchanged.

Constraints that hold whatever is decided:

- The `compose*.yml` files and their service names are a contract; no repository's compose file or `AGENTS.md` changes in this record.
- Production (Dokploy) and CI stay on Docker.

## Decision

Adopt rootless Podman as the runtime of the factory host's stacks, reached through `podman.socket` by the same `docker compose` binary, and give each agent a user slice that holds the agent and its stack. Nothing in this record is adopted until the issues of "Consequences" are done.

1. **Same CLI, other engine.** An agent on the factory host sets `DOCKER_HOST=unix://$XDG_RUNTIME_DIR/podman/podman.sock` and keeps running `docker compose -p <project> up --build`, `down -v` and `docker compose ps` against the repository's unchanged compose files and service names. Measurement 1 gave the same 133 suites and 1796 tests on both runtimes, and measurement 2 built and started the `micelio-cms` stack in the same time (about 5 to 6 minutes) on both.
2. **One slice per agent, set by the agent's start command, not by a repository.** The agent runs in `systemd-run --user --scope --slice=<agent>` (or a unit of that slice), with `systemctl --user set-property <agent>.slice MemoryMax=… MemorySwapMax=0 CPUQuota=…`. The stack's containers are placed in that slice by `cgroup_parent: <agent>.slice` on each service, supplied as a second compose file outside the repository (`COMPOSE_FILE=docker-compose.yml:<override>`), never in the repository's own file. Measurement 4 showed the containers under `…/user@1000.service/e196.slice/e196-agent.slice/libpod-<id>.scope/container` with the shell in the same slice (systemd nests a slice named `a-b.slice` under `a.slice`, so the adoption issue that picks the slice names picks the hierarchy too), and the slice's limits then bind both.
3. **An overrun costs the agent, not the session.** With the slice at `MemoryMax=300M`, below the 442 MiB the slice (shell and stack) peaked at with the limit raised (the stack alone: 411 to 416 MiB, measurement 3), the kernel killed 8 processes inside the slice (`memory.events` `oom_kill 8`), `oom_group_kill` stayed 0, the other terminals of the host stayed alive and `systemd-oomd` did not act. The overrun at `MemoryMax=10G` was not run: the maintainer accepted the scaled run as the evidence of measurement 4 on 2026-11-11 ("Trade-offs").
4. **Docker stays where the contract is checked.** CI and production keep building and running with Docker. To keep the two runtimes from drifting: the compose files and the `Dockerfile` stay the single source and never name a runtime; each stack's image keeps being built with Docker on every pull request (for `micelio-cms`, the `Build the CMS image` step of `contract.yml`, target `production`; `check.yml` builds no image), so a change that builds only under Podman cannot merge; the verifier's from-scratch build runs on the runtime the worker used (Podman) and CI proves the Docker path on every pull request; and a repository that finds a difference writes it as a note in its `AGENTS.md`, "The factory", not as a compose change for one runtime.
5. **Compatibility rules for the host runbook** (measurement 5): bind mounts of a worktree use `label=disable` or `:z`, as for Docker; a container that runs as the user on a mounted copy uses `--userns=keep-id` (or `userns_mode: keep-id`); an image built by `podman build` uses `--format docker` to keep its `HEALTHCHECK`; `docker compose build` leaves a `buildx_buildkit_default` container in Podman that the runbook lists.

## Options considered

### A. Rootless Podman through `podman.socket`, with a user slice per agent (chosen)

Each container is a process of the user, in a cgroup under the user's systemd instance, so the agent's slice can hold agent and stack together, and `systemd-oomd` sees them under `user@1000.service`. It costs nothing in the repositories: the compose files, service names and the Docker CLI stay. The measurements found no failing test, a build in the same time and the same memory footprint. What it does not do by itself: containers started through the socket sit in the user's instance, not in the caller's scope, so the slice placement is an explicit `cgroup_parent` (measurement 4). Podman 5.8.9 was the version measured.

### B. Docker as it is

The agent's `systemd-run --user` scope limits the CLI and the shell, not the containers: they stay under `/system.slice/docker-<id>.scope`, as read in the two Docker stack runs and, from inside a scope, once. Nothing changes and nothing is at risk, and nothing limits an agent's stack. It is the baseline, and the way back if A is reversed.

### C. Docker with `cgroup_parent` per agent, under the daemon's slice

The daemon runs in the system manager, and with the `systemd` cgroup driver `cgroup_parent` must be a slice of that manager (`"xxx.slice"`; a user scope is refused: `cgroup-parent for systemd cgroup should be a valid slice named as "xxx.slice"`). Creating and limiting a slice of the system manager is a root operation (not tried: no root was used), so it would be needed on every agent start, and `--cgroup-parent=user.slice` puts the container in the system manager's `user.slice`, outside `user@1000.service` and so outside what `systemd-oomd` is configured to act on for the user. It limits resources but not within the user's own budget; it was tried only as a placement probe.

### D. Rootless Docker

A second Docker daemon as a user unit would keep the Docker engine and its BuildKit behaviour and put the daemon in `user@1000.service`. It was not installed or measured. Its containers are children of one daemon, not of the agent, so the per-agent budget would still need a per-agent slice that the daemon places them in, the same `cgroup_parent` problem as C inside the user's manager. It changes the daemon of the host without making the placement simpler than A, and Fedora ships Podman, not a rootless Docker.

### E. `podman-compose`

A Python reimplementation of Compose that drives Podman directly. It was not installed or measured. It reads the same compose files but its behaviour differs from `docker compose` in the areas the factory relies on (`depends_on` with `condition: service_healthy`, build arguments, `--build` with BuildKit features), and the compose files are a contract. A is the same engine without a second Compose.

## Trade-offs

- **The overrun at the limit the issue names was not measured; the maintainer accepted the scaled run.** The stack's peak is 0.41 GiB, so exceeding `MemoryMax=10G` means allocating about 10 GiB on a host with 5.4 GB of 7.9 GB of its swap already used; it was not run, because `systemd-oomd` acts on `user@1000.service` and the test could have taken Herdr with it. On 2026-11-11 the maintainer accepted the scaled run (slice at `MemoryMax=300M`, `MemorySwapMax=0`) as the evidence of measurement 4. It shows only the processes inside the slice are killed, and the claim in point 3 stands on it; the 10G run stays as follow-up 6 below.
- **A stack's containers are not in the caller's scope by default.** A wrapper must create the slice, set it, and pass the override file; an agent that starts a stack without it gets the user's instance as its limit, which is better than the system slice but not a per-agent budget. The adoption issues must make the wrapper the only way an agent starts.
- **Two engines on one host for a while.** Images and volumes are not shared (the first Podman build repeats the pulls and the build, a second store on a disk with 544 GB free), `npm run test:upgrade` mounts `/var/run/docker.sock` and was not run on Podman, and the `buildx_buildkit_default` container persists after the first build.
- **Two engines in the factory's evidence.** Workers and verifiers on Podman, CI on Docker: a difference that appears only under Podman is a finding of the runbook, not of the repository. The record does not check that it never drifts; it makes CI the contract.
- **Slower `npm run check`.** 190.7 and 194.6 s on Docker against 222.9 and 238.8 s on Podman (the Podman runs started with a raised load average); not a blocker, worth re-measuring after the move.
- **Revisit** if the measured overrun at 10G kills more than the slice, if a repository's stack needs a compose change only for Podman, or if Podman's socket service changes where it places containers.

## Consequences

If this record is accepted, the issues that follow it (each its own issue in the factory):

1. A host runbook (`herdr/master.md` and the role prompts): the `DOCKER_HOST` line, `label=disable`, `--userns=keep-id`, `--format docker`, the stray BuildKit container, `podman.socket` enabled as a user unit.
2. Herdr's start command: the per-agent slice, its limits and a generated override file with `cgroup_parent` per service (the service names of each repository's compose file are read, not changed), set through `COMPOSE_FILE`.
3. `AGENTS.md` of each repository with a stack, "The factory": the run that stands in for Docker names the host's runtime, and `npm run test:upgrade` of `micelio-cms` (which mounts `docker.sock`) is run on Podman and its change, if any, named.
4. `fixtures/factory/build-scratch.sh` and `fixtures/factory/RUN.md` checked on Podman.
5. For each repository with a stack and no pull-request job that builds its image with Docker (`micelio-cms` has `contract.yml`), an issue to add one, since the drift guarantee of Decision 4 rests on it.
6. The overrun test at `MemoryMax=10G` (follow-up; the scaled run is the accepted evidence), run by the maintainer on the host with Herdr's session out of the way, and the measurements re-run after a Podman update.

Nothing changes in this pull request outside `docs/adr/`: no compose file, no `AGENTS.md`, no standard version, no package version (documentation only, standard section 7). The record is `Proposed` until the pull request is merged, then `Accepted` by the usual rule of `docs/adr-template.md`.
