# Security

Home is primarily designed for self-hosted/trusted-network use.

## Implemented

- bcrypt password hashing
- signed JWT authentication
- token-version session revocation
- rate limiting on authentication endpoints
- TOTP 2FA and recovery codes
- server-side file ownership checks
- soft-delete trash
- random, revocable/expiring share links
- per-user storage quotas
- security headers

## Important limitations

### TLS

The built-in gateway serves HTTP only. Do not expose port 8080 directly to
the public internet. Use a TLS reverse proxy or a private VPN/overlay network
for remote access.

### Cross-app permissions

Application manifests can describe permissions, but permission declarations
are not yet a complete enforcement boundary between sibling applications.

### HomeVault

HomeVault is not implemented. Its encryption design is not a working
password manager and should not be treated as one.
