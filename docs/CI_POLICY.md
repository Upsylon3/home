# CI policy: focused PR proof, build once and publish

Local commits run only the existing fast commit-message check. GitHub checks pull requests as they change; merges do not repeat the same Node/Docker/Android suites. A weekly Sunday full run and each workflow's **Run workflow** button retain broad regression and dependency coverage. Release candidates still require the full manual gate documented in RELEASING.md.

`ci-scope.py` selects work by ownership and dependency impact. Its tests run before CI/Android selection, and unknown paths or selector/CI-policy edits fall back to full coverage. A failed/missing selector also cannot silently skip checks. Stable job names remain present as intentionally skipped when irrelevant.

| Change | Normal PR proof |
|---|---|
| Markdown | Conventions and lightweight selection only |
| Demo code/workflow | Demo contract tests, seven static app builds and real browser journeys using installed Chrome |
| One web frontend | That frontend's tests/build, plus the browser demo; no Docker, Windows native build or Android |
| Shared design assets | Frontend tests/builds and browser demo |
| One backend | Its suite plus real dependent-service suites, Docker integration; Cloud/Media additionally exercise Windows file lifecycle |
| Gateway/Compose/backup | Relevant gateway, Docker and backup proof |
| Root dev tooling/scripts | Frontend/demo checks as relevant and dependency audit; no Android fixture/emulator just for Playwright |
| Runtime dependency/native/runtime-policy changes | Expanded Node/stack proof; Android only if its actual fixture dependencies/runtime policy changed |
| Android presentation resources | APK build and JVM tests; no emulator |
| Android runtime, permissions, WorkManager, upstream Core/Cloud/Sync/client | Build/JVM tests and the existing real emulator backup/permission journeys |
| Unknown path, selection policy, manual/weekly run | Full regression |

Test-only edits run their owner suite without starting a server stack or emulator. Android network/security XML and raw resources retain runtime validation.

The selector resolves the Android fixtures' production, optional and peer dependency closure through the committed npm lockfile, including nested packages and workspace links. A transitive native/auth dependency update therefore still exercises the emulator. Changes to a frontend-only/dev package do not.

Frontend-only jobs install with `--ignore-scripts`; native-backend tests keep the real approved installation. Audit reads the committed dependency graph without another native installation. Existing security, ownership, migration, cryptography, gateway, backup and emulator tests are retained; their relevant paths still select them. Recurrence of hardware/independent-review limits is unchanged.

## Pages: reuse the verified build

The Browser demo PR workflow builds and tests once, then retains static files and source-tree/run metadata for 14 days. Deploy browser demo runs on a merged PR affecting the site (or explicitly on main) and downloads that exact immutable artifact. It verifies successful run/head/attempt, expiration, merged source-tree equality, repository path, index presence and absence of links/special files. GitHub's download action fails on a digest mismatch. Only then is the static site uploaded to Pages. Deployment runs no npm install, build, browser or Android tests.

The privileged closed-PR workflow uses the trusted base-branch definition and checks out only the merged main commit. It never executes PR-head code or downloaded files. Old deployments cannot replace a newer main commit. If main advanced after verification, or artifacts expired, run Browser demo on current main and then Deploy browser demo; a mismatched build is never silently published.

To run the new policy proof locally:

```sh
python -m unittest discover -s scripts/test -p 'test_ci_*.py'
node --test scripts/test/demo-artifact.test.mjs
python scripts/ci-scope.py --base origin/main --head HEAD --event pull_request
```

Scope selection is not a security/authorization boundary: the existing repository rules and PR review/merge policy still govern changes. No branch protection, permissions, repository secrets or billing settings are changed.
