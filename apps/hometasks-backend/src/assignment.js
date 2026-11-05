const { HOMECORE_URL } = require('@home/homecore-client');
const { db } = require('./db');
const problem = (message, status = 502) => Object.assign(new Error(message), { status });
let pending = 0;
async function lookupRecipient(token, username) {
  if (pending >= 30) throw problem('Account lookup is busy. Try again.', 503);
  pending++;
  const signal = AbortSignal.timeout(5000);
  try {
    const response = await fetch(HOMECORE_URL + '/api/core/users/lookup', {
      method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ username }), signal, redirect: 'error'
    });
    if ([200, 404].includes(response.status) && !response.headers.get('content-type')?.includes('application/json')) {
      await response.body?.cancel();
      throw problem('Could not check that account. Try again.');
    }
    if (response.status !== 200) {
      if (response.status === 404) {
        let size = 0;
        const chunks = [];
        for await (const chunk of response.body) {
          size += chunk.length;
          if (size > 4096) throw problem('Account lookup is unavailable. Update Core or try again.');
          chunks.push(chunk);
        }
        const reply = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (reply?.error?.code === 'USER_NOT_FOUND') throw problem('Account not available.', 404);
        throw problem('Account lookup is unavailable. Update Core or try again.');
      }
      await response.body?.cancel();
      if ([401, 403].includes(response.status)) throw problem('Sign in again before assigning a task.', 403);
      if ([429, 503].includes(response.status)) throw problem('Account lookup is busy. Try again.', 503);
      throw problem('Could not check that account. Try again.');
    }
    let size = 0;
    const chunks = [];
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > 4096) throw problem('Could not check that account. Try again.');
      chunks.push(chunk);
    }
    const user = JSON.parse(Buffer.concat(chunks).toString('utf8')).user;
    if (!user || !Number.isSafeInteger(user.id) || user.id < 1 || user.username !== username) throw problem('Could not check that account. Try again.');
    return { id: user.id, username: user.username };
  } catch (error) {
    if (signal.aborted) throw problem('Account lookup timed out. Try again.', 504);
    if ([403, 404, 502, 503].includes(error.status)) throw error;
    throw problem('Could not check that account. Try again.');
  } finally { pending--; }
}
function auditAssignment(task, actor, operation, assignee = task.assignee_id) {
  db.prepare('INSERT INTO task_assignment_audit (task_id,owner_id,actor_id,assignee_id,operation) VALUES (?,?,?,?,?)')
    .run(task.id, task.user_id, actor, assignee, operation);
}
module.exports = { lookupRecipient, auditAssignment };
