# Cuts `gh api` output down to the fields `factory-tools metrics` reads (see record.sh).
def user: {login: .user.login};
def milestone: if .milestone then {number: .milestone.number, title: .milestone.title} else null end;
# The lines that cite an issue or a pull request: where a pull request closes an issue, and where a
# `fix` issue names the pull request it came from. The rest of a body is dropped.
def citing: (. // "") | split("\n") | map(select(test("#[0-9]|/pull/[0-9]")) | .[0:300]) | join("\n");
# Only the lines `metrics` reads to link a pull request to an issue.
def closing: (. // "") | split("\n") | map(select(test("\\b(close[sd]?|fix(e[sd])?|resolve[sd]?|refs?)\\s+#[0-9]"; "i")) | .[0:300]) | join("\n");
def issue: {
  number, title, state, user: user, milestone: milestone,
  labels: [.labels[]? | {name}],
  pull_request: (if .pull_request then {} else null end),
  body: (if (.title | test("^fix")) then (.body | citing) else "" end)
};
# A comment keeps its first line (and the line after the `issue-ready` marker), its `factory-log |` lines and, of a review report, its headings,
# the lines that start a finding and the line that counts the verifier's mismatches.
def marked: (.body // "") | startswith("<!-- micelio:issue-ready -->");
def comment: {
  user: user, created_at,
  body: ((.body // "") | split("\n") | . as $lines | to_entries
    | map(select(.key == 0 or (.key == 1 and ($lines[0] | startswith("<!-- micelio:issue-ready -->"))) or (.value | test("^(factory-log \\||## |\\*\\*B[0-9]+\\.|\\*\\*Mismatches:)"))))
    | map(.value[0:400]) | join("\n"))
} + (if marked then {node_id} else {} end);
# The versions of a comment that `issue-ready` edits in place, from GraphQL `userContentEdits`: the
# time and the first two lines (the marker and the `lint-issue` heading) of each. Nothing else is kept.
def edit: {editedAt, diff: ((.diff // "") | split("\n") | .[0:2] | join("\n"))};
def review: {user: user, state, submitted_at, body: (.body // "")};
def review_comment: {user: user, created_at, body: ((.body // "")[0:400])};
def pull_of_list: {number, title, state, merged_at, created_at, base: {ref: .base.ref}, user: user, milestone: milestone, body: (.body | closing)};
def commit: {sha, commit: {committer: {date: .commit.committer.date}}};
def rule: select(.type == "required_status_checks") | {type, parameters: {required_status_checks: [.parameters.required_status_checks[] | {context}]}};
def pull_detail: {number, additions, deletions, changed_files, user: {login: .user.login}, head: {sha: .head.sha}, base: {ref: .base.ref}};
def checks: {check_runs: [.check_runs[] | {name, status, conclusion}]};
