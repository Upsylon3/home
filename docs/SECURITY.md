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
- HomeNotes' Markdown preview is sanitized with `DOMPurify.sanitize()`
  (`apps/homenotes/src/markdown.js`) before it ever reaches
  `dangerouslySetInnerHTML`. Not a precaution — a real, confirmed stored
  XSS was found and fixed here during this review; see "Shared-origin
  XSS" below for why it mattered more than an ordinary XSS bug would on
  this project specifically.
- Docker builds use `npm ci` against locked dependency versions, not a
  fresh resolve, so a rebuild months later can't silently pull different
  package versions than what was tested.
- The batch-zip feature uses `yazl` (one small dependency) rather than
  a heavier alternative, specifically to avoid a larger transitive
  dependency tree.
- A moderate-severity `qs` advisory (pulled in transitively through
  every backend's `express`/`body-parser`) is patched via an `overrides`
  pin in the root `package.json`, without needing a breaking Express 5
  upgrade — see that file's own comment.

**Resolved since the last review:** every frontend's `vite` (and its
`esbuild` dependency) previously carried four dev-server-only advisories
— one high severity — tracked in this section until the `vite@8`
upgrade landed. `npm audit` reports zero vulnerabilities as of this
writing. See `CHANGELOG.md`'s `[1.1.2]` entry for the advisory IDs and
what the upgrade involved.

**Resolved since the last review, and unrelated to the above:** every
Dockerfile in this repo (all eleven — every frontend and every backend)
was pinned to `node:20-slim`. Found while checking Node-version
compatibility for the `vite@8` upgrade above, **confirmed against
Node's own release schedule, not assumed:** Node.js 20 reached
end-of-life on 2026-04-30 and has not received a security patch since
— a live gap in every service's production base image, not a
dev-only one like the `vite` advisories. Bumped to `node:22-slim`
(Maintenance LTS, security support through 2027-04-30) across all
eleven Dockerfiles and `docs/DEVELOPMENT.md`'s prerequisites. Checked
first that this doesn't newly require a `better-sqlite3` upgrade this
project can't take: the version this project's `^11.3.0` range actually
resolves to (11.10.0, confirmed directly, not just read off the
registry's "latest" dist-tag, which is a much later, unrelated 13.x
line with its own newer Node floor) declares no `engines` constraint at
all. **Not independently verified end-to-end:** the actual
`docker-compose build` couldn't be run in the environment this review
was done in (no Docker available there) — the image bump itself is
low-risk (same Debian base, same package manager, nothing else in any
Dockerfile references a Node-20-specific detail), but building and
booting the full stack once is still worth doing explicitly before this
is considered fully closed.

## What's not covered yet

- **No TLS anywhere in the request chain.** The gateway terminates plain
  HTTP only. Fine for a trusted home LAN; not fine for anything reachable
  more broadly, and a **hard blocker** for HomeVault (see below).
  **Decided approach:** a private overlay network (Tailscale or
  WireGuard) for remote access, not public exposure with a reverse-proxy
  cert — simpler to operate correctly for a self-hosted family server,
  and avoids the recurring cost of managing public certificates for
  something that was never meant to be reachable by the open internet.
  See `DEPLOYMENT.md`.
