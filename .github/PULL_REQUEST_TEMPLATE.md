## Summary

<!-- What changes for the user? -->

## Why

<!-- Link the issue or roadmap item. Explain why this belongs in HOME. -->

## Implementation

<!-- Describe the approach and important trade-offs. -->

## Safety and compatibility

- Security/privacy impact:
- Data/schema/migration impact:
- API/deployment compatibility:
- Reversibility/rollback:

## Verification

- [ ] Relevant focused tests run
- [ ] `npm test`
- [ ] `npm run build --workspaces --if-present` (or explain why not applicable)
- [ ] Windows committed-lockfile install and native SQLite smoke test
- [ ] `bash gateway/test/gateway-smoke.sh` (or explain why not applicable)
- [ ] Docker/full-stack CI checked where applicable
- [ ] Android workflow checked if Android code changed
- [ ] All applicable GitHub checks are green

Exact commands and results:

## Documentation and release

- [ ] Relevant docs updated
- [ ] `CHANGELOG.md` updated under `[Unreleased]` for user-visible changes
- [ ] No version bump made unless this is a deliberate release

## Agent self-review

- [ ] Reviewed the complete diff against `main`
- [ ] Checked for unrelated changes, secrets and generated artifacts
- [ ] Checked authorization, ownership and error paths
- [ ] Confirmed no known unresolved critical issue remains
