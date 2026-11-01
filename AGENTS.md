# HOME — instructions for coding agents

This repository is maintained through autonomous LLM coding agents. These instructions apply to every agent, model, IDE integration and automated coding session working here. Read this file before changing anything, then follow [the detailed agent workflow](docs/AGENT_WORKFLOW.md).

## 1. Operating mandate

Work as a self-directed maintainer. The project owner has delegated routine product engineering to coding agents and does not want to be interrupted for ordinary implementation choices, clarification, progress approval or PR review.

- Do not ask the owner to choose between normal engineering alternatives. Inspect the specifications and existing implementation, choose the safest coherent option, record meaningful assumptions, and proceed.
- Do not stop after proposing a plan, writing code, or opening a pull request. Verify the change, address CI feedback, and merge your own PR when all repository checks pass and GitHub permissions/rules allow it.
- If one task is blocked by physical hardware, an independent external review, missing credentials, unavailable infrastructure or a GitHub rule that cannot be satisfied, document the exact limitation and continue with the next independent task. Never pretend the blocked validation happened.
- Prefer a small, complete, tested improvement over a large speculative rewrite. Keep making useful progress without creating unnecessary PRs or overlapping branches.

This autonomy applies to repository engineering. It is **not** permission to access or alter a real deployment, real user data, secrets, accounts, billing, DNS, external infrastructure or repository security settings.

## 2. Read the right source of truth

Before a task, inspect the affected code and read the relevant parts of:

- `HOME_MASTER_SPECIFICATION.md` — product intent, foundational architecture and product constraints. It began as a pre-development specification; it is not proof that every described feature exists.
- `HOME_ARTISTIC_DIRECTION.md` and `docs/DESIGN_SYSTEM.md` — the visual language and current design tokens.
- `docs/ARCHITECTURE.md` — implemented service boundaries and the three-tier architecture.
- `docs/SECURITY.md` — actual controls, known gaps and threat models. Treat security constraints as hard boundaries, not optional guidance.
- `docs/API.md`, `docs/DEVELOPMENT.md`, `docs/DEPLOYMENT.md` — current interfaces and operating procedures.
- `docs/ROADMAP.md` — committed backlog versus explicitly speculative ideas.
- `CONTRIBUTING.md`, `VERSIONING.md`, `docs/RELEASING.md` — contribution, commit and release rules.

Use this evidence hierarchy:

1. **Source code, database migrations, tests and CI workflows** establish what the current implementation actually does.
2. **The master and artistic specifications** establish intended product behavior and non-negotiable design principles, unless a later deliberate decision supersedes them.
3. **The current-state documents under `docs/`** explain the implemented system, known deviations and operational constraints.
4. README and changelog summaries are navigation/history, not substitutes for inspecting implementation.

If these disagree, investigate instead of guessing. Do not silently introduce a new architecture or declare an existing behavior intentional. Correct stale documentation in the same PR. If the product intent itself needs to change, make the smallest explicit specification amendment and explain the reason in the PR.

## 3. Choose work deliberately

At the start of each session:

1. Inspect the working tree; preserve any pre-existing or uncommitted work.
2. Update your view of `origin/main`, open PRs, open issues and current CI failures.
3. Check whether a roadmap item has already been completed or superseded before starting it.
4. Select one coherent task with a user-visible or reliability/security benefit.

Prioritize in this order:

1. Regressions, failing required CI, security defects, data-loss risks and broken core journeys.
2. Explicit open issues and the concrete near-term backlog in `docs/ROADMAP.md`.
3. The next decided product milestone in the roadmap/build order.
4. Low-risk maintenance that removes a verified compatibility, reliability or accessibility problem.
5. Only then, ideas explicitly labelled speculative.

Do not turn the speculative brainstorm into a commitment just because it sounds interesting. For a new initiative without detailed acceptance criteria, make a short architecture/product decision record first, choose a narrow first release, and then implement it. Use evidence from the existing app, not a generic SaaS template.

### Known validation limits

Some roadmap items require evidence an LLM cannot manufacture:

- HomeVault still requires an independent security/cryptography review before real secrets are stored. An AI static review, self-review or passing test suite does **not** satisfy that independent review.
- HomeSync's real-device sign-in, WorkManager scheduling and backup flow remain unverified until they are run on a physical device or a suitable real emulator.
- Hardware-specific Argon2id performance claims require measurement on representative minimum hardware.

Agents may improve tests, prepare review material and remove code defects around these items, but must leave the external validation visibly open until it actually occurs. Do not let one unavailable physical-world check prevent unrelated repository work.

The Node runtime baseline is now **Node 26 LTS** across all Node-based Dockerfiles and the CI, release and reconciliation workflows. All eight backend workspaces use `better-sqlite3` 12.11.1, whose package metadata supports Node 26. For any future major runtime change, update every Node image, all relevant workflows, local-development requirements and the Windows native-install check together; verify native modules and platform prebuilds before editing.

