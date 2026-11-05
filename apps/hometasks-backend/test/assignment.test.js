const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { startTestApp, stopTestApp } = require('./helpers/app');
const { registerHomeTasksUser } = require('./helpers/client');
let context, owner, member, stranger, project;
before(async () => {
  context = await startTestApp();
  owner = await registerHomeTasksUser(context.homecore, context.baseUrl);
  member = await registerHomeTasksUser(context.homecore, context.baseUrl);
  stranger = await registerHomeTasksUser(context.homecore, context.baseUrl);
  project = (await owner.client.post('/api/hometasks/projects', { name: 'Private project name' })).body.project;
});
after(stopTestApp);
const create = async body => (await owner.client.post('/api/hometasks/tasks', { title: 'Shared chore', notes: 'Explicitly shared notes', projectId: project.id, ...body })).body.task;
const assign = (task, username, version = task.assignmentVersion) => owner.client.post(`/api/hometasks/tasks/${task.id}/assignment`, { username, version });
test('exact enabled-account lookup returns minimal identity only and rejects directory enumeration', async () => {
  const headers = { Authorization: 'Bearer ' + owner.token, 'Content-Type': 'application/json' };
  const lookup = body => fetch(context.homecore.baseUrl + '/api/core/users/lookup', { method: 'POST', headers, body: JSON.stringify(body) });
  const response = await lookup({ username: member.username });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { user: { id: member.user.id, username: member.username } });
  assert.equal((await lookup({ username: '*' })).status, 400);
  assert.equal((await lookup({ username: member.username, id: member.user.id })).status, 400);
  context.homecore.db.prepare('UPDATE users SET disabled=1 WHERE id=?').run(stranger.user.id);
  assert.equal((await lookup({ username: stranger.username })).status, 404);
  context.homecore.db.prepare('UPDATE users SET disabled=0 WHERE id=?').run(stranger.user.id);
});
test('personal data stays private until explicit task assignment and projects/reminders never leak', async () => {
  const task = await create();
  const privateTask = await create({ title: 'Private sibling task' });
  context.db.prepare("UPDATE tasks SET reminder_at='2099-01-01T00:00:00.000Z', reminder_key='private-key' WHERE id=?").run(task.id);
  assert.equal((await member.client.get(`/api/hometasks/tasks/${task.id}`)).status, 404);
  assert.equal((await assign(task, member.username)).status, 200);
  const shared = await member.client.get(`/api/hometasks/tasks/${task.id}`);
  assert.equal(shared.status, 200);
  assert.equal(shared.body.task.notes, task.notes);
  assert.equal(shared.body.task.projectId, null);
  assert.equal(shared.body.task.reminderAt, null);
  assert.equal(shared.body.task.reminderState, null);
  assert.equal(shared.body.task.access, 'assignee');
  assert.equal(shared.body.task.owner.username, owner.username);
  assert.ok(!JSON.stringify(shared.body).includes('private-key'));
  assert.equal((await member.client.get(`/api/hometasks/projects/${project.id}`)).status, 404);
  assert.equal((await member.client.get('/api/hometasks/projects')).body.projects.length, 0);
  assert.equal((await member.client.get('/api/hometasks/tasks')).body.tasks.length, 0);
  assert.deepEqual((await member.client.get('/api/hometasks/tasks?scope=assigned')).body.tasks.map(t => t.id), [task.id]);
  assert.equal((await member.client.get(`/api/hometasks/tasks/${privateTask.id}`)).status, 404);
  assert.equal((await stranger.client.get(`/api/hometasks/tasks/${task.id}`)).status, 404);
  assert.equal((await stranger.client.post(`/api/hometasks/tasks/${task.id}/complete`)).status, 404);
  for (const action of [() => member.client.patch(`/api/hometasks/tasks/${task.id}`, { notes: 'changed' }),
    () => member.client.delete(`/api/hometasks/tasks/${task.id}`), () => member.client.post(`/api/hometasks/tasks/${task.id}/reopen`),
    () => member.client.post(`/api/hometasks/tasks/${task.id}/assignment`, { username: stranger.username, version: 1 })]) {
    assert.equal((await action()).status, 404);
  }
  assert.equal((await owner.client.get(`/api/hometasks/tasks/${task.id}`)).body.task.projectId, project.id);
});
test('reassignment and decline remove access immediately without deleting the owner task', async () => {
  const task = await create();
  const first = (await assign(task, member.username)).body.task;
  const second = (await assign(first, stranger.username)).body.task;
  assert.equal((await member.client.get(`/api/hometasks/tasks/${task.id}`)).status, 404);
  assert.equal((await member.client.post(`/api/hometasks/tasks/${task.id}/complete`)).status, 404);
  assert.equal((await stranger.client.delete(`/api/hometasks/tasks/${task.id}/assignment`)).status, 200);
  assert.equal((await stranger.client.get(`/api/hometasks/tasks/${task.id}`)).status, 404);
  const own = (await owner.client.get(`/api/hometasks/tasks/${task.id}`)).body.task;
  assert.equal(own.notes, task.notes); assert.equal(own.assignee, null);
  assert.equal((await assign(second, member.username)).status, 409);
});

