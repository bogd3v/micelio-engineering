#!/usr/bin/env bash
# Opens or updates `docs(standard): sync to $VERSION` in every repository of
# .github/standard-sync.json. Needs GH_TOKEN (the bot's, or any token in a dry run), VERSION,
# DRY_RUN and, for a real run, APP_SLUG. Never merges.
#
# When the version of @micelio/eslint-config that a repository's package-lock.json installs is older
# than the one published from packages/eslint-config (a patch too: it carries the new hashes), the
# same commit raises it (package.json and package-lock.json), so nobody pushes to the bot's pull
# request (a person's push makes dco.yml check the bot's unsigned commit). A repository that cannot
# be raised correctly (no package.json or lockfile, the package not in the root package.json, npm
# workspaces, a broken toolchain) fails with an error and gets no pull request.
# The lockfile is made by the Node and npm of the repository's own .nvmrc, downloaded from
# NODE_DIST (default https://nodejs.org/dist) and checked against its SHASUMS256.txt, never by the
# npm of this runner.
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
work=$(mktemp -d)
branch="docs/standard-sync-${VERSION}"
title="docs(standard): sync to ${VERSION}"
failed=0
package=@micelio/eslint-config
published=$(jq -r .version "$root/packages/eslint-config/package.json")
node_dist=${NODE_DIST:-https://nodejs.org/dist}

# Prints the directory of the Node toolchain (node and the npm bundled with it) for the version in
# the .nvmrc of $1, downloading it once into $work. Fails, saying why, when it cannot.
node_toolchain() {
  local dir=$1 spec platform archive version
  [ -f "$dir/.nvmrc" ] || { echo "no .nvmrc to choose the Node of the lockfile" >&2; return 1; }
  spec=$(tr -d '[:space:]' < "$dir/.nvmrc"); spec=${spec#v}
  [[ "$spec" =~ ^[0-9]+(\.[0-9]+){0,2}$ ]] || { echo ".nvmrc '$spec' is not a Node version" >&2; return 1; }
  case "$(uname -m)" in
    x86_64) platform=linux-x64 ;;
    aarch64 | arm64) platform=linux-arm64 ;;
    *) echo "no Node build for $(uname -m)" >&2; return 1 ;;
  esac
  curl -fsSL -o "$work/index.json" "$node_dist/index.json" || { echo "could not download $node_dist/index.json" >&2; return 1; }
  version=$(jq -r --arg spec "$spec" \
    '[.[].version | ltrimstr("v") | select(. == $spec or startswith($spec + "."))][0] // empty' "$work/index.json") ||
    { echo "$node_dist/index.json is not a list of Node versions" >&2; return 1; }
  [ -n "$version" ] || { echo "no Node $spec in $node_dist" >&2; return 1; }
  archive="node-v${version}-${platform}"
  if [ ! -x "$work/$archive/bin/npm" ]; then
    curl -fsSL -o "$work/$archive.tar.xz" "$node_dist/v${version}/$archive.tar.xz" &&
      curl -fsSL -o "$work/SHASUMS256-$version.txt" "$node_dist/v${version}/SHASUMS256.txt" || {
      echo "could not download Node $version" >&2; return 1
    }
    (cd "$work" && grep " $archive.tar.xz\$" "SHASUMS256-$version.txt" | sha256sum --check --status) || {
      echo "the Node $version archive does not match SHASUMS256.txt" >&2; return 1
    }
    tar -xJf "$work/$archive.tar.xz" -C "$work" || { echo "could not unpack Node $version" >&2; return 1; }
  fi
  [ -x "$work/$archive/bin/node" ] && [ -x "$work/$archive/bin/npm" ] || { echo "Node $version has no bin/node and bin/npm" >&2; return 1; }
  echo "$work/$archive"
}

# Raises @micelio/eslint-config in $1 to ^$published when the version its package-lock.json installs
# is older. Prints `raised <locked> <published>` (dry run: `would-raise`) or `none` (the lockfile
# already has the published version or a newer one). Every step is checked: any failure returns 1
# with the reason on stderr, never `none`.
raise_package() {
  local dir=$1 range locked toolchain decision
  [ -f "$dir/package.json" ] || { echo "no package.json to raise $package in" >&2; return 1; }
  jq -e type "$dir/package.json" > /dev/null 2>&1 || { echo "package.json is not valid JSON" >&2; return 1; }
  if jq -e 'has("workspaces")' "$dir/package.json" > /dev/null; then
    echo "package.json has npm workspaces, which the raise does not support" >&2; return 1
  fi
  range=$(jq -r --arg p "$package" '.devDependencies[$p] // .dependencies[$p] // empty' "$dir/package.json") || return 1
  [ -n "$range" ] || { echo "the root package.json does not declare $package" >&2; return 1; }
  [ -f "$dir/package-lock.json" ] || { echo "no package-lock.json to raise" >&2; return 1; }
  locked=$(jq -r --arg k "node_modules/$package" '.packages[$k].version // empty' "$dir/package-lock.json") || {
    echo "package-lock.json is not valid JSON" >&2; return 1
  }
  [ -n "$locked" ] || { echo "package-lock.json has no entry for $package" >&2; return 1; }
  toolchain=$(node_toolchain "$dir") || return 1
  decision=$("$toolchain/bin/node" -e '
    const semver = require(process.argv[1] + "/lib/node_modules/npm/node_modules/semver")
    const [locked, published] = process.argv.slice(2)
    if (!semver.valid(locked) || !semver.valid(published)) process.exit(2)
    console.log(semver.lt(locked, published) ? "raise" : "keep")
  ' "$toolchain" "$locked" "$published") || { echo "could not compare $locked with $published" >&2; return 1; }
  case "$decision" in
    keep) echo none; return 0 ;;
    raise) ;;
    *) echo "could not compare $locked with $published" >&2; return 1 ;;
  esac
  if [ "$DRY_RUN" = true ]; then echo "would-raise $locked $published"; return 0; fi
  (cd "$dir" && env -u GH_TOKEN -u GITHUB_TOKEN PATH="$toolchain/bin:$PATH" \
    npm install "$package@^$published" --package-lock-only --ignore-scripts --no-audit --no-fund >&2) || return 1
  echo "raised $locked $published"
}

