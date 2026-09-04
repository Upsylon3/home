# Security

Two parts: what's actually protecting the app today, and HomeVault's
threat model — a design document with no implementation yet.

## Part A — implemented today

- Passwords hashed with **bcrypt** (12 rounds); never stored plain.
- **JWT** auth with a per-user **token version** for instant revocation
  (password change, "sign out everywhere," admin-disable all take effect
  immediately, not on next expiry).
- Auth-adjacent routes (login, register, password change, 2FA
  setup/disable) **rate-limited** — 10 attempts / 15 minutes / IP.
- Security headers via `helmet` on every response.
- **TOTP 2FA**, with one-time recovery codes and an admin override for a
  lost phone. The intermediate "pending" token (issued after a correct
  password, before a 2FA code) is explicitly refused by the main auth
  middleware everywhere except the route that completes 2FA login.
  Resetting 2FA on an account that already has it enabled requires the
  current password, so a stolen session token alone can't silently strip
  it.
- **Share links** (`apps/homecloud-backend/src/publicShare.js`) use a
  192-bit random token, rate-limited separately from login (60 / 15
  minutes / IP), and stop working the instant the underlying file is
  trashed.
- Per-file upload cap (1 GB) and per-user quota (default 5 GB,
  admin-overridable).
- File/folder/note ownership enforced server-side on every route —
  never a frontend check.
- Docker builds use `npm ci` against locked dependency versions, not a
  fresh resolve, so a rebuild months later can't silently pull different
  package versions than what was tested.
- The batch-zip feature uses `yazl` (one small dependency) rather than
  a heavier alternative, specifically to avoid a larger transitive
  dependency tree.

## What's not covered yet

