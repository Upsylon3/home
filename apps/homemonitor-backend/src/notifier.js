// Sends alert notifications to HomeCore, which shows them in Home's bell.
//
// This is "one trusted service calling another as itself": we prove who we are
// with the shared secret (see homecore/src/internalAuth.js) rather than a
// person's login, because nobody is signed in when a disk fills at 3 a.m.
// Notifications go to every enabled admin.

// items = [{ key, kind: "opened" | "resolved", severity, title, body }]
// Throws if HomeCore refuses or can't be reached, so the caller can retry later.
async function sendNotifications(items, config, { fetchFn = fetch } = {}) {
  for (const item of items) {
    const response = await fetchFn(`${config.homecoreUrl}/internal/notifications`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Internal-Secret": config.internalSecret },
      body: JSON.stringify({
        applicationSlug: "homemonitor",
        type: item.kind === "resolved" ? "alert-resolved" : "alert",
        title: item.title,
        body: item.body || null,
        data: { key: item.key, severity: item.severity },
        audience: "admins"
      }),
      signal: AbortSignal.timeout(5000)
    });
    if (!response.ok) throw new Error(`HomeCore refused the notification (${response.status})`);
  }
}

module.exports = { sendNotifications };
