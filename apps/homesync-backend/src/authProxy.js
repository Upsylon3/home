const express = require("express");
const { HOMECLOUD_URL } = require("./homecloudClient");

const router = express.Router();

// Not gated by requireAuth (login can't require being already logged in) —
// mounted separately in app.js, before the authenticated routes.
//
// Exists so the Android app only ever needs to know about *one* server
// address (HomeSync's) rather than two, the same way home/nginx.conf and
// homemedia/nginx.conf proxy /api/auth/* to HomeCloud so their browser
// frontends only deal with one origin. There's no reverse proxy layer in
// front of a plain Node service the way there is for those, so this does
// the same job by hand: forward the request, forward the response,
// nothing more.
async function proxy(req, res, path, init) {
  let upstream;
  try {
    upstream = await fetch(`${HOMECLOUD_URL}${path}`, init);
  } catch {
    return res.status(502).json({ error: "Couldn't reach HomeCloud." });
  }
  const data = await upstream.json().catch(() => null);
  res.status(upstream.status).json(data ?? { error: "HomeCloud returned an unexpected response." });
}

router.post("/auth/login", (req, res) =>
  proxy(req, res, "/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req.body)
  })
);

router.post("/auth/2fa/verify", (req, res) =>
  proxy(req, res, "/api/auth/2fa/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req.body)
  })
);

router.get("/auth/me", (req, res) =>
  proxy(req, res, "/api/auth/me", {
    headers: { Authorization: req.headers.authorization || "" }
  })
);

module.exports = router;