- **No TLS anywhere in the request chain.** The gateway terminates plain
  HTTP only. Fine for a trusted home LAN; not fine for anything reachable
  more broadly, and a **hard blocker** for HomeVault (see below). If
  exposing this beyond a home LAN, put it behind a reverse proxy with
  real TLS (Caddy/Traefik + Let's Encrypt), or use a private overlay
  network (Tailscale/WireGuard) instead of public exposure — see
  `DEPLOYMENT.md`.
- **Permission enforcement is declarative, not enforced.** Applications
  declare intended permissions in their manifest (HomeCore's application
  registry), but no code path currently checks a permission before
  granting access to another application's resource. Ordinary
  ownership checks (each app checking "does this row belong to this
  user?" directly) are the only real enforcement today — fine for
  HomeCloud/HomeMedia/HomeSync/HomeNotes as built, but **not** something
  HomeVault, or any future security-sensitive app, should rely on as a
  boundary — see "sibling application overreach" below.
- No email-based password reset (an admin-panel reset is the intentional
  substitute — no outgoing mail server to run).
- No account-deletion flow — only disable. See
  `ARCHITECTURE.md` §6 for the gap this leaves once one is added.

## HomeVault threat model (design only, not built)

HomeVault is meant to be the ecosystem's answer to Bitwarden/1Password —
holding passwords, secure notes, TOTP secrets, recovery info, and API
keys. Every other app here (HomeCloud, HomeMedia, HomeNotes) trusts the
server with plaintext, because a file server that can't read files can't
serve thumbnails. HomeVault's whole design problem is the opposite: **the
server should be useful without ever being trusted with plaintext.**

### Goals, in priority order

1. **Confidentiality from the server** — an admin, a bug, a full DB
   dump, or a compromised container should never yield readable vault
   contents.
2. **Confidentiality from other Home users**, including a HomeCore admin.
3. **Integrity** — tampering must be detectable, never silently decrypted
   into garbage (or worse, attacker-chosen data).
4. **Availability** matching the rest of the ecosystem's degrade-gracefully
   pattern.
5. **Recoverability that doesn't undermine goal 1** — a forgotten master
   password is common; the recovery path can't quietly become a
   server-side skeleton key.

**Explicitly out of scope:** a fully compromised client device
(keyloggers, malicious extensions), physical access to an
already-unlocked session (mitigated by auto-lock, not eliminated),
post-quantum crypto, and HomeAI ever reading vault contents (see
`ROADMAP.md`).

### Architecture: client-side envelope encryption

The same well-understood pattern Bitwarden/1Password use — not a novel
scheme (novel cryptography is itself a threat):

```
Master password
      │  Argon2id (memory-hard KDF, client-side)
      ▼
Master key        (never leaves the device, never stored anywhere)
      │  wraps / unwraps
      ▼
Vault key          (random 256-bit, generated once at vault creation)
      │  encrypts, unique nonce per item
      ▼
Individual items   (passwords, notes, TOTP secrets, ...)
```

The server stores only the **wrapped vault key** and the **encrypted
items** — neither useful without the master password, which the server
never sees. Wrapping (rather than encrypting every item directly from
the master password) is why changing the master password is a cheap
re-wrap, not an O(n) re-encryption of the whole vault.

- **Argon2id**, not PBKDF2/bcrypt — memory-hard, because the realistic
  attack is offline brute-force against a stolen dump, not online
  guessing (already rate-limited at the login layer). Parameters need
  tuning against real self-host hardware (could be a Raspberry Pi);
  target OWASP's current guidance as a floor, derived client-side so
  weak server hardware never pressures parameters downward.
- **AES-256-GCM or XChaCha20-Poly1305**, unique nonce per item — reusing
  a nonce with the same key is the one classical mistake that fully
  breaks AEAD.
- **Item titles are encrypted too**, not just sensitive fields — a
  deliberate tradeoff: search/sort become client-side only (fine at
  personal-vault scale), but it closes a real gap (plaintext titles like
  "Bank of America" leak a lot to a database-dump attacker without ever
  breaking the encryption).

### Threat catalog (condensed)

| Threat | Mitigation |
|---|---|
| **Server/DB compromise** | Everything stored is ciphertext + minimal metadata — the core promise the whole design exists for, including making a leaked backup harmless as long as Argon2id parameters resist offline attack. |
| **Network interception** | Blocking prerequisite: the gateway has no TLS yet. Not shippable for a password manager without it, even on a "trusted" home LAN. |
| **Shared-origin XSS** | The gateway's SSO design means every app on the origin shares one security perimeter — a stored XSS bug in *any* app can read the shared session token. Mitigation: a strict CSP project-wide, no `dangerouslySetInnerHTML`/`innerHTML` with untrusted content anywhere, and the decrypted vault key kept tab-lifetime-only, never in `localStorage`. Worth an explicit decision before implementation: shared origin (with that CSP hardening) vs. a deliberately separate origin just for HomeVault. |
| **Sibling application overreach via HomeCore** | HomeCore's permission system is declarative, not enforced (see above). Encryption itself — not HomeCore's authorization layer — is what actually stops this: a fully compromised sibling app still only gets ciphertext. |
| **Malicious/compromised HomeVault backend code** | Structurally limited — the server is never sent plaintext to begin with, so there's nothing to exfiltrate unless the *client* is also compromised. |
| **HomeCore admin overreach** | An admin can disable an account or force a full vault reset (destroying the wrapped key — the user loses their own vault too), but cannot decrypt existing items. No admin-only route should ever return decrypted contents, for any reason including support requests. |
| **Lost master password** | A recovery kit — a high-entropy recovery key generated once, shown once, independently unwrapping the same vault key — is the only acceptable path. The user stores it offline; the server never sees it. Explicitly unacceptable: email reset links, security questions, or anything else that routes through something the server can see or influence. |
| **Metadata leakage** | Item count, blob size, and timestamps are unavoidably visible even with content encrypted. Acknowledge rather than hide — keep it to the structural minimum, treat size-padding as future hardening, not a v1 blocker. |
| **Standing decrypted key in memory** | Vault "unlock" is a separate, shorter-lived state than the HomeCore session — the derived master key lives only in page memory, with its own auto-lock timer independent of how long the HomeCore session has left. |
| **Multi-device sync UX** | Not a threat, a design consequence worth documenting: a new device syncs the *encrypted* vault immediately but needs the master password re-entered before anything is readable. Correct behavior, not friction to fix. |

### Prerequisites before any HomeVault code is written

In priority order:
1. **TLS at the gateway** — the single largest gap between "sound on
   paper" and "safe to actually use."
2. **A decision** on shared-origin-with-CSP vs. deliberately separate
   origin (see "Shared-origin XSS" above).
3. **Concrete Argon2id parameters**, benchmarked against realistic
   minimum self-hosting hardware.
4. **A designed recovery-kit UX**, reviewed before the first vault is
   ever created — it can't be retrofitted onto existing vaults without
   asking every user to re-derive and re-wrap their key.

None of these are done yet.

## Reporting a vulnerability

Don't open a public issue. See `CONTRIBUTING.md` for how to report
privately.