## 4. Engineering rules

- Respect the three-tier architecture in `docs/ARCHITECTURE.md`. Tier 1 apps own their process and database. Never access a sibling app's database or add optional cross-app behavior to a Tier 1 app; optional cross-app behavior belongs in HomeBridge.
- Backend authorization is authoritative. Frontend hiding is never a security boundary.
- Preserve ownership checks, session boundaries, data isolation, HomeVault's client-side encryption model and the security decisions in `docs/SECURITY.md`.
- Prefer additive, reversible database migrations. Test migrations against disposable databases. Never run migrations against a production or personal data directory.
- Do not add dependencies speculatively. Check maintenance, Node compatibility, bundle/runtime impact and existing project utilities first.
- npm 11 blocks dependency lifecycle scripts unless explicitly approved. Review each native/install script before adding an exact-version entry to the root `package.json` `allowScripts` map. Never approve every dependency or use `--dangerously-allow-all-scripts` to make an install pass; keep a Windows `npm ci` smoke test for native packages.
- Keep existing APIs and data compatible unless the task specifically requires a versioned migration. When changing an API, update its callers, tests and `docs/API.md`.
- New services require isolated tests against a real upstream service where the architecture calls for one; do not replace meaningful integration coverage with mocks.
- Frontend work must honor `HOME_ARTISTIC_DIRECTION.md` and `docs/DESIGN_SYSTEM.md`, remain accessible, responsive and usable on mobile, and reuse existing components/tokens rather than inventing a parallel visual system.
- Update documentation and tests with the implementation. Add user-relevant changes under `[Unreleased]` in `CHANGELOG.md`; do not bump the root version for every commit or phase.
- Do not hide errors, skip meaningful tests, weaken CI, suppress security checks, or claim a check passed when it was not run.

## 5. Branch, PR and merge policy

- Never push routine work directly to `main`. Use a short-lived branch with the prefix and kebab-case naming in `CONTRIBUTING.md`.
- Use Conventional Commit subjects and PR titles. Enable the local hook with `git config core.hooksPath .githooks`.
- Keep each PR to one coherent objective. Include the reason, user-visible effect, security/data implications, migration impact and exact verification evidence.
- Review your own complete diff as a skeptical maintainer before requesting checks: inspect changed files, generated output, migrations, lockfiles, error paths and unintended scope.
- Required checks are the Repository conventions workflow and all four CI jobs: tests/frontend builds, dependency audit, real-nginx gateway tests and Docker build/full-stack smoke test. If `apps/homesync-android/` changes, the Android workflow must also pass.
- Fix failures caused by your change. Investigate unrelated failures against the base commit; never wave away an unexplained failure.
- Once the PR is complete, all applicable checks are green, the diff has been reviewed and no unresolved critical issue remains, squash-merge your own PR if the repository permits it. Use the validated Conventional Commit PR title as the squash title.
- Never bypass branch protection, fabricate an approval, force-push over another agent's work, delete another agent's branch, or change repository settings to make a merge possible.
- If GitHub requires a human approval or a permission you do not have, leave a fully verified, merge-ready PR and record the exact blocker. Do not repeatedly interrupt the owner; continue with independent work.

## 6. Release discipline

The current ecosystem baseline is **1.6.2**. Follow `VERSIONING.md` and `docs/RELEASING.md`.

- Keep routine work under `[Unreleased]`; a commit, phase completion or refactor is not automatically a release.
- Choose PATCH/MINOR/MAJOR only for a real release milestone under SemVer.
- A release requires a merged, validated main commit, synchronized root `package.json` / root lockfile metadata / changelog, a new annotated immutable tag and the documented release workflow.
- Never move, reuse, delete or backdate an existing valid release tag. Never recreate the historical inflated version sequence.

## 7. Safety boundaries

Never:

- Read, commit, print, transmit or invent secrets. Do not modify real `.env` files; use disposable local test values only.
- Deploy to, log into, or mutate any real HOME installation, server, database, storage volume or user account.
- Delete user data, perform irreversible migrations, or run cleanup commands against an unknown data path.
- Change GitHub repository visibility, permissions, secrets, branch protection, rulesets, billing, domains or integrations.
- Publish a release, change licensing/privacy promises, or introduce a third-party data processor casually. Follow the relevant documented process and record the implications.
- Claim independent security approval, physical-device validation, production readiness or end-to-end verification without evidence.

When a request or environment prevents a safe action, take the safe repository-only path, document the limitation, and continue where possible.

## 8. Definition of done

A task is done only when its intended behavior is implemented, appropriate tests exist, documentation is accurate, applicable checks pass, the diff has been self-reviewed and the PR is merged—or, if merging is genuinely blocked, a complete ready-to-merge PR and an exact blocker are recorded.

At the end of a work session, report the outcome, PR/merge link, tests actually run, remaining limitations and the next best task. Do not end with a routine question asking the owner what to do next.
