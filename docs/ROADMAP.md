# Roadmap

Only unfinished work is listed here. Completed changes belong in
[CHANGELOG.md](../CHANGELOG.md). Later ideas are not committed features.

## Application work

- Implement the signed two-owner handshake, replay ledger, live peer status and
  protected HTTPS transport from the [pairing design](PAIRING-DESIGN.md).
  Offline identities and pending/suspended/revoked peer records are implemented;
  staging a descriptor does not authenticate or activate a peer.
- Add typed guest authentication and explicit Tasks resource grants only after
  pairing works. Complete source/runtime restore integration, isolated guest
  origins, two-server drills and independent protocol review before enablement.
  Storage replication remains a separate design.

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
- **Off-machine backups:** physical NAS/removable-storage and recovery checks.
  [Export validation](VALIDATION.md#backup-exports).

## Later ideas

File versioning/encryption at rest, media poster thumbnails and duplicate
detection, shared albums, collaborative notes, cross-app exports and more
Bridge integrations need a concrete use case and design before implementation.
HomeAI must honor user permissions and never receive decrypted Vault contents.

Keep dependency updates, security fixes and failing checks ahead of new features.
