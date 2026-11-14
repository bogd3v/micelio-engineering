## Tests

Baseline on `main` at cc1517b (before the change), each through `/home/alejo9420/Git/micelio-engineering/herdr/factory-slot.sh run --`; load 25.70 on 8 cores at the start of the check (above the core count; no timeouts, nothing failed). A first attempt found no `node_modules` in the worktree (`tsc: orden no encontrada`, exit 127); I ran `npm ci` and repeated all three, and only the repeated runs are reported.

1. `factory-slot.sh run -- npm run check` on main: exit 0, 25 test files, 525 tests passed. Log `logs/main-npm-run-check.log`.
2. `factory-slot.sh run -- npm run verify:template` on main: exit 0, 1 test file, 1 test passed; "A repository created from the template passes npm run check, build and reuse lint." Log `logs/main-npm-run-verify-template.log`.
3. `factory-slot.sh run -- npm run verify:isolated` on main: exit 0, "Isolated fixture passes lint, typecheck and format:check." Log `logs/main-npm-run-verify-isolated.log`.

Final diff (run last, in this order, all after the last change):

1. `/home/alejo9420/Git/micelio-engineering/herdr/factory-slot.sh run -- npm run check`: exit 0, 25 test files, 530 tests passed (main: 525; +5 new tests); `lint:licenses` and `lint:standard` ok; load 7.66 on 8 cores at the start. Log `logs/final-npm-run-check.log`.
2. `/home/alejo9420/Git/micelio-engineering/herdr/factory-slot.sh run -- npm run verify:template`: exit 0, 1 test file, 1 test passed; "A repository created from the template passes npm run check, build and reuse lint." Log `logs/final-npm-run-verify-template.log`.
3. `/home/alejo9420/Git/micelio-engineering/herdr/factory-slot.sh run -- npm run verify:isolated`: exit 0, "Isolated fixture passes lint, typecheck and format:check." Log `logs/final-npm-run-verify-isolated.log`.
4. `npx vitest run packages/factory-tools/test/verify-draft.test.ts`: exit 0, 1 test file, 21 tests passed, including the five named tests (acceptance criteria 1–5). Log `logs/vitest-verify-draft.log`.
5. `node packages/factory-tools/dist/cli.js verify-draft --draft <#264 Tests section without its items 1–3> --cwd .`: exit 1, prints `no command ran: …` and `Verdict: Red · 0 mismatches`. Log `logs/cli-no-command.log`. (Items 1–3 are left out because they would now run the heavy commands.)

Tests that fail without each new guard or branch (production lines reverted one at a time in a scratch copy of the worktree under `/home/alejo9420/Git/factory/tmp/`, removed afterwards; command `npx vitest run packages/factory-tools/test/verify-draft.test.ts`; full output `logs/revert.log`):

- `testsEntries` regex back to `/^[-*]\s+(.*)$/` (numbered items): 2 failed, 19 passed. "a numbered item of the Tests section is an entry, as a bullet is" (`expected [] to deeply equal [ 'npm test', 'npm test' ]`) and "the Tests section of pull request #264 runs its repository commands" (`expected [] to deeply equal [ 'npm run check', …(2) ]`).
- `tokenize(command)` instead of `tokenize(withoutSlotPrefix(command))`: 2 failed, 19 passed. "a command run through factory-slot.sh run -- is run without the prefix" (`expected [] to deeply equal [ 'npm test', 'npm run check' ]`) and the #264 test again.
- `const red = mismatches > 0` (no `|| !ran`): 1 failed, 20 passed. "a Tests section in which no command runs is Red with exit 1 and says no command ran" (`expected +0 to be 1`).
- A prefixed command that skips `isRepositoryCommand` (the widening the prefix must not cause): 1 failed, 20 passed. "the factory-slot.sh prefix does not make a command that is not a repository command run" (`expected [ 'rm -rf node_modules', …(1) ] to deeply equal []`). The test passes with the prefix removal reverted by design (nothing then runs), so this is the mutation that proves it.
- `docs/workflows.md`, `README.md`: no test: not code.

