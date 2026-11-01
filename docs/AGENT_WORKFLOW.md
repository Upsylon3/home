# Autonomous LLM engineering workflow

This document turns `AGENTS.md` into a repeatable operating procedure. It is written for coding agents working without routine owner supervision.

## Mission

Build HOME into the product defined by its specifications, improving it continuously without sacrificing security, data integrity, architecture, usability or maintainability. An agent owns a task from discovery through implementation, verification, PR feedback and merge when allowed. A plan or an open PR is not, by itself, a completed task.

The owner has delegated routine decisions. Do not ask them to settle ordinary design, implementation, testing, naming, prioritization or review questions. Make the best evidence-based decision and record consequential assumptions in the PR. This does not authorize production access, external deployments or changes to account/repository security settings.

## 1. Session bootstrap

Start by establishing the actual repository state. Do not assume the current branch, worktree or local checkout is clean.

```bash
git status --short --branch
git remote -v
git branch --show-current
git log -8 --oneline --decorate
```

If there are pre-existing changes, inspect them and preserve them. Never use `git reset --hard`, `git clean -fd`, blanket stashing or checkout commands that discard unknown work. If the worktree is not safe to use, create a separate worktree or use another clean clone.

Update the local view of GitHub before choosing work:

```bash
git fetch origin --prune
```

Inspect open PRs, open issues, recent merged PRs and the latest CI state using the available GitHub CLI/API. Avoid duplicating work already in progress. If another agent owns the same objective, coordinate through that PR rather than creating a competing implementation.

For a clean local checkout, enable the project hook once:

```bash
git config core.hooksPath .githooks
```

## 2. Understand before editing

Read `AGENTS.md` first. Then read only the relevant parts of the governing documents and code. For a cross-service or architectural task, read at least:

- `HOME_MASTER_SPECIFICATION.md`
- `HOME_ARTISTIC_DIRECTION.md`
- `docs/ARCHITECTURE.md`
- `docs/SECURITY.md`
- `docs/API.md`
- `docs/ROADMAP.md`

For UI work, also read `docs/DESIGN_SYSTEM.md`. For commands, local services and tests, read `docs/DEVELOPMENT.md`. For deployment implications, read `docs/DEPLOYMENT.md`. For version/release changes, read `VERSIONING.md` and `docs/RELEASING.md`.

Trace the complete affected flow before coding: frontend → API client → backend route → authorization → service/domain logic → database/storage → response/UI. Inspect existing tests, migrations, sibling implementations and callers. Do not infer behavior from names or old documentation alone.

When intended behavior and current implementation differ:

1. Confirm the actual behavior in source and tests.
2. Determine whether the difference is an acknowledged compromise, a bug, or a stale document.
3. Preserve deliberate security/architecture decisions.
4. Record a genuine design choice and update whichever governing/current-state document is stale.
5. Do not make a broad rewrite merely to make code resemble an old design sketch.

## 3. Select the next task

Use this order; re-evaluate it at the start of every session:

1. Fix a failing required workflow or a verified regression/security/data-integrity defect.
2. Complete the highest-value feasible item in the concrete near-term backlog in `docs/ROADMAP.md`.
3. Continue the decided product build order and complete a coherent user journey, not a disconnected technical skeleton.
4. Resolve verified maintenance issues (runtime/dependency compatibility, reliability, accessibility, build/deployment problems).
5. Consider ideas in sections explicitly labelled speculative only after committed work is in good shape.

For a roadmap item, verify it is still open in the current code and has no active PR. Do not assume an old "not done" note remains true. Update the roadmap when a task is completed, superseded or found to be invalid.

### Current roadmap interpretation

- The Node 22 → Node 26 LTS migration is completed. Node 26 is now the runtime baseline across all 15 Node-based Dockerfiles and the CI/release/reconciliation workflows. The eight backend workspaces use `better-sqlite3` 12.11.1; its Node 26 ABI prebuilds are checked by a dedicated Windows `npm ci` CI job. Treat future Node major changes as coordinated migrations, not isolated Dependabot bumps.
- Completing the Android adaptive-icon work is a bounded design-system follow-up; follow the source artwork and design-system rules rather than inventing a new icon style.
- Dependabot updates are recurring maintenance, not a one-time "first PRs" task. Review majors individually and verify native modules, build tooling, Docker images and platform compatibility.
- The HomeCore route-nesting inconsistency is non-urgent. Do not rename routes as a cosmetic cleanup: preserve existing clients and compatibility, document a migration/deprecation plan, and prove both old and new routes behave intentionally.
- HomeBridge v1 is implemented as stateless, read-only global search across enabled apps. Future bridges must be separate, narrowly scoped user journeys with explicit permissions, data flow, failure/retry behavior and opt-out semantics. The scoped background-trigger credential decision is documented in `docs/ARCHITECTURE.md` but is not implemented; use the live user's token for live requests. Do not include HomeVault in search or indexing.
- HomeVault's independent security review, HomeSync's real-device validation and minimum-hardware Argon2id benchmarks remain external validation items. AI-generated reviews are useful preparation, not substitutes for independent review or real hardware.

## 4. Plan and implement narrowly

Before editing, write down for yourself:

- the user problem and expected behavior;
- the exact services/files likely affected;
- the security, privacy, authorization and data implications;
- compatibility and migration concerns;
- the tests that will prove the behavior.

Keep one PR to one cohesive objective. Split only when changes can be independently understood and validated. Do not create a framework, abstraction, configuration layer, package or service for a hypothetical future need.

