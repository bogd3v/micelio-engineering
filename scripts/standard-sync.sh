#!/usr/bin/env bash
# Opens or updates `docs(standard): sync to $VERSION` in every repository of
# .github/standard-sync.json. Needs GH_TOKEN (the bot's, or any token in a dry run), VERSION,
# DRY_RUN and, for a real run, APP_SLUG. Never merges.
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
work=$(mktemp -d)
branch="docs/standard-sync-${VERSION}"
title="docs(standard): sync to ${VERSION}"
failed=0

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
  git -C "$dir" --no-pager diff --stat
  if [ "$DRY_RUN" = true ]; then
    echo "Dry run: would open '$title' in $repo."
    echo "::endgroup::"; continue
  fi
  base=$(gh repo view "$repo" --json defaultBranchRef --jq .defaultBranchRef.name)
  git -C "$dir" switch --quiet -c "$branch"
  git -C "$dir" add docs/engineering-standard.md AGENTS.md
  git -C "$dir" commit --quiet -m "$title" -m "Replaces docs/engineering-standard.md and moves the pin in AGENTS.md to ${VERSION}, from ${SOURCE}."
  git -C "$dir" push --quiet --force origin "$branch"
  body="Replaces the local copy of the engineering standard with version ${VERSION} and moves the pin in \`AGENTS.md\`, from ${SOURCE}.

Review it like any other change and merge it by hand: the Micelio bot never merges. If \`npm run lint:standard\` says the version is unknown, upgrade \`@micelio/eslint-config\` to the release that publishes its hash. A repository may stay on an older version on purpose: close this pull request."
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
