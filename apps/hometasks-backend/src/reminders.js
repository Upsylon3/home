const fs = require("node:fs");

function readKey() {
  const file = process.env.HOMETASKS_REMINDER_KEY_FILE;
  if (!file) return null;
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size !== 32) return null;
    const key = fs.readFileSync(file);
    return key.length === 32 ? key : null;
  } catch {
    return null;
  }
}

function validateReminder(value, now = Date.now()) {
  if (value === null || value === undefined) return { value: null };
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) {
    return { error: "Reminder must be a UTC instant such as 2026-11-03T09:00:00.000Z." };
  }
  const instant = Date.parse(value);
  if (instant <= now || instant > now + 366 * 86400000) return { error: "Choose a reminder in the future, within 366 days." };
  return { value };
}

function createReminderWorker({ db, coreUrl, key = readKey, now = Date.now, fetchImpl = fetch }) {
  let running = null;
  async function deliver() {
    const secret = key();
    const result = { delivered: 0, retried: 0, suppressed: 0 };
    if (!secret) return result;
    const cutoff = new Date(now()).toISOString();
    const due = db.prepare("SELECT id, user_id, reminder_key FROM tasks WHERE completed_at IS NULL AND reminder_at <= ? AND reminder_sent_at IS NULL AND reminder_error IS NULL AND (reminder_retry_at IS NULL OR reminder_retry_at <= ?) ORDER BY reminder_at, id LIMIT 20").all(cutoff, cutoff);
    for (const candidate of due) {
      const task = db.prepare("SELECT * FROM tasks WHERE id = ? AND user_id = ? AND reminder_key = ? AND completed_at IS NULL AND reminder_at <= ? AND reminder_sent_at IS NULL AND reminder_error IS NULL").get(candidate.id, candidate.user_id, candidate.reminder_key, cutoff);
      if (!task) continue;
      const retry = (delay = 60000) => {
        db.prepare("UPDATE tasks SET reminder_retry_at = ? WHERE id = ? AND reminder_key = ?").run(new Date(now() + delay).toISOString(), task.id, task.reminder_key);
        result.retried++;
      };
      try {
        const response = await fetchImpl(`${coreUrl}/internal/hometasks/reminders`, {
          method: "POST", headers: { "Content-Type": "application/json", "X-Task-Reminder-Key": secret.toString("hex") },
          body: JSON.stringify({ deliveryId: task.reminder_key, userId: task.user_id, taskId: task.id, taskTitle: task.title }),
          signal: AbortSignal.timeout(5000), redirect: "error"
        });
        await response.body?.cancel();
        if (response.status === 200 || response.status === 201) {
          db.prepare("UPDATE tasks SET reminder_sent_at = ? WHERE id = ? AND reminder_key = ? AND completed_at IS NULL").run(new Date(now()).toISOString(), task.id, task.reminder_key);
          result.delivered++;
        } else if (response.status === 410) {
          db.prepare("UPDATE tasks SET reminder_error = 'suppressed' WHERE id = ? AND reminder_key = ?").run(task.id, task.reminder_key);
          result.suppressed++;
        } else retry(response.status === 429 ? 3600000 : 60000);
      } catch { retry(); }
    }
    return result;
  }
  return { tick() { if (!running) running = deliver().finally(() => { running = null; }); return running; }, drain() { return running || Promise.resolve(); } };
}
module.exports = { readKey, validateReminder, createReminderWorker };
