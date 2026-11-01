#!/usr/bin/env bash
# Tests gateway/nginx.conf for real: runs it in a real nginx, with fake apps
# that come and go, and checks what a browser would see.
#
#   bash gateway/test/gateway-smoke.sh
#
# Needs: nginx, python3, curl. No Docker. It rewrites three things in a COPY of
# the config so it can run on a plain machine: the DNS server (a fake one we
# control, instead of Docker's), the listen port, and the port-80 frontends
# (moved to :8000 so no root is needed). Everything else is the real file.
set -u

HERE="$(cd "$(dirname "$0")" && pwd)"
CONF_SRC="$HERE/../nginx.conf"
WORK="$(mktemp -d)"
GW=18089        # where the test gateway listens
DNS=15353       # where the fake DNS server listens
RECORDS="$WORK/records"
: > "$RECORDS"
PASS=0
FAIL=0

for tool in nginx python3 curl; do
  command -v "$tool" >/dev/null || { echo "SKIP: '$tool' is not installed"; exit 0; }
done

cleanup() {
  [ -f "$WORK/nginx.pid" ] && kill "$(cat "$WORK/nginx.pid")" 2>/dev/null
  for f in "$WORK"/*.pid; do [ -f "$f" ] && kill "$(cat "$f")" 2>/dev/null; done
  rm -rf "$WORK"
}
trap cleanup EXIT

# ---- the fake network: every app name gets its own loopback address ----
declare -A IP PORT_OF
n=0
for entry in home:8000 homecloud:8000 homemedia:8000 homenotes:8000 hometasks:8000 homemonitor:8000 homevault:8000 \
             homecore:4000 homemedia-backend:4200 homesync-backend:4300 homenotes-backend:4400 \
             homecloud-backend:4500 homevault-backend:4600 hometasks-backend:4700 homemonitor-backend:4800 homebridge:4900; do
  n=$((n + 1))
  IP[${entry%%:*}]="127.0.1.$n"
  PORT_OF[${entry%%:*}]="${entry##*:}"
done

# Start a fake app: it gets a DNS name AND a listening server.
app_up() {
  local name="$1"
  python3 "$HERE/fake-app.py" "$name" "${IP[$name]}" "${PORT_OF[$name]}" &
  echo $! > "$WORK/app-$name.pid"
  grep -q "^$name " "$RECORDS" || echo "$name ${IP[$name]}" >> "$RECORDS"
}
# Remove an app completely: it stops answering AND its name disappears
# (what a stopped Docker container looks like).
app_gone() {
  local name="$1"
  [ -f "$WORK/app-$name.pid" ] && kill "$(cat "$WORK/app-$name.pid")" 2>/dev/null && rm -f "$WORK/app-$name.pid"
  sed -i "/^$name /d" "$RECORDS"
}
# Kill only the process but leave its name in DNS (a crashed app: the name
# still resolves, but the connection is refused).
app_crashed() {
  local name="$1"
  [ -f "$WORK/app-$name.pid" ] && kill "$(cat "$WORK/app-$name.pid")" 2>/dev/null && rm -f "$WORK/app-$name.pid"
}

# ---- a test copy of the real config ----
python3 - "$CONF_SRC" "$WORK" "$DNS" "$GW" "$(id -u)" <<'PY'
import re, sys
src, work, dns, gw, uid = sys.argv[1:6]
s = open(src).read()
# Docker's DNS -> our fake one; short cache so changes show up in a second.
assert "resolver 127.0.0.11 valid=10s ipv6=off;" in s
s = s.replace("resolver 127.0.0.11 valid=10s ipv6=off;", f"resolver 127.0.0.1:{dns} valid=1s ipv6=off;")
assert "listen 80;" in s
s = s.replace("listen 80;", f"listen 127.0.0.1:{gw};")
# Frontends sit on port 80 in Docker; here they use 8000 so no root is needed.
s = re.sub(r"set \$up http://([a-z]+);", r"set $up http://\1:8000;", s)
head = f"pid {work}/nginx.pid;\nerror_log {work}/error.log info;\n"
if uid == "0":
    head += "user root;\n"
s = head + s
s = s.replace("http {", f"http {{\n  access_log off;\n  client_body_temp_path {work}/b;\n  proxy_temp_path {work}/p;\n  fastcgi_temp_path {work}/f;\n  uwsgi_temp_path {work}/u;\n  scgi_temp_path {work}/s;", 1)
open(f"{work}/nginx.conf", "w").write(s)
PY

python3 "$HERE/fake-dns.py" "$DNS" "$RECORDS" &
echo $! > "$WORK/dns.pid"

# ---- tiny test helpers ----
BODY=""; STATUS=""; HEADERS=""; TARGET="$GW"   # which test server req() talks to
req() {  # req METHOD PATH [more curl args]  ->  sets STATUS, BODY, HEADERS
  local method="$1" path="$2"; shift 2
  HEADERS="$WORK/headers"
  BODY="$(curl -s -m 15 -X "$method" -D "$HEADERS" -w '\n%{http_code}' "$@" "http://127.0.0.1:$TARGET$path")"
  STATUS="${BODY##*$'\n'}"
  BODY="${BODY%$'\n'*}"
}
ok()   { PASS=$((PASS + 1)); echo "  ok    $1"; }
bad()  { FAIL=$((FAIL + 1)); echo "  FAIL  $1"; echo "        status=$STATUS body=${BODY:0:200}"; }
expect_status() { [ "$STATUS" = "$2" ] && ok "$1" || bad "$1 (wanted status $2)"; }
expect_body()   { case "$BODY" in *"$2"*) ok "$1" ;; *) bad "$1 (body should contain: $2)" ;; esac; }
expect_header() { grep -qi "$2" "$HEADERS" && ok "$1" || bad "$1 (header should match: $2)"; }
expect_no_header() { grep -qi "$2" "$HEADERS" && bad "$1 (header should NOT match: $2)" || ok "$1"; }

start_nginx() { nginx -c "$WORK/nginx.conf" 2>"$WORK/start.log" || { echo "nginx failed to start:"; cat "$WORK/start.log"; return 1; }; }

echo "== 1. The gateway starts with NO apps running at all"
if start_nginx; then ok "nginx started with every upstream missing"; else bad "nginx refused to start"; echo "RESULT: $PASS passed, $FAIL failed"; exit 1; fi
sleep 0.5

req GET /
expect_status "Home missing: / answers 503" 503
expect_body   "  ...with a readable page naming the app" "Home is offline"
expect_header "  ...and says when to retry" "^retry-after:"
req GET /tasks/
expect_body   "frontend missing: /tasks/ names HomeTasks" "HomeTasks is offline"
req GET /api/hometasks/health
expect_status "backend missing: answers 503" 503
expect_body   "  ...as JSON, naming the app" '"error":"HomeTasks is offline'
expect_header "  ...with a JSON content type" "^content-type: application/json"
req GET /api/auth/me
expect_body   "HomeCore missing: login path says HomeCore" "HomeCore is offline"
req GET /cloud
expect_status "redirects still work with no apps (/cloud -> /cloud/)" 301

req POST /api/homebridge/search -H 'Content-Type: application/json' -d '{"query":"trip","sources":["homenotes"]}'
expect_status "optional HomeBridge can be absent" 503
expect_body "missing bridge is named in the error" "HomeBridge is offline"

echo "== 2. Apps that ARE running work, with paths passed correctly"
for a in home homecore hometasks hometasks-backend homemedia-backend homesync-backend; do app_up "$a"; done
sleep 1.5   # the gateway's DNS cache is 1 second in this test

req GET /
expect_body   "/ reaches Home" '"app": "home"'
app_up homebridge
sleep 1.5
req POST /api/homebridge/search -H 'Content-Type: application/json' -d '{"query":"trip","sources":["homenotes"]}'
expect_body "bridge API reaches the optional service" '"app": "homebridge"'
expect_body "bridge path is preserved" '"path": "/api/homebridge/search"'
app_gone homebridge
sleep 1.5
req GET /
expect_body "Home still works after bridge removal" '"app": "home"'
expect_body   "  ...with the path unchanged" '"path": "/"'
req GET "/tasks/assets/app.js?v=2&x=%20y"
expect_body   "/tasks/... reaches the HomeTasks frontend" '"app": "hometasks"'
expect_body   "  ...with the /tasks prefix stripped and query kept" '"path": "/assets/app.js?v=2&x=%20y"'
req GET /tasks/
expect_body   "/tasks/ becomes / upstream" '"path": "/"'
req GET /tasks/settings
expect_body   "a deep link becomes /settings upstream" '"path": "/settings"'
req GET "/api/hometasks/tasks?status=done&today=2026-10-09"
expect_body   "API paths are passed through UNCHANGED (prefix kept)" '"path": "/api/hometasks/tasks?status=done&today=2026-10-09"'
req GET /api/auth/me
expect_body   "/api/auth/... reaches HomeCore, path unchanged" '"path": "/api/auth/me"'
req GET /api/core/auth/me
expect_body   "canonical auth reaches HomeCore without rewriting" '"path": "/api/core/auth/me"'
req GET /api/core/admin/activity
expect_body   "canonical admin reaches HomeCore without rewriting" '"path": "/api/core/admin/activity"'
req GET /api/core/activity/homecloud
expect_body   "explicit HomeCloud activity scope reaches HomeCore" '"path": "/api/core/activity/homecloud"'
req POST /internal/delegations -H 'Content-Type: application/json' -d '{"integrationId":"monitor-followup-v1","consent":true}'
expect_status "delegation issuance is not exposed by the public gateway" 404
req POST /internal/delegations/example/renew -H 'Content-Type: application/json' -d '{"consent":true}'
expect_status "delegation renewal is not exposed by the public gateway" 404
req GET /sync/
expect_body   "/sync/ reaches homesync-backend as /" '"path": "/"'
req POST /api/hometasks/tasks -H 'Content-Type: application/json' -d '{"title":"x"}'
expect_body   "POST bodies get through" '"bodyBytes": 13'
req GET /api/hometasks/health -H 'Host: home.example'
expect_body   "the original Host header is forwarded" '"host": "home.example"'
expect_body   "X-Forwarded-For is added" '"xff": "127.0.0.1"'
expect_body   "X-Real-IP is added" '"xrealip": "127.0.0.1"'
req GET /tasks/
expect_body   "frontends get X-Forwarded-For too" '"xff": "127.0.0.1"'

echo "== 3. The streaming HomeMedia paths still work"
req POST /api/homemedia/upload -d 'some-file-bytes'
expect_body   "/api/homemedia/upload is proxied" '"bodyBytes": 15'
req GET /api/homemedia/stream/clip.mp4 -H 'Range: bytes=0-10'
expect_body   "/api/homemedia/stream/ is proxied, path unchanged" '"path": "/api/homemedia/stream/clip.mp4"'

echo "== 4. An app's OWN error answers pass through untouched"
req GET /api/hometasks/degraded
expect_status "an app's own 503 is NOT replaced" 503
expect_body   "  ...its JSON body arrives as-is (callers read it)" '"status": "degraded"'
req GET /api/hometasks/missing
expect_status "an app's own 404 passes through" 404
expect_body   "  ...with its own body" '"error": "no such thing"'

echo "== 5. Apps that are NOT running fail alone; the rest keeps working"
req GET /cloud/
expect_status "HomeCloud frontend (down) answers 503" 503
expect_body   "  ...with the offline page" "HomeCloud is offline"
req GET /api/homecloud/files
expect_body   "HomeCloud backend (down): JSON offline message" '"error":"HomeCloud is offline'
req GET /api/share/abc123
expect_body   "public share links also say HomeCloud is offline" "HomeCloud is offline"
req GET /api/homemedia/health
expect_body   "HomeMedia backend (up) still works" '"app": "homemedia-backend"'
req GET /media/
expect_body   "HomeMedia frontend (down) shows the offline page" "HomeMedia is offline"

echo "== 6. An app that starts LATER is found without restarting the gateway"
app_up homecloud
app_up homecloud-backend
sleep 2.5
req GET /cloud/
expect_status "/cloud/ works after HomeCloud starts" 200
expect_body   "  ...reaching the right app" '"app": "homecloud"'
req GET /api/share/abc123
expect_body   "share links reach the HomeCloud backend" '"app": "homecloud-backend"'

echo "== 7. An app that CRASHES (name still resolves, connection refused)"
app_crashed hometasks-backend
sleep 0.3
req GET /api/hometasks/health
expect_status "a crashed app answers 503, quickly" 503
expect_body   "  ...naming the app" "HomeTasks is offline"
req GET /api/homecloud/anything
expect_body   "other apps are unaffected" '"app": "homecloud-backend"'

echo "== 8. An app that disappears from DNS (container removed)"
app_gone homecloud
sleep 2.5
req GET /cloud/
expect_status "a removed app answers 503 once its name is gone" 503

echo "== 9. The gateway itself kept running throughout"
[ -f "$WORK/nginx.pid" ] && kill -0 "$(cat "$WORK/nginx.pid")" 2>/dev/null && ok "same nginx process is still alive" || bad "nginx died"
if grep -q "emerg\|\[alert\]" "$WORK/error.log"; then bad "nginx logged an emergency/alert"; grep "emerg\|\[alert\]" "$WORK/error.log" | head -3; else ok "no emerg/alert lines in nginx's error log"; fi

echo "== 10. Home's OWN container starts and serves with HomeCloud and HomeCore missing"
# apps/home/nginx.conf is a small server block that the Home image drops into
# nginx's conf.d. Wrap it in a minimal nginx here, with the same few changes.
HOMEPORT=18090
mkdir -p "$WORK/home-root"
echo '<html>HOME-STATIC-INDEX</html>' > "$WORK/home-root/index.html"
python3 - "$HERE/../../apps/home/nginx.conf" "$WORK" "$DNS" "$HOMEPORT" "$(id -u)" <<'PY'
import sys
src, work, dns, port, uid = sys.argv[1:6]
s = open(src).read()
assert "resolver 127.0.0.11 valid=10s ipv6=off;" in s
s = s.replace("resolver 127.0.0.11 valid=10s ipv6=off;", f"resolver 127.0.0.1:{dns} valid=1s ipv6=off;")
s = s.replace("listen 80;", f"listen 127.0.0.1:{port};")
s = s.replace("root /usr/share/nginx/html;", f"root {work}/home-root;")
# the real image has no explicit ports for these upstreams' DNS names, but the fakes do
head = f"pid {work}/nginx2.pid;\nerror_log {work}/error2.log info;\n" + ("user root;\n" if uid == "0" else "")
full = head + "events {}\nhttp {\n  include /etc/nginx/mime.types;\n  access_log off;\n" \
       f"  client_body_temp_path {work}/b2;\n  proxy_temp_path {work}/p2;\n  fastcgi_temp_path {work}/f2;\n  uwsgi_temp_path {work}/u2;\n  scgi_temp_path {work}/s2;\n" + s + "\n}\n"
open(f"{work}/nginx-home.conf", "w").write(full)
PY
app_gone homecore
app_gone homecloud-backend
sleep 1.5
if nginx -c "$WORK/nginx-home.conf" 2>"$WORK/start2.log"; then ok "Home's container started with HomeCloud's backend and HomeCore both missing"; else bad "Home's container refused to start"; cat "$WORK/start2.log"; fi
sleep 0.5
TARGET=$HOMEPORT
req GET /
expect_status "Home serves its page" 200
expect_body   "  ...the real static file" "HOME-STATIC-INDEX"
req GET /settings
expect_body   "a deep link falls back to index.html (React Router)" "HOME-STATIC-INDEX"
req GET /api/homecloud/usage
expect_status "its own proxy to a missing backend is a plain 502, not a crash" 502
app_up homecloud-backend
app_up homecore
sleep 2.5
req GET "/api/homecloud/usage?x=1"
expect_body   "HomeCloud's backend is found once it starts" '"app": "homecloud-backend"'
expect_body   "  ...with the path unchanged (prefix kept)" '"path": "/api/homecloud/usage?x=1"'
req GET /api/auth/me
expect_body   "HomeCore is found once it starts, path unchanged" '"path": "/api/auth/me"'
TARGET=$GW

echo "== 11. The Content-Security-Policy (docs/SECURITY.md, \"Shared-origin XSS\")"
# The policy only matters if it is really sent, on every kind of answer, with
# the right strictness. These checks read the header a browser would receive.
app_up homevault; app_up homenotes; app_up homevault-backend
sleep 2.5

# Pull the policy text out of the last response's headers (curl leaves a CR at
# the end of each header line; tr removes it).
policy() { grep -i '^content-security-policy:' "$HEADERS" | tr -d '\r'; }

req GET /tasks/
expect_header "a frontend page carries a policy" "^content-security-policy: default-src 'self'"
expect_header "  ...scripts only from this origin" "script-src 'self' 'sha256-"
expect_header "  ...fetch/XHR only to this origin (blocks sending the token away)" "connect-src 'self'"
expect_header "  ...no <object>/<embed> plugins" "object-src 'none'"
expect_header "  ...cannot be framed by another site" "frame-ancestors 'none'"
expect_no_header "  ...no unsafe-inline anywhere" "unsafe-inline"
expect_no_header "  ...no eval, and no wasm compiling for an ordinary app" "unsafe-eval"
# (HomeTasks' backend was crashed on purpose in section 7, so use HomeMedia's, which is up.)
req GET /api/homemedia/health
expect_header "an API answer carries the policy too" "^content-security-policy: default-src 'self'"
req GET /api/homemedia/missing
expect_status "an app's own 404 is still passed through" 404
expect_header "  ...and still carries the policy (header is sent with 'always')" "^content-security-policy:"

echo "   -- only HomeVault may compile WebAssembly (Argon2id)"
req GET /vault/
expect_header "/vault/ may compile WebAssembly" "script-src 'self' 'sha256-[^;]*'wasm-unsafe-eval'"
expect_no_header "  ...but still gets no eval() and no inline code" "[^-]unsafe-eval\|unsafe-inline"
req GET /vault/unlock
expect_header "a HomeVault deep link may compile WebAssembly too" "'wasm-unsafe-eval'"
for path in /tasks/ /notes/ / /vaultish; do
  req GET "$path"
  expect_no_header "$path may NOT compile WebAssembly" "wasm-unsafe-eval"
done
req GET /api/homevault/health
expect_no_header "HomeVault's API answer needs no WebAssembly either" "wasm-unsafe-eval"

echo "   -- the offline answers carry their own, smaller policies"
# (nginx drops the server-level header in a location that sets its own
# add_header, so a missing line here would mean the offline page went unprotected.)
req GET /cloud/
expect_status "an app that is down answers 503" 503
expect_header "its offline page has a policy" "^content-security-policy: default-src 'none'; style-src 'unsafe-inline'"
expect_no_header "  ...that allows no scripts at all" "script-src"
# (still crashed from section 7, so the gateway answers for it)
req GET /api/hometasks/health
expect_status "a backend that is down answers 503" 503
expect_header "the JSON offline answer allows nothing" "^content-security-policy: default-src 'none'; frame-ancestors 'none'"

echo "   -- the hash really is the hash of what every app ships"
# If someone edits the theme script at the top of an index.html, its hash
# changes and the browser would refuse to run it: a blank page in every app.
# This recomputes the hash from the real files, so that mistake fails HERE,
# with the new value printed, not in a user's browser.
req GET /tasks/
SERVED_POLICY="$(policy)"
python3 - "$HERE/../../apps" <<'HASHES' > "$WORK/hashes"
import base64, glob, hashlib, os, re, sys
for page in sorted(glob.glob(os.path.join(sys.argv[1], "*", "index.html"))):
    app = page.split(os.sep)[-2]
    html = open(page, encoding="utf-8").read()
    # Inline scripts = <script> tags WITHOUT a src attribute.
    inline = re.findall(r"<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>", html, re.S)
    if inline:
        digest = "sha256-" + base64.b64encode(hashlib.sha256(inline[0].encode("utf-8")).digest()).decode()
    else:
        digest = "none"
    style = len(re.findall(r"<style|\sstyle=", html))
    print(app, len(inline), digest, style)
HASHES
n_apps=0
while read -r app n_inline digest n_style; do
  n_apps=$((n_apps + 1))
  [ "$n_inline" = "1" ] && ok "$app has exactly one inline script" || bad "$app has $n_inline inline scripts (the policy allows exactly one)"
  case "$SERVED_POLICY" in
    *"'$digest'"*) ok "  ...and the policy allows its hash" ;;
    *) bad "  ...but its hash is NOT in the policy; the right value is '$digest'" ;;
  esac
  [ "$n_style" = "0" ] && ok "  ...and no inline <style> or style= (style-src would block it)" || bad "$app has inline styles that style-src 'self' would block"
done < "$WORK/hashes"
[ "$n_apps" -ge 7 ] && ok "found all $n_apps app pages to check" || bad "expected at least 7 app pages, found $n_apps"

echo
echo "RESULT: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
