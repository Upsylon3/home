# Decision 007: proportionate CI and artifact-only demo deployment

The owner explicitly requested fewer/heavier checks per change, no repeated Chromium installation, and no second full test run merely because a validated PR was merged.

Run affected proof on PRs with a tested, fail-closed ownership/dependency selector. Preserve full manual/weekly runs, real upstream fixtures, native Windows coverage, Docker recovery/restore checks, cryptography tests and Android emulator journeys where their inputs change. Distinguish Android fixture runtime dependencies from unrelated root dev tooling, and resource-only Android builds from runtime journeys.

Remove automatic duplicate main-push test runs. Build and browser-test the Pages artifact once on the PR; after merge, publish the retained artifact only if its checked source tree matches the merged source, its workflow succeeded and provenance/digest/static-file checks pass. Keep deployment privileged code on the trusted base branch and never execute downloaded artifacts. A newer main commit or missing/expired proof fails visibly and has an explicit manual reverify path.

This trades automatic identical post-merge reruns for scoped PR proof plus weekly full regression. Unknown changes and changes to the selector itself still run all gates. Details and the acceptance matrix are in CI_POLICY.md.
