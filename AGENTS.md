# Coding-agent instructions

These instructions apply to every coding agent in this repository.

## Workflow

Work autonomously on authorized repository engineering. Choose routine
implementation details without asking the owner; preserve existing work and use
a short-lived branch. Inspect remote main, open PRs/issues and CI before starting.
Check that roadmap work is still needed. Prioritize regressions, security/data
risks and broken journeys, then committed backlog, then concrete maintenance.
Speculative ideas need a use case and a short design before implementation.
Whenever roadmap work is completed, remove it or mark it crossed out in
docs/ROADMAP.md in the same PR. Split partially completed entries so only the
unfinished scope remains active. Keep completed behavior in CHANGELOG.md and
move remaining physical/review evidence gaps to Open validation.
Documentation cleanup must preserve unfinished application scope and product/design
intent. Trace removed unfinished items to implemented behavior, a retained backlog
entry or an explicit superseding decision. Shorter documentation is not a decision
to drop features; keep completed, deferred, exploratory and rejected scope distinct.

Read the relevant [architecture and product/design contracts](docs/ARCHITECTURE.md),
[security boundaries](docs/SECURITY.md), [API](docs/API.md),
[deployment](docs/DEPLOYMENT.md) and [roadmap](docs/ROADMAP.md).
[CONTRIBUTING.md](CONTRIBUTING.md) owns development, CI, commits and releases.

Source, migrations, tests and workflows establish actual behavior. The product
contract establishes intent; current guides explain controls and gaps. README
and changelog provide navigation/history. Investigate conflicts rather than
silently inventing an architecture or declaring a defect intentional.
Amend deliberate product decisions explicitly in the same PR.

Finish one coherent change: implement, update tests/docs and Unreleased, run
applicable checks with disposable data, inspect the complete diff, open a PR,
fix feedback and squash-merge once checks pass and repository rules allow it.
Use the validated Conventional Commit PR title. Never bypass protection,
fabricate review, force-push over others' work or change settings to enable merge.
If approval/permissions genuinely block merging, leave a verified merge-ready PR
and record the exact blocker. Confirm the merge and any relevant deployment;
report the outcome, PR, actual checks, limits and next useful task.

## Engineering boundaries

- Tier 1 apps own their process/database. Never read a sibling database.
  Optional cross-app behavior belongs in Bridge.
- Backends enforce identity, roles, ownership and isolation. Frontend hiding and
  manifest declarations are not authorization. Preserve shared-session and
  Vault client-encryption boundaries.
- Preserve API/data compatibility. Prefer additive, reversible migrations,
  tested on disposable databases. Update callers/contracts when APIs change.
- Reuse shared UI/assets and honor accessibility, mobile and unavailable states.
- Add dependencies only for a concrete need after checking maintenance,
  compatibility, runtime/bundle impact and existing utilities.
- Node baseline is 26 LTS across development, images and workflows.
  All eight backend workspaces use `better-sqlite3@12.11.1`.
  Runtime changes must coordinate images/workflows/docs and verify native
  prebuilds, including the Windows committed-lockfile install.
- npm 11 permits only reviewed exact-version install scripts in `allowScripts`.
  Never approve everything or use `--dangerously-allow-all-scripts`.
- Integration tests use real isolated upstream services where required.
  Never weaken CI, hide failures or claim checks that were not run.
- Run proportionate proof: conventions always apply; the tested fail-closed
  scope selector chooses affected suites/builds and platform jobs. Unknown paths
  and selection-policy changes require full checks. Full manual/weekly and
  exact-tag release gates remain. Do not start unrelated stacks/emulators for
  frontend/docs work or repeat broad checks without a reason.
- Fix failures caused by the change; investigate unexplained failures against
  the base. Review errors, migrations, dependencies, generated files, secrets and
  unintended scope before merging.
- Routine work stays under Unreleased. A phase/commit is not a release.
  Release only from validated main with synchronized root package/lock/changelog
  and a new annotated immutable tag. Never move, reuse, delete or backdate valid
  tags or recreate the historical inflated version sequence.

## Evidence and safety

Independent Vault security/cryptography review is still required before real
secrets. AI review and passing tests cannot satisfy it. HomeSync's recorded
API-34 emulator journeys do not prove physical phones, selected videos/selection
removal, Doze/reboot or six-hour delivery. Android CI intentionally runs APK/JVM
checks only, never an emulator. Hardware-specific KDF claims require actual
representative client/browser measurements. Keep these gaps visible in
[validation](docs/VALIDATION.md); improve tooling independently without inventing
evidence or blocking unrelated repository work.

Repository autonomy does not authorize real deployment or infrastructure work.
Never read, print, transmit, commit or invent secrets; modify real `.env` files;
access/mutate real HOME installations, accounts, databases or storage; delete
user data; run irreversible migrations; or clean an unknown data path.
Use disposable values/data only. Do not change repository visibility, permissions,
secrets, protections, rulesets, billing, domains, integrations or external DNS.
Do not casually publish releases, change licensing/privacy promises or introduce
a third-party data processor. Follow the documented process and explicit scope.

When hardware, external review, credentials, infrastructure or rules prevent a
step, state the exact limitation and continue independent safe work. Completion
requires implemented behavior, appropriate verification, accurate docs, self-review
and a merged PR, or a verified ready-to-merge PR with its actual blocker.
