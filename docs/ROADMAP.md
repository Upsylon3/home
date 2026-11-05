# Roadmap

Only unfinished work is listed here. Completed changes belong in
[CHANGELOG.md](../CHANGELOG.md). Later ideas are not committed features.

## Usability and reliability

- **Remote access:** improve DNS, router and HTTPS setup/diagnostics. Direct
  access cannot work through every provider's CGNAT configuration. Bundles now
  check DNS and local TLS with `diagnose`; outside reachability and hands-on
  router/provider validation remain open.
- **Backups:** add off-machine copies and coordinated cross-service snapshots.
  Existing per-database restore checks do not provide either guarantee.
- **Application installation:** replace pre-seeded registry entries with an
  install/register/enable flow. Uninstall must not silently delete data.

## Application work

- Enforce caller-application permissions before adding HomeAI or other consumers
  that need this boundary. Browser sessions currently identify users, not apps.
- Add HomeTasks assignment after defining its sharing and ownership model.
- Design signed multi-server pairing, revocation and recovery before accepting
  another HOME's accounts. Storage replication is a separate feature.

## Open validation

These are evidence gaps, not features to rebuild:

- **HomeVault:** independent security/cryptography review before real secrets
  are stored. [Review handoff](VALIDATION.md#vault-review).
- **Client performance:** validate the existing KDF on representative older
  PCs/phones when available. [Optional benchmark](VALIDATION.md#vault-performance).
- **HomeSync:** physical-phone, selected-video/selection-removal, Doze/reboot
  and long-duration backup checks. [Device checks](VALIDATION.md#homesync).
- **Installer:** hands-on Windows/macOS, reboot and real outside-access checks.
  Linux container tests do not establish those results.

## Later ideas

File versioning/encryption at rest, media poster thumbnails and duplicate
detection, shared albums, collaborative notes, cross-app exports and more
Bridge integrations need a concrete use case and design before implementation.
HomeAI must honor user permissions and never receive decrypted Vault contents.

Keep dependency updates, security fixes and failing checks ahead of new features.
