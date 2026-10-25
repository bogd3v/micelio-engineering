#!/usr/bin/env bash
# Records the fixtures of `factory-tools metrics` from the GitHub API with `gh api` (read only).
# Usage: [ISSUES="<number>..."] record.sh <owner/repo> <milestone number> <PR number>...
# ISSUES lists issues outside the milestone whose comments are recorded too (#51 has the live
# `issue-ready` comment that went from failing to passing).
# Every file is what `gh api` returned, cut down by record.jq to the fields `metrics` reads: a user
# is only its login, and a comment keeps its first line, its `factory-log |` lines and the headings
# finding lines and mismatch count of a review report. Nothing else is kept. The correction log is
# copied as it is, for the Destination count. Of a comment that starts with the `issue-ready` marker
# the edit history is recorded too, as `comment-edits/<node id>.json` (`gh api graphql`, read only).
set -euo pipefail
repo=$1 milestone=$2
shift 2
dir=$(cd "$(dirname "$0")" && pwd)
api() { gh api --paginate --slurp "$@" | jq 'add // []'; }
q() { jq -L "$dir" "include \"record\"; $1"; }

mkdir -p "$dir/comments" "$dir/comment-edits" "$dir/pulls" "$dir/check-runs"
api "repos/$repo/milestones?state=all" | jq '[.[] | {number, title, state}]' >"$dir/milestones.json"
api "repos/$repo/issues?milestone=$milestone&state=all&per_page=100" | q '[.[] | issue]' >"$dir/milestone-issues.json"
api "repos/$repo/issues?state=all&per_page=100" | q '[.[] | issue]' >"$dir/all-issues.json"
api "repos/$repo/pulls?state=all&per_page=100" | q '[.[] | pull_of_list]' >"$dir/pulls.json"

# shellcheck disable=SC2086 # ISSUES is a list of numbers
for n in $(jq -r '.[].number' "$dir/milestone-issues.json") "$@" ${ISSUES:-}; do
  api "repos/$repo/issues/$n/comments?per_page=100" | q '[.[] | comment]' >"$dir/comments/$n.json"
done
# The comment an app edits in place has no other history than its edits.
edits='query($id: ID!) { node(id: $id) { ... on IssueComment { userContentEdits(first: 100) { nodes { editedAt diff } } } } }'
for id in $(jq -r '.[] | .node_id // empty' "$dir"/comments/*.json); do
  gh api graphql -f query="$edits" -f id="$id" | q '[.data.node.userContentEdits.nodes // [] | .[] | edit]' >"$dir/comment-edits/$id.json"
done
for n in "$@"; do
  gh api "repos/$repo/pulls/$n" | q 'pull_detail' >"$dir/pulls/$n.json"
  api "repos/$repo/pulls/$n/reviews?per_page=100" | q '[.[] | review]' >"$dir/pulls/$n.reviews.json"
  api "repos/$repo/pulls/$n/comments?per_page=100" | q '[.[] | review_comment]' >"$dir/pulls/$n.review-comments.json"
  api "repos/$repo/pulls/$n/commits?per_page=100" | q '[.[] | commit]' >"$dir/pulls/$n.commits.json"
  # The checks of the commits pushed after the pull request opened, as `metrics` reads them.
  opened=$(gh api "repos/$repo/pulls/$n" --jq .created_at)
  for sha in $(jq -r --arg opened "$opened" '.[] | select(.commit.committer.date > $opened) | .sha' "$dir/pulls/$n.commits.json"); do
    gh api "repos/$repo/commits/$sha/check-runs?per_page=100" | q 'checks' >"$dir/check-runs/$sha.json"
  done
done
mkdir -p "$dir/rules"
api "repos/$repo/rules/branches/main?per_page=100" | q '[.[] | rule]' >"$dir/rules/main.json"
cp "$dir/../../../../../docs/factory-log.md" "$dir/factory-log.md"
