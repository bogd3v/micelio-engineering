#!/usr/bin/env bash
# install.sh — installs the factory mod into the Herdr desktop app's configuration folder.
#
#   herdr/mod/install.sh [--maintainer <login>] [--spaces <file.json>] [--side left|right] [--fixture <folder>]...
#
# Builds the agent cats (herdr/mod/build-cats.mjs) and copies the mod to <app>/mods/factory/ and the
# layout, with the panel docked on the right of Herdr's `main` (the left with --side), to <app>/layouts/factory.json; <app> is
# $HERDR_APP_DIR, else ~/.config/herdr-app. It never overwrites a file it did not write: it records the
# hash of each file it writes in <app>/factory-mod-install.json, and when one of the files it would write
# exists with another hash (or is not recorded), it writes nothing, says which, and exits 1. A file it
# wrote and nobody changed is replaced, so running it again updates the install. It also writes the
# `dockerHost` prop, unix://${XDG_RUNTIME_DIR:-/run/user/$(id -u)}/podman/podman.sock (the rule of
# herdr/factory-agent.sh, ADR-0002): the panel passes it to `docker -H`, as Herdr's `exec` has no environment.
#
#   --maintainer <login>   the GitHub login whose gate comments count. It is taken from the first of:
#                          this option, $FACTORY_MAINTAINER, the one of the installed layouts/factory.json
#                          (only when this installer wrote that file and nobody changed it; it says so on
#                          stderr). With none of them, or with a value that is not a GitHub login, it
#                          writes nothing and exits 2.
#   --spaces <file.json>   the layout's `spaces`, copied as it is: [{ "name", "repo", "milestone", "epic", "tag" }, …];
#                          entries that share a name are one space (herdr/mod/README.md, "Configure")
#   --side left|right      the side of the panel in the layout (default right): the first or the last child of work-body
#   --fixture <folder>     read the recordings of <folder> instead of the machine (repeat for a list)
#
# Needs bash, node, tar and the coreutils.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHECKOUT="$(cd "$HERE/../.." && pwd)"
APP="${HERDR_APP_DIR:-$HOME/.config/herdr-app}"
MAINTAINER=""
MAINTAINER_GIVEN=""
SPACES=""
SIDE="right"
FIXTURES=()

die() { echo "install.sh: $*" >&2; exit 2; }
usage() { sed -n '2,24p' "$0" | sed 's/^# \{0,1\}//' >&2; exit 2; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --maintainer)
      [[ $# -ge 2 ]] || die "--maintainer takes a GitHub login"
      MAINTAINER="$2"; MAINTAINER_GIVEN=1; shift 2 ;;
    --spaces) SPACES="${2:-}"; shift 2 ;;
    --side) SIDE="${2:-}"; shift 2 ;;
    --fixture) FIXTURES+=("${2:-}"); shift 2 ;;
    -h|--help) usage ;;
    *) usage ;;
  esac
done
[[ "$SIDE" == left || "$SIDE" == right ]] || die "--side takes left or right, not: $SIDE"
[[ -z "$SPACES" || -f "$SPACES" ]] || die "no such file: $SPACES"

# What GitHub accepts as a login (LC_ALL=C: the ranges are ASCII only).
is_login() { local LC_ALL=C; [[ "$1" =~ ^[A-Za-z0-9][A-Za-z0-9-]{0,38}$ ]]; }

# The `maintainer` of the installed layout, when it is as this installer wrote it; else nothing.
installed_maintainer() {
  APP="$APP" node -e '
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
try {
  const file = path.join(process.env.APP, "layouts/factory.json");
  const recorded = JSON.parse(fs.readFileSync(path.join(process.env.APP, "factory-mod-install.json"), "utf8")).files ?? {};
  const bytes = fs.readFileSync(file);
  if (recorded["layouts/factory.json"] === crypto.createHash("sha256").update(bytes).digest("hex")) {
    const find = (n) => (n.id === "factory" ? n : (n.children ?? []).map(find).find(Boolean));
    const { maintainer } = find(JSON.parse(bytes)).content.props;
    if (typeof maintainer === "string") process.stdout.write(maintainer);
  }
} catch {}
'
}

if [[ -n "$MAINTAINER_GIVEN" ]]; then
  is_login "$MAINTAINER" || die "--maintainer takes a GitHub login, not: \"$MAINTAINER\""