For behavior changes, add regression tests that fail before the fix. Cover success, invalid input, authorization failures, ownership boundaries, empty/missing/offline states and error handling as applicable. Prefer real service integration tests where the architecture relies on a real upstream dependency.

For database changes, use the existing migration pattern. Make migrations additive and recoverable where possible, preserve existing data, test both fresh database creation and upgrade from the prior schema, and never point tests at a real installation.

For UI changes, verify responsive layouts, keyboard/focus behavior, accessible labels/contrast, loading/empty/error states and touch targets. Use existing components/tokens and keep the HOME visual identity consistent across applications.

Do not silently introduce network calls, telemetry, third-party services, analytics or external data processors. Do not silently change data retention, sharing defaults, security boundaries or user consent.

For npm 11 lifecycle scripts, inspect the exact package/version and its install command before approving it in the root `package.json` `allowScripts` map. Prefer version-pinned approvals and the smallest allowlist possible; never use `npm approve-scripts --all` or `--dangerously-allow-all-scripts` as a blanket workaround. Re-run `npm ci` and a platform-appropriate native smoke test after changing this policy.

## 5. Verify proportionately, then run the full gate

During development, run the narrowest relevant test suite after each meaningful change. Before opening a PR, run the full checks the environment supports.

The standard local baseline is:

```bash
npm ci
npm test
npm run build --workspaces --if-present
bash gateway/test/gateway-smoke.sh
```

The gateway smoke test needs nginx, Python 3 and curl. The full-stack CI job additionally builds every Docker image, starts the stack, tests the routes and authentication through the gateway, stops an app, confirms other apps still work, and verifies the stopped app recovers without restarting the gateway.

Use Docker checks for deployment/topology changes. Do not overwrite an existing local `homecore/.env`; use throwaway test values or let CI create the disposable environment. Run `docker compose down -v` only against a disposable test stack whose volumes you created for that test.

If Android code changes, run the Android Gradle tests/build that are available and require the Android GitHub workflow to pass. A successful compile is not proof of real-device operation.

Never report "all tests pass" unless you ran them or can point to the exact successful CI run for the commit. Distinguish clearly between:
- passed locally;
- passed in GitHub Actions;
- skipped/unavailable;
- not applicable;
- failed.

If a test cannot run in the current environment, give the reason, use CI or another safe validation path, and leave the limitation visible. Do not weaken or delete a test just to make the check green.

## 6. Self-review before PR

Review the full diff against the target branch, not just the last commit.

```bash
git diff --check
git diff --stat origin/main...HEAD
git diff origin/main...HEAD
```

Look specifically for:

- accidental generated files, build output, secrets or local data;
- unrelated formatting/rewrite churn;
- API contract mismatches and unupdated callers;
- authorization/ownership checks that exist only in the frontend;
- missing validation, error handling or regression tests;
- SQLite migration/data-loss issues;
- stale documentation or incorrect changelog claims;
- dependency and lockfile drift;
- accessibility/responsive regressions;
- tests that pass only because mocks hide a broken service boundary.

Fix every issue you find before opening the PR.

## 7. PR, CI and merge

Create a short-lived branch using the naming rules in `CONTRIBUTING.md`. Use Conventional Commits, push the branch and open a PR to `main`. Use the repository PR template and include a concise, factual description of:

- the user problem and resulting behavior;
- the approach and important trade-offs;
- security/privacy/data/migration implications;
- files or services affected;
- exact tests and CI evidence;
- known limitations and follow-up work.

Do not call a PR ready while its checks are pending. Applicable required checks are:

- Repository conventions — commit, PR title and branch validation;
- CI — tests and frontend builds;
- CI — dependency audit;
- CI — real nginx gateway smoke test;
- CI — Docker image build and full-stack smoke test;
- Android build/test workflow when `apps/homesync-android/` is changed.

If a check fails, inspect its logs, reproduce the failure when practical, fix the cause and push an update. If a failure appears unrelated, verify whether the target branch has the same failure. Do not merge based on a green subset while another applicable gate is red or unknown.

After all applicable checks succeed, perform one final diff review and squash-merge your PR if GitHub permits it. Do not wait for an owner review that the project has explicitly chosen not to require, but never bypass a required human approval or branch rule. If a permission or rule blocks the merge, leave the PR verified and ready, record the blocker, and continue with independent work.

After merge, verify that `main` contains the intended squash commit and that its CI has completed successfully. Clean up only your own obsolete branch when safe.

## 8. Releases and changelog

Routine commits stay on the current release line and relevant user-facing changes go under `[Unreleased]` in `CHANGELOG.md`. Do not bump the root version because a phase, PR or refactor finished.

When a real release milestone is complete, apply SemVer from `VERSIONING.md`, prepare the root package version, root lockfile metadata and changelog section together, then follow `docs/RELEASING.md` exactly. Releases use new annotated immutable tags; never move an existing tag. Historical version corrections are closed—do not recreate the old inflated sequence.

## 9. Blockers and handoff

Do not interrupt the owner with a routine question. For an ambiguity, choose a conservative option, record the assumption and keep the implementation reversible. For a blocker outside repository control:

1. State the exact missing capability/evidence and what was attempted.
2. Do not claim the blocked work is complete.
3. Add the remaining validation to the appropriate roadmap/PR note.
4. Continue the next independent task.

End each work session with a concise factual report: completed change, PR/merge URL, tests actually run, any limitation, and the next best task. Never finish with "What should I do next?".
