# What changed in this patch

Five files, patched against the **gateway-restored** branch so the setup
scripts from the sister branch actually match the current single-port
gateway topology instead of the old four-port one (`8080`–`8083`).

Drop these five files into your `gateway-restored` checkout at the repo
root, overwriting what's there (`docker-compose.yml` and `.gitignore`
already exist there; `setup.sh`, `setup.ps1`, and `.env.example` are new
to that branch).

## 1. `docker-compose.yml`

The `backend` service's three app-registry URLs
(`HOMECLOUD_FRONTEND_URL`, `HOMEMEDIA_FRONTEND_URL`, `HOMESYNC_INFO_URL`)
were hardcoded to `http://localhost:8080/...`. That's a real bug, not
just a missing nicety: Home's dashboard "Launch" links use these values,
and "localhost" from a phone or another PC on the network means *that
device*, not your server — so the Launch cards would silently point
nowhere useful from anything but the server itself.

Restored the `${LAN_IP:-localhost}` templating the pre-gateway branch
had, adapted for one port instead of three:

```diff
- HOMECLOUD_FRONTEND_URL=http://localhost:8080/cloud
- HOMEMEDIA_FRONTEND_URL=http://localhost:8080/media
- HOMESYNC_INFO_URL=http://localhost:8080/sync
+ HOMECLOUD_FRONTEND_URL=http://${LAN_IP:-localhost}:8080/cloud
+ HOMEMEDIA_FRONTEND_URL=http://${LAN_IP:-localhost}:8080/media
+ HOMESYNC_INFO_URL=http://${LAN_IP:-localhost}:8080/sync
```

Direct browser navigation to `http://<LAN-IP>:8080/...` always worked
fine — this only fixes the dashboard's own stored links.

## 2. `.env.example` (new, repo root)

Root-level template `docker-compose.yml` now reads via `${LAN_IP}`.
Same purpose as the sister branch's version, rewritten for one port
(`8080`) instead of three (`8080`/`8082`/`8083`). Copy to `.env`, or let
`setup.sh`/`setup.ps1` write it for you.

## 3. `.gitignore`

Added `.env` (the new root-level one from #2) to the ignore list —
matches the sister branch's `.gitignore`, which already had it.

## 4. `setup.sh` / `setup.ps1`

Everything except the final printed summary was already correct — secret
generation, LAN IP detection, `.env` writing, Docker checks, and
build/start all still apply unchanged now that `docker-compose.yml`
(patched above) consumes `LAN_IP` again. Fixed:

- Final "Open it" URL list: was `8081` (Home) / `8080` (HomeCloud) /
  `8082` (HomeMedia) / `8083` (HomeSync) as four separate addresses. Now
  `8080` for everything, with `/cloud`, `/media`, `/sync` paths.
- Doc pointer: `SETUP_GUIDE.md` → `docs/SETUP.md` (the consolidated
  setup doc — see the `docs/` folder delivered alongside this).
- Top-of-file comments updated to describe the current, single-port
  behavior instead of implying four ports still exist.

No behavioral changes beyond the above — same flags (`--yes`/`-Yes`,
`--no-start`/`-NoStart`), same JWT-secret and LAN-IP detection logic,
same Docker checks.

## 5. `setup.ps1` — PowerShell 7.3+ crash on `docker info` check

**Found from a real run**, not just inspection: on PowerShell 7.3+,
`$PSNativeCommandUseErrorActionPreference` (on by default) makes *any*
non-zero exit code from an external program throw a terminating error
under `$ErrorActionPreference = "Stop"` — even with output redirected to
`$null`. That broke the intended behavior of every `docker ...`/
`$LASTEXITCODE` check in the script: instead of "Docker isn't running,
start it and press Enter," a non-zero exit from `docker info` (Docker
Desktop not running yet — the ordinary case on a fresh machine) crashed
the whole script with a raw native-command stack trace.

Fixed by disabling that specific behavior right after `$ErrorActionPreference`
is set (guarded with `Test-Path` so it's a no-op on Windows PowerShell
5.1, which doesn't have this variable at all):

```powershell
if (Test-Path variable:global:PSNativeCommandUseErrorActionPreference) {
  $PSNativeCommandUseErrorActionPreference = $false
}
```

`$ErrorActionPreference = "Stop"` still applies to everything else in the
script (real cmdlet errors still stop it) — this only stops external-tool
exit codes from being auto-promoted into exceptions, restoring the
script's own explicit `$LASTEXITCODE` handling.

## Not changed

`backend/src/homecore/seed.js` needed no edit — it already reads
`process.env.HOMECLOUD_FRONTEND_URL` etc. with a
`http://localhost:8080/...`-style fallback, which still makes sense as
the *default* when `LAN_IP` is unset (i.e. the server accessing its own
dashboard).