if [ "$DRY_RUN" != true ]; then
  gh auth setup-git
  bot_id=$(gh api "/users/${APP_SLUG}[bot]" --jq .id)
  git config --global user.name "${APP_SLUG}[bot]"
  git config --global user.email "${bot_id}+${APP_SLUG}[bot]@users.noreply.github.com"
fi

for repo in $(jq -r '.repositories[]' "$root/.github/standard-sync.json"); do
  echo "::group::$repo"
  dir="$work/${repo#*/}"
  if ! gh repo clone "$repo" "$dir" -- --depth 1 --quiet; then
    echo "::error::could not clone $repo"; failed=1; echo "::endgroup::"; continue
  fi
  result=$(node "$root/scripts/apply-standard.mjs" "$dir") || { echo "::error::$repo: AGENTS.md has no pin to move"; failed=1; echo "::endgroup::"; continue; }
  if [ "$result" = unchanged ]; then
    echo "$repo is already on standard ${VERSION}."
    echo "::endgroup::"; continue
  fi
  if ! raised=$(raise_package "$dir"); then
    echo "::error::$repo: could not raise $package to ^$published"; failed=1; echo "::endgroup::"; continue
  fi
  git -C "$dir" status --short --untracked-files=all
  case "$raised" in
    would-raise*) read -r _ from to <<< "$raised"; echo "Dry run: would raise $package from $from to $to (^$to in package.json, $to in package-lock.json)." ;;
    raised*) read -r _ from to <<< "$raised"; echo "Raised $package from $from to $to." ;;
  esac
  if [ "$DRY_RUN" = true ]; then
    echo "Dry run: would open '$title' in $repo."
    echo "::endgroup::"; continue
  fi
  base=$(gh repo view "$repo" --json defaultBranchRef --jq .defaultBranchRef.name)
  git -C "$dir" switch --quiet -c "$branch"
  git -C "$dir" add -A
  upgrade=; upgrade_body=
  if [ "${raised%% *}" = raised ]; then
    upgrade=" and raises ${package} to ^${published}"
    upgrade_body="It also raises \`${package}\` from ${from} to ${to} (the range in \`package.json\` and \`package-lock.json\`), so the new hashes are installed, in this same commit: do not push to this branch, because a person's push makes the DCO check run on the bot's unsigned commit. A fix goes in a separate pull request.

"
  fi
  git -C "$dir" commit --quiet -m "$title" -m "Replaces docs/engineering-standard.md, moves the pin in AGENTS.md to ${VERSION}${upgrade} and copies the agent prompts, skills and pull request template listed in standard-sync.json, from ${SOURCE}."
  git -C "$dir" push --quiet --force origin "$branch"
  body="Replaces the local copy of the engineering standard with version ${VERSION}, moves the pin in \`AGENTS.md\` and copies the factory's agent prompts, skills and pull request template (the \`files\` of \`.github/standard-sync.json\`), from ${SOURCE}.

Review it like any other change and merge it by hand: the Micelio bot never merges.

${upgrade_body}If \`npm run lint:standard\` says the version is unknown, or that a synced file does not match, \`@micelio/eslint-config\` must be upgraded to the release that publishes the new hashes. This pull request does it when the lockfile installs an older release; if it does not and the error persists, upgrade it in a separate pull request. A repository may stay on an older version on purpose: close this pull request."
  existing=$(gh pr list --repo "$repo" --head "$branch" --state open --json number --jq '.[0].number // empty')
  if [ -n "$existing" ]; then
    gh pr edit "$existing" --repo "$repo" --title "$title" --body "$body"
    echo "Updated $repo#$existing"
  else
    gh pr create --repo "$repo" --base "$base" --head "$branch" --title "$title" --body "$body"
  fi
  echo "::endgroup::"
done

exit "$failed"
