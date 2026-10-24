---
name: ship-pr
description: Gate 5 of the Micelio factory - branch, prepare the commit for the maintainer to sign, then push, open the pull request and watch CI. Use when a change has passed the blind review and the verification and is ready to be delivered, or when asked to open, update or rebase a pull request.
---

# Ship a PR

This is gate 5 of the factory (`docs/factory.md` of `micelio-engineering`). The standard still rules: sections 11 and 13.

## Branch

- Always from the latest `main`: `git fetch origin && git switch -c <type>/<short-topic> origin/main`. Never commit on `main`, and never stack on another open branch unless the change depends on it.
- One concern per pull request. Security fixes, refactors, docs and dependency updates travel separately.

## Before the maintainer

Gate 5 starts only after gates 2, 3 and 4 passed. Nothing is committed before it.

1. `npm run check` is green and the pull request draft has the real output of every command.
2. Tell the maintainer the change is ready and what only they can see on Docker (below). Then wait.
3. Prepare the commit: write the message to a file outside the worktree and give the maintainer the exact commands. Never run `git commit -s` yourself, and never add a `Signed-off-by`: the sign-off is the maintainer's certification of the DCO.

## Docker by risk

- The worker proved the acceptance criteria on the repository's Docker (or the run `AGENTS.md` names instead), and the verifier re-created it from scratch. Cite both runs in the pull request.
- The maintainer tests on Docker only what an operator or an editor sees: the admin UI, variables, migrations, Compose. Give the steps (image from the branch, the Compose to run it against, what to look at) for those and for nothing else.
- A change nobody sees that way (tooling, documents, a library) needs no maintainer Docker run.

## Commit

- Message: English, conventional prefix with an optional scope (`feat`, `fix`, `docs`, `refactor`, `style`, `test`, `ci`, `perf`, `chore`; `chore(deps)` for dependencies, scope `security` for security fixes). The subject is imperative, about 72 characters; the body gives the problem, then what changed, then what the reviewer must know. End with `Co-Authored-By: <the tool> <noreply@anthropic.com>` as the session gives it.
- Stage explicit paths (`git add <paths>`); never `git add -A` blindly (scratch files, `.playwright-mcp/`, a local `.env`).
- The maintainer reads the whole diff (standard, section 11) and then runs only the commit you prepared, from the message file:

  ```bash
  git add <paths>
  git commit -s -F <message file>
  ```

  A commit made without `-s` is amended by the maintainer with `git commit --amend --reset-author -s --no-edit`. Never amend or force-push a commit the maintainer signed.

## Push and open the pull request

Only after the maintainer says the commit is made.

1. Check conflicts first:

   ```bash
   git fetch origin
   git merge-tree --write-tree origin/main HEAD >/dev/null && echo ok
   ```

2. Push: `git push -u origin <branch>`. If the branch was rebased, `git push --force-with-lease=<branch>:<sha> origin <branch>` with the sha you last saw on the remote, never a bare `--force`. If `package.json` or the lockfile conflict, take both from `main`, re-add your dependency with `npm install` so npm regenerates the lock, and never hand-edit the lockfile.
3. Open the pull request with `gh pr create` (or the REST API when the account cannot use it). The title has the same conventional prefix and sets the release label (`pr-labels.yml`); the body follows `.github/pull_request_template.md`: Problem, What changes, For review, Tests with each command, its real output and the Docker used, and "Instructions that were wrong or missing". It references its issue: `Refs #N`, or `Closes #N` in the last one. End with the attribution line the session gives.
4. Update the issue's **Progress** section in the same step: the pull request, what changed with numbers, what remains. `gh issue view <n> --json body -q .body` and `gh issue edit <n> --body-file <file>`.
5. Watch CI: `gh run list --branch <branch> --limit 1`, then `gh run watch`. A red check goes back to you; never merge around it.

## The approval

The maintainer's approval carries a line `time: <minutes>m diff|report` (`diff` when they started from the diff, `report` when they started from the reviewer's and verifier's reports; `docs/factory.md`, review levels). When the maintainer's own account opened the pull request, GitHub does not allow it to approve, so the line goes in a review comment instead:

```bash
gh pr review <n> --comment -b "time: 10m diff"
```

## Never

Push, merge, tag, release or deploy without the maintainer's confirmation. Only the maintainer releases (standard, section 13); prepare a release, never run it unasked.
