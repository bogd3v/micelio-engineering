## Tests

Commands exactly as run, from `/home/alejo9420/Git/wt-e235`; logs in `/home/alejo9420/Git/factory/packets/e235/logs/`.

1. `/home/alejo9420/Git/micelio-engineering/herdr/factory-slot.sh run -- npm run check`: exit 0, 25 test files, 518 tests passed (round 1: 515; main at the issue: 25 files, 502 tests), `lint:licenses` and `lint:standard` ok. Load above 8 on 8 cores at the start, 14.5 at the end, no timeouts. Log `logs/npm-run-check.log`.
2. `/home/alejo9420/Git/micelio-engineering/herdr/factory-slot.sh run -- npm run verify:template`: exit 0, "A repository created from the template passes npm run check, build and reuse lint." Log `logs/npm-run-verify-template.log`.
3. `/home/alejo9420/Git/micelio-engineering/herdr/factory-slot.sh run -- npm run verify:isolated`: exit 0, "Isolated fixture passes lint, typecheck and format:check." Log `logs/npm-run-verify-isolated.log`.
4. `npx vitest run packages/factory-tools/test/lint-issue.test.ts packages/factory-tools/test/ready.test.ts -t "lane|ready|applyReadiness|own repository"`: exit 0, 23 passed (82 skipped), including the four named lane tests, the three new `own repository of the issue` tests and all of `ready.test.ts`. Log `logs/vitest-named.log`.
5. `npm run build >/dev/null 2>&1 && for n in 235 238 239 240 241 255; do node packages/factory-tools/dist/cli.js lint-issue bogd3v/micelio-engineering#$n; echo "exit $?"; done > logs/lint-issue-epic.log`: exit 0; per-issue exit codes 0, 1, 1, 1, 1, 0 (round 2: the lanes now come from each issue's repository through `gh`; same results as round 1). Log `logs/lint-issue-epic.log`.

The final-diff run is 1–5, all rerun in round 2 after the last change.

Tests that fail without each new guard or branch (the production lines reverted in a scratch copy of the final diff under `/home/alejo9420/Git/factory/tmp/`, removed afterwards, with the worktree's `node_modules` linked; all rerun in round 2):

- The `lane` rule (`laneCriterion` returns ok at once): `npx vitest run packages/factory-tools/test/lint-issue.test.ts -t "the lane rule"` fails 3 of 4: "lane fails an express issue that asks for the stack, and names the sentence it expected" (`expected true to be false`), "lane fails an issue with no maintainer criterion, or with two" (`expected true to be false`) and "the report starts with the lane" (`expected +0 to be 1`); the fourth, "lane passes a full issue verified on the stack", passes by design. Log `logs/revert-rules.log`.
- The `lane: <lane>` first line of the report removed (`report.ts`): `npx vitest run packages/factory-tools/test/lint-issue.test.ts -t "the report starts with the lane"` fails (`expected '**lint-issue** · `test/fixtures/fail-…' to be 'lane: full'`; 1 failed). Log `logs/revert-others.log`.
- `run.ts` not passing the lanes to the rule: the same command fails (`expected 1 to be +0`: an express issue is judged `full`; 1 failed). `logs/revert-others.log`.
- `failingReport` in `metrics.ts` not skipping the lane line: `npx vitest run packages/factory-tools/test/metrics.test.ts` fails "reads a report that starts with its lane line" (1 failed, 138 passed). `logs/revert-others.log`.
- `parseEvent` not skipping the lane line: the same command fails `parseEvent > reads "lane: full\n**lint-issue** · …"` (1 failed, 138 passed). `logs/revert-others.log`.
- Round 2: the lanes read from the issue's own repository. `npm run build >/dev/null && npx vitest run packages/factory-tools/test/lint-issue.test.ts -t "own repository of the issue"` in a scratch copy with (1) the `gh` read bypassed: 2 failed (`expected 'lane: normal' to be 'lane: full'`, `expected 'lane: normal' to be 'lane: express'`; the scratch is a git repository so the checkout's `AGENTS.md` is found); (2) a 404 treated as an error: 1 failed (`expected 'error: gh: Not Found (HTTP 404)\n' to be ''`); (3) `run` passing no repository: 2 failed (`expected [ null, null ] to deeply equal [ 'example/site', null ]`). Log `logs/revert-r2.log` (its first run of revert 1 was in a scratch that is not a git repository and so passed; the log says it and reruns it); the three reverts of `run.ts` are those of round 2's `gh` read.
- A repository with no `## Lanes` block stays `full`: covered by `lane passes a full issue verified on the stack` (the plain `pass.md`) and by `passes test/fixtures/pass.md with exit 0`; this behaviour is `issueLane`'s own (#234), not new code.
- `docs/` and README changes: no test: not code.