- **Permission enforcement is declarative, not enforced.** Applications
  declare intended permissions in their manifest (HomeCore's application
  registry), but no code path currently checks a permission before
  granting access to another application's resource — `HOME_MASTER_SPECIFICATION.md`
  §28 calls for four enforced authorization layers (identity, role,
  permission, ownership); layer 3 (permission) is the one not actually
  implemented yet. Ordinary ownership checks (each app checking "does
  this row belong to this user?" directly) are the only real
  enforcement today — fine for HomeCloud/HomeMedia/HomeSync/HomeNotes
  as built, but **not** something HomeVault, or any future
  security-sensitive app, should rely on as a boundary — see "sibling
  application overreach" below. **Decided:** deliberately deferred
  until HomeVault actually needs it, rather than built speculatively
  ahead of a real consumer — but it's a hard
  prerequisite for HomeVault specifically, not indefinitely optional.
- **Minor, low-severity: `/api/auth/login` reveals whether a disabled
  account exists.** An unknown username and a wrong password for a real
  account both return the same generic "Incorrect username or
  password." (good — no ordinary credential-guessing enumeration), but
  a disabled account gets its own distinct message ("This account has
  been disabled..."), which tells an attacker guessing usernames that
  one exists and is disabled. Noted during this review, not changed:
  telling a legitimate locked-out user why they can't log in is a
  reasonable trade-off, and what leaks is account existence plus
  disabled status, not credentials — low enough stakes that changing
  it wasn't treated as urgent, but worth a conscious call rather than
  an unnoticed gap.
- No email-based password reset (an admin-panel reset is the intentional
  substitute — no outgoing mail server to run).
- No account-deletion flow — only disable. See
  `ARCHITECTURE.md` §6 for the gap this leaves once one is added.
- **Every backend's `CORS_ORIGIN` defaults to `*` when unset — and
  confirmed, not assumed, during this review: `docker-compose.yml`
  never sets it for any service, so every backend actually ships with
  wide-open CORS today,** not just as a fallback for an operator who
  forgot to configure it. The practical risk is low specifically
  because this ecosystem authenticates with Bearer tokens read from
  each app's own `localStorage`, never cookies — none of the `cors()`
  calls set `credentials: true` (checked directly in each backend's
  `app.js`), and a wildcard origin plus no credentials means a
  malicious page can't get a browser to attach anything of the victim's
  to a cross-origin request in the first place; it would need the
  token already, which is exactly what "Shared-origin XSS" above is
  about, not a new exposure this adds. Still open, still worth setting
  explicitly per-service once real domains exist, rather than relying
  on this reasoning indefinitely.

## HomeVault threat model and v0 status

> **v0 is built. It has not had a real security review.** Everything
> below this callout is the design this v0 implements — the same
> architecture, unchanged. What actually exists in code:
>
> - **Verified by automated test** (`apps/homevault/test/crypto.test.js`,
>   run in complete isolation from any UI): Argon2id derivation is
>   deterministic for the same inputs and differs for a different
>   password or salt; AES-256-GCM encrypt/decrypt round-trips; a wrong
>   key or tampered ciphertext throws rather than silently returning
>   garbage; the master-password and recovery-key unwrap paths both
>   reach the same underlying vault key; a fresh random IV is used on
>   every encryption; a single mistyped character in a recovery key is
>   caught immediately via a checksum, with a distinct "you made a
>   typo" error, rather than silently producing a different, wrong
>   32-byte key.
> - **Followed exactly as designed**: client-side envelope encryption,
>   Argon2id (OWASP's current default parameters — `m=19456, t=2, p=1`,
>   stored per-vault so a future parameter change never breaks an
>   existing vault), AES-256-GCM with a per-field IV, a recovery kit
>   generated once and never stored server-side, titles encrypted (not
>   just sensitive fields), the vault key held only in memory with its
>   own shorter-than-the-session auto-lock timer.
> - **A second, more adversarial self-review pass** (not the "does the
>   code match the design doc" check above — deliberately trying to
>   find a way to break it) went through nonce/salt/IV generation, key
>   extractability choices, the verifier mechanism, and the recovery-key
>   format by hand. Found and fixed two real, minor issues: a mistyped
>   recovery-key character was silently dropped instead of flagged (see
>   the checksum bullet above), and copying the recovery key to the
>   clipboard had no auto-clear (now clears after 30s, matching
>   Bitwarden/1Password). Also confirmed, not just assumed: no
>   `Math.random()` anywhere in the security-critical path; the vault
>   key must stay extractable so it can be re-wrapped, so the
>   non-extractable wrapping-key choices provide less real protection
>   against the already-documented "Shared-origin XSS" than they might
>   look like. **This still is not the independent review below** — same
>   author reviewing their own work, just a more skeptical pass at it.
>   See `CHANGELOG.md`'s `[1.1.3]` entry for the full writeup.
> - **Explicitly NOT done**: an independent security/cryptography review
>   by anyone other than whoever wrote this. Automated tests confirm the
>   code does what it was written to do; they cannot confirm the design
>   itself has no flaw a reviewer would catch. **Do not store real
>   passwords or secrets in this v0 until that review happens.**
> - **Prerequisites below that remain genuinely open**: concrete
>   Argon2id parameters *for this specific v0* are the OWASP default,
>   not yet benchmarked against real minimum self-hosting hardware as
>   originally planned — reasonable starting point, not a completed
>   prerequisite. TLS and the shared-origin decision are settled (see
>   Part A above and "Shared-origin XSS" below) and not blockers for
>   this v0 existing, but remain blockers for exposing it beyond a
>   trusted LAN.
> - **Deferred out of v0, not forgotten**: soft-delete/undo for a
>   deleted item (currently permanent, like the vault-level delete),
>   and any HomeCore-admin-facing vault-reset action (today only the
>   account holder can delete their own vault, from Settings).

HomeVault is the ecosystem's answer to Bitwarden/1Password — holding
passwords, secure notes, TOTP secrets, recovery info, and API keys.
Every other app here (HomeCloud, HomeMedia, HomeNotes) trusts the
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
| **Shared-origin XSS** | Every app on the gateway's single origin shares one security perimeter — a stored XSS bug in *any* app can read *every* app's token out of `localStorage`, HomeVault's included, regardless of each app keeping its own key name (`home_token`, `homecloud_token`, `homemedia_token`, `homenotes_token`, `homevault_token` — see `ARCHITECTURE.md` §5; same-origin script access doesn't care that the keys differ). **Decided:** stay on the shared origin (simpler ops, one cert, consistent with every other app) rather than a separate origin just for HomeVault, on the condition that the mitigation is real, not aspirational: a strict CSP project-wide, no unsanitized `dangerouslySetInnerHTML`/`innerHTML` with untrusted content anywhere, and the decrypted vault key kept tab-lifetime-only, never in `localStorage`. **That condition was violated in practice, found, and fixed during this review:** HomeNotes' Markdown preview rendered `marked.parse()` output straight into `dangerouslySetInnerHTML` with zero sanitization — a real, confirmed path from a note's content (including pasted content, completely ordinary use of a notes app) to a script that reads every app's token, HomeVault's included. Fixed by routing through `DOMPurify.sanitize()` (`apps/homenotes/src/markdown.js`, tested in `apps/homenotes/test/markdown.test.js`); see `CHANGELOG.md`. Re-confirmed via grep that this was the *only* `dangerouslySetInnerHTML`/raw-HTML-injection site in `apps/*/src` — worth re-checking on every future app addition, not a one-time sweep. |
| **Sibling application overreach via HomeCore** | HomeCore's permission system is declarative, not enforced (see above). Encryption itself — not HomeCore's authorization layer — is what actually stops this: a fully compromised sibling app still only gets ciphertext. |
| **Malicious/compromised HomeVault backend code** | Structurally limited — the server is never sent plaintext to begin with, so there's nothing to exfiltrate unless the *client* is also compromised. |
| **HomeCore admin overreach** | An admin can disable an account or force a full vault reset (destroying the wrapped key — the user loses their own vault too), but cannot decrypt existing items. No admin-only route should ever return decrypted contents, for any reason including support requests. |
| **Lost master password** | A recovery kit — a high-entropy recovery key generated once, shown once, independently unwrapping the same vault key — is the only acceptable path. The user stores it offline; the server never sees it. Explicitly unacceptable: email reset links, security questions, or anything else that routes through something the server can see or influence. |
| **Metadata leakage** | Item count, blob size, and timestamps are unavoidably visible even with content encrypted. Acknowledge rather than hide — keep it to the structural minimum, treat size-padding as future hardening, not a v1 blocker. |
| **Standing decrypted key in memory** | Vault "unlock" is a separate, shorter-lived state than the HomeCore session — the derived master key lives only in page memory, with its own auto-lock timer independent of how long the HomeCore session has left. Implemented in `apps/homevault/src/vaultContext.jsx`: 5-minute inactivity timeout, never `localStorage`/`sessionStorage`. |
| **Multi-device sync UX** | Not a threat, a design consequence worth documenting: a new device syncs the *encrypted* vault immediately but needs the master password re-entered before anything is readable. Correct behavior, not friction to fix. |

### Prerequisites before HomeVault v0 handles anything real

In priority order:
1. **An independent security/cryptography review of the actual v0 code**
   (not just this design document) — nothing below matters if the
   implementation itself has a flaw a reviewer would catch that
   automated tests, by construction, cannot. See the v0 status callout
   at the top of this section for exactly what's been verified so far
   and what hasn't.
2. **TLS for anything beyond a trusted LAN** — the single largest gap
   between "sound on paper" and "safe to actually use" once real secrets
   are involved. (Decided: a private overlay network, not a public
   reverse-proxy cert — see Part A above.) Not a blocker for local,
   LAN-only use during review.
3. **Argon2id parameters benchmarked against real minimum self-hosting
   hardware.** v0 ships OWASP's current default (`m=19456, t=2, p=1`) as
   a reasonable starting point, not a completed prerequisite — see the
   v0 status callout.

The shared-vs-separate-origin decision, and the recovery-kit UX, are
both settled and implemented (see the v0 status callout above) — no
longer blocking prerequisites.

## Reporting a vulnerability

Don't open a public issue. See `CONTRIBUTING.md` for how to report
privately.