elif [[ -n "${FACTORY_MAINTAINER:-}" ]]; then
  MAINTAINER="$FACTORY_MAINTAINER"
  is_login "$MAINTAINER" || die "FACTORY_MAINTAINER is not a GitHub login: \"$MAINTAINER\"; give --maintainer <login>"
else
  MAINTAINER="$(installed_maintainer)"
  is_login "$MAINTAINER" || die "no maintainer: give --maintainer <login> or set FACTORY_MAINTAINER"
  echo "install.sh: maintainer $MAINTAINER, kept from the installed layout" >&2
fi

STAGE="$(mktemp -d "${TMPDIR:-/tmp}/factory-mod-install.XXXXXX")"
trap 'rm -rf "$STAGE"' EXIT
mkdir -p "$STAGE/mods/factory" "$STAGE/layouts"

# What would be written: the mod (not what the app or the build writes into its folder), the cats and the layout.
tar -C "$HERE/factory" --exclude=./cats --exclude='*.d.ts' --exclude=jsconfig.json -cf - . | tar -C "$STAGE/mods/factory" -xf -
node "$HERE/build-cats.mjs" --out "$STAGE/mods/factory/cats" >/dev/null
FIXTURE_LIST="$(printf '%s\n' "${FIXTURES[@]+"${FIXTURES[@]}"}")"
DOCKER_HOST_VALUE="unix://${XDG_RUNTIME_DIR:-/run/user/$(id -u)}/podman/podman.sock"
DOCKER_HOST_VALUE="$DOCKER_HOST_VALUE" CHECKOUT="$CHECKOUT" MAINTAINER="$MAINTAINER" SPACES="$SPACES" SIDE="$SIDE" FIXTURE_LIST="$FIXTURE_LIST" \
  LAYOUT_IN="$HERE/layouts/factory.json" LAYOUT_OUT="$STAGE/layouts/factory.json" node -e '
const fs = require("node:fs");
const layout = JSON.parse(fs.readFileSync(process.env.LAYOUT_IN, "utf8"));
const find = (n) => (n.id === "factory" ? n : (n.children ?? []).map(find).find(Boolean));
const props = find(layout).content.props;
const findParent = (n) => ((n.children ?? []).some((c) => c.id === "factory") ? n : (n.children ?? []).map(findParent).find(Boolean));
const body = findParent(layout);
const block = body.children.find((c) => c.id === "factory");
body.children = body.children.filter((c) => c !== block);
if (process.env.SIDE === "left") body.children.unshift(block); else body.children.push(block);
props.side = process.env.SIDE;
props.checkout = process.env.CHECKOUT;
props.maintainer = process.env.MAINTAINER;
props.dockerHost = process.env.DOCKER_HOST_VALUE;
if (process.env.SPACES) props.spaces = JSON.parse(fs.readFileSync(process.env.SPACES, "utf8"));
const fixtures = process.env.FIXTURE_LIST.split("\n").filter(Boolean);
if (fixtures.length > 0) props.fixture = fixtures;
fs.writeFileSync(process.env.LAYOUT_OUT, JSON.stringify(layout, null, 2) + "\n");
'

# Compare with what is installed, then write all of it or none.
STAGE="$STAGE" APP="$APP" node -e '
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { STAGE, APP } = process.env;
const hash = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const walk = (dir, base = "") =>
  fs.readdirSync(path.join(dir, base), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(dir, path.join(base, e.name)) : [path.join(base, e.name)]);
const manifestFile = path.join(APP, "factory-mod-install.json");
let recorded = {};
if (fs.existsSync(manifestFile)) recorded = JSON.parse(fs.readFileSync(manifestFile, "utf8")).files ?? {};
const files = walk(STAGE).toSorted();
const conflicts = files.filter((f) => {
  const dest = path.join(APP, f);
  return fs.existsSync(dest) && recorded[f] !== hash(dest);
});
if (conflicts.length > 0) {
  for (const f of conflicts) console.error(`install.sh: ${path.join(APP, f)} exists and this installer did not write it as it is; nothing was installed`);
  process.exit(1);
}
const written = { ...recorded };
for (const f of files) {
  const dest = path.join(APP, f);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(path.join(STAGE, f), dest);
  written[f] = hash(dest);
}
fs.writeFileSync(manifestFile, JSON.stringify({ files: written }, null, 2) + "\n");
console.log(`installed ${files.length} files into ${APP} (mods/factory, layouts/factory.json)`);
'
