# Agent workflow

[AGENTS.md](../AGENTS.md) is the policy. This page is the working checklist.

1. Check the branch, working tree, remote main, open PRs/issues and CI. Preserve
   existing work; use an isolated worktree if needed.
2. Read affected source and relevant docs. Verify that a task is still needed.
3. Use a short-lived branch and make one coherent change. Preserve service
   boundaries, ownership, data and compatibility. Record new architectural
   decisions before implementing a new pattern.
4. Run [applicable checks](CI_POLICY.md) with disposable data. Do not start
   unrelated backends for frontend/docs changes or weaken checks to pass.
5. Review the full diff: errors, migrations, dependencies, docs and accidental
   secrets/generated files. Run `git diff --check`.
6. Open a Conventional Commit PR to `main`. Fix failures and wait for every
   applicable check. Scope-selected skips are intentional.
7. Squash-merge when checks pass and repository rules allow it. Never bypass
   protection or approval. If blocked, leave a verified PR with the exact reason.
8. Confirm the merge and any deployment. Report the PR, actual tests and limits.

Routine work stays under `[Unreleased]`. Releases follow
[RELEASING.md](RELEASING.md), with exact-source checks and immutable tags.
Hardware observations and independent reviews stay open until real evidence
exists; automated tests cannot substitute for them.
