#!/usr/bin/env bash
# install.sh — installs the factory mod into the Herdr desktop app's configuration folder.
#
#   herdr/mod/install.sh [--maintainer <login>] [--spaces <file.json>] [--theme dark|light|follow] [--fixture <folder>]...
#
# Builds the agent cats (herdr/mod/build-cats.mjs) and copies the mod to <app>/mods/factory/ and the
# layout, with the panel docked on the right of Herdr's `main`, to <app>/layouts/factory.json; <app> is
# $HERDR_APP_DIR, else ~/.config/herdr-app. It never overwrites a file it did not write: it records the
# hash of each file it writes in <app>/factory-mod-install.json, and when one of the files it would write
# exists with another hash (or is not recorded), it writes nothing, says which, and exits 1. A file it
# wrote and nobody changed is replaced, so running it again updates the install.
#
#   --maintainer <login>   the GitHub login whose gate comments count (default $FACTORY_MAINTAINER)
#   --spaces <file.json>   the layout's `spaces`: [{ "name", "repo", "milestone", "epic" }, …]
#   --theme <name>         the theme the panel starts in until the maintainer picks one (default dark)
#   --fixture <folder>     read the recordings of <folder> instead of the machine (repeat for a list)
#
# Needs bash, node, tar and the coreutils.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHECKOUT="$(cd "$HERE/../.." && pwd)"
APP="${HERDR_APP_DIR:-$HOME/.config/herdr-app}"
MAINTAINER="${FACTORY_MAINTAINER:-}"
SPACES=""
THEME=""
FIXTURES=()

die() { echo "install.sh: $*" >&2; exit 2; }
usage() { sed -n '2,21p' "$0" | sed 's/^# \{0,1\}//' >&2; exit 2; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --maintainer) MAINTAINER="${2:-}"; shift 2 ;;
    --spaces) SPACES="${2:-}"; shift 2 ;;
    --theme) THEME="${2:-}"; shift 2 ;;
    --fixture) FIXTURES+=("${2:-}"); shift 2 ;;
    -h|--help) usage ;;
    *) usage ;;
  esac
done
[[ -z "$SPACES" || -f "$SPACES" ]] || die "no such file: $SPACES"
case "$THEME" in ''|dark|light|follow) ;; *) die "--theme is dark, light or follow, got '$THEME'" ;; esac

STAGE="$(mktemp -d "${TMPDIR:-/tmp}/factory-mod-install.XXXXXX")"
trap 'rm -rf "$STAGE"' EXIT
mkdir -p "$STAGE/mods/factory" "$STAGE/layouts"

# What would be written: the mod (not what the app or the build writes into its folder), the cats and the layout.
tar -C "$HERE/factory" --exclude=./cats --exclude='*.d.ts' --exclude=jsconfig.json -cf - . | tar -C "$STAGE/mods/factory" -xf -
node "$HERE/build-cats.mjs" --out "$STAGE/mods/factory/cats" >/dev/null
FIXTURE_LIST="$(printf '%s\n' "${FIXTURES[@]+"${FIXTURES[@]}"}")"
CHECKOUT="$CHECKOUT" MAINTAINER="$MAINTAINER" SPACES="$SPACES" THEME="$THEME" FIXTURE_LIST="$FIXTURE_LIST" \
  LAYOUT_IN="$HERE/layouts/factory.json" LAYOUT_OUT="$STAGE/layouts/factory.json" node -e '
const fs = require("node:fs");
const layout = JSON.parse(fs.readFileSync(process.env.LAYOUT_IN, "utf8"));
const find = (n) => (n.id === "factory" ? n : (n.children ?? []).map(find).find(Boolean));
const props = find(layout).content.props;
props.checkout = process.env.CHECKOUT;
props.maintainer = process.env.MAINTAINER;
if (process.env.THEME) props.theme = process.env.THEME;
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
