# Contributing

See [DEVELOPMENT.md](docs/DEVELOPMENT.md) for setup and tests. Coding agents
must follow [AGENTS.md](AGENTS.md).

## Changes

- Inspect the source and relevant product, architecture and security rules.
  Explain deliberate changes to those rules.
- Keep PRs focused. Preserve ownership, data and API compatibility; use additive
  migrations and disposable test databases.
- Add dependencies only for a concrete need. Use real upstream services in
  integration tests where the architecture requires them.
- Update relevant docs and `[Unreleased]`. Follow the shared design system.
- Run [applicable checks](docs/CI_POLICY.md), review the diff and fix failures.
  Never claim tests or device validation that did not happen.

## Branches and commits

Use `feat/`, `fix/`, `docs/`, `chore/`, `refactor/`, `test/`, `ci/`, `build/`
or `perf/` followed by a short kebab-case name. Dependabot branches are exempt.
Use Conventional Commit subjects and PR titles:

~~~text
feat(homecloud): add expiring share links
fix(homecore): reject revoked sessions
docs: simplify deployment instructions
~~~

Allowed types: `feat`, `fix`, `docs`, `refactor`, `test`, `ci`, `build`,
`perf`, `chore`, `revert`. Use lowercase type/scope, an imperative summary,
no trailing period, and `!`/`BREAKING CHANGE:` for incompatible changes.

Enable the local hook: `git config core.hooksPath .githooks`. Open PRs to
`main`; do not push routine work directly. Wait for applicable checks, then
squash-merge using the validated PR title. Respect protection rules.
See [versioning](VERSIONING.md) and [releasing](docs/RELEASING.md).

## Security reports

Contact the maintainer privately through an available private GitHub channel.
Do not post credentials, personal data or exploit details in a public issue.
Known limitations are in [SECURITY.md](docs/SECURITY.md).