test('private edits invalidate old sharing consent and invalid recipients never create access', async () => {
  const task = await create();
  for (const username of [owner.username, 'unknown_account']) assert.ok([400, 404].includes((await assign(task, username)).status));
  context.homecore.db.prepare('UPDATE users SET disabled=1 WHERE id=?').run(stranger.user.id);
  assert.equal((await assign(task, stranger.username)).status, 404);
  context.homecore.db.prepare('UPDATE users SET disabled=0 WHERE id=?').run(stranger.user.id);
  const changed = await owner.client.patch(`/api/hometasks/tasks/${task.id}`, { notes: 'New private content' });
  assert.ok(changed.body.task.assignmentVersion > task.assignmentVersion);
  assert.equal((await assign(task, member.username)).status, 409);
  assert.equal((await member.client.get(`/api/hometasks/tasks/${task.id}`)).status, 404);
});
test('assignee completion preserves ownership, clears owner reminders and repeats exactly once', async () => {
  const task = (await assign(await create({ repeat: 'daily', dueDate: '2026-11-05' }), member.username)).body.task;
  context.db.prepare("UPDATE tasks SET reminder_at='2099-01-01T00:00:00.000Z',reminder_key='fixture' WHERE id=?").run(task.id);
  const completed = await Promise.all([owner.client, member.client].map(client => client.post(`/api/hometasks/tasks/${task.id}/complete?today=2026-11-05`)));
  assert.ok(completed.every(result => result.status === 200));
  const children = context.db.prepare('SELECT * FROM tasks WHERE title=? AND id!=? AND repeat_rule=?').all(task.title, task.id, 'daily');
  assert.equal(children.length, 1); assert.equal(children[0].user_id, owner.user.id); assert.equal(children[0].assignee_id, member.user.id);
  assert.equal(context.db.prepare('SELECT reminder_at FROM tasks WHERE id=?').get(task.id).reminder_at, null);
  const next = (await member.client.get(`/api/hometasks/tasks/${children[0].id}`)).body.task;
  assert.equal(next.projectId, null); assert.equal(next.access, 'assignee');
  assert.equal((await member.client.post(`/api/hometasks/tasks/${task.id}/reopen`)).status, 404);
  assert.equal((await owner.client.post(`/api/hometasks/tasks/${task.id}/reopen`)).status, 200);
  assert.equal((await member.client.get(`/api/hometasks/tasks/${children[0].id}`)).status, 404);
});
test('a delayed Core lookup cannot resurrect an assignment removed by a newer owner action', async () => {
  const task = await create();
  const server = context.homecore.server, handler = server.listeners('request')[0];
  let release, arrived;
  const gate = new Promise(resolve => { release = resolve; }), seen = new Promise(resolve => { arrived = resolve; });
  server.removeAllListeners('request');
  server.on('request', (req, res) => {
    if (req.url === '/api/core/users/lookup') { arrived(); gate.then(() => handler(req, res)); }
    else handler(req, res);
  });
  try {
    const pending = assign(task, member.username);
    await seen;
    assert.equal((await assign(task, null)).status, 200);
    release();
    assert.equal((await pending).status, 409);
    assert.equal((await owner.client.get(`/api/hometasks/tasks/${task.id}`)).body.task.assignee, null);
  } finally { release(); server.removeAllListeners('request'); server.on('request', handler); }
});
test('failed sharing audits roll back access; offline restore removes all grants and keeps task data', async () => {
  const task = await create();
  context.db.exec("CREATE TRIGGER reject_assignment BEFORE INSERT ON task_assignment_audit BEGIN SELECT RAISE(ABORT,'disposable audit failure'); END");
  try { assert.equal((await assign(task, member.username)).status, 500); }
  finally { context.db.exec('DROP TRIGGER reject_assignment'); }
  assert.equal((await member.client.get(`/api/hometasks/tasks/${task.id}`)).status, 404);
  assert.equal((await assign(task, member.username)).status, 200);
  const result = spawnSync(process.execPath, [path.resolve(__dirname, '../scripts/revoke-restored-assignments.js'),
    '--database', path.join(context.dataDir, 'hometasks.db'), '--confirm-offline-restore'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr); assert.ok(JSON.parse(result.stdout).revoked >= 1);
  assert.equal((await member.client.get(`/api/hometasks/tasks/${task.id}`)).status, 404);
  assert.equal((await owner.client.get(`/api/hometasks/tasks/${task.id}`)).body.task.notes, task.notes);
});
