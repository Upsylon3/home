const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startTestApp, stopTestApp } = require('./helpers/app');
const { makeClient, registerHomeNotesUser } = require('./helpers/client');
let app;
before(async () => { app = await startTestApp(); });
after(stopTestApp);
const register = () => registerHomeNotesUser(app.homecore, app.baseUrl);

test('templates require auth and cannot read, use, delete or snapshot another owner data', async () => {
  const owner = await register(), other = await register();
  assert.equal((await makeClient(app.baseUrl).get('/api/homenotes/templates')).status, 401);
  const note = (await owner.client.post('/api/homenotes/notes', { title: 'Private' })).body.note;
  const saved = await owner.client.post(`/api/homenotes/notes/${note.id}/templates`, { name: 'Private template' });
  assert.equal(saved.status, 201);
  assert.deepEqual((await other.client.get('/api/homenotes/templates')).body.templates, []);
  assert.equal((await other.client.post(`/api/homenotes/notes/${note.id}/templates`, { name: 'Stolen' })).status, 404);
  assert.equal((await other.client.post(`/api/homenotes/templates/${saved.body.template.id}/notes`, {})).status, 404);
  assert.equal((await other.client.delete(`/api/homenotes/templates/${saved.body.template.id}`)).status, 404);
});

test('snapshots copy title/content/tags into independent notes, without folder/favorite/attachments/history', async () => {
  const owner = await register();
  const folder = (await owner.client.post('/api/homenotes/note-folders', { name: 'Source folder' })).body.folder;
  const source = (await owner.client.post('/api/homenotes/notes', { title: 'Weekly plan', content: '# Plans\n- [ ] Next', tags: ['Weekly', 'Plans'], folderId: folder.id })).body.note;
  await owner.client.patch(`/api/homenotes/notes/${source.id}`, { isFavorite: true });
  const form = new FormData();
  form.append('file', new Blob(['template attachment'], { type: 'text/plain' }), 'attachment.txt');
  const attachment = await owner.client.post(`/api/homenotes/notes/${source.id}/attachments`, form, { raw: true });
  assert.ok(attachment.status < 300);
  assert.equal((await owner.client.get(`/api/homenotes/notes/${source.id}`)).body.note.attachments.length, 1);
  const saved = await owner.client.post(`/api/homenotes/notes/${source.id}/templates`, { name: 'Weekly checklist' });
  assert.equal(saved.status, 201);
  assert.equal(saved.body.template.name, 'Weekly checklist');
  assert.equal('content' in saved.body.template, false);
  await owner.client.patch(`/api/homenotes/notes/${source.id}`, { title: 'Changed original', content: 'changed', tags: ['Changed'] });
  const first = (await owner.client.post(`/api/homenotes/templates/${saved.body.template.id}/notes`, {})).body.note;
  assert.notEqual(first.id, source.id);
  assert.equal(first.title, 'Weekly plan');
  assert.equal(first.content, '# Plans\n- [ ] Next');
  assert.deepEqual(first.tags, ['Plans', 'Weekly']);
  assert.equal(first.folderId, null);
  assert.equal(first.isFavorite, false);
  assert.deepEqual(first.attachments, []);
  assert.deepEqual((await owner.client.get(`/api/homenotes/notes/${first.id}/versions`)).body.versions, []);
  await owner.client.patch(`/api/homenotes/notes/${first.id}`, { content: 'independent edit' });
  const second = (await owner.client.post(`/api/homenotes/templates/${saved.body.template.id}/notes`, {})).body.note;
  assert.equal(second.content, '# Plans\n- [ ] Next');
  assert.notEqual(first.id, second.id);
  assert.equal((await owner.client.delete(`/api/homenotes/templates/${saved.body.template.id}`)).status, 200);
  assert.equal((await owner.client.get(`/api/homenotes/notes/${first.id}`)).body.note.content, 'independent edit');
  assert.equal((await owner.client.post(`/api/homenotes/templates/${saved.body.template.id}/notes`, {})).status, 404);
  assert.equal((await owner.client.get(`/api/homenotes/notes/${source.id}`)).body.note.attachments.length, 1);
});

test('per-owner template capacity stays bounded without affecting other accounts', async () => {
  const owner = await register();
  const source = (await owner.client.post('/api/homenotes/notes', {})).body.note;
  const insert = app.db.prepare('INSERT INTO note_templates (user_id, name, title, content) VALUES (?, ?, ?, ?)');
  for (let n = 0; n < 100; n++) insert.run(owner.user.id, `Template ${n}`, 'Title', 'Body');
  assert.equal((await owner.client.get('/api/homenotes/templates')).body.templates.length, 100);
  assert.equal((await owner.client.post(`/api/homenotes/notes/${source.id}/templates`, { name: 'Overflow' })).status, 409);
});

test('template names are bounded and unique per owner; trash cannot become a template', async () => {
  const owner = await register(), other = await register();
  const source = (await owner.client.post('/api/homenotes/notes', {})).body.note;
  for (const name of ['', ' ', 3, 'x'.repeat(101)]) {
    assert.equal((await owner.client.post(`/api/homenotes/notes/${source.id}/templates`, { name })).status, 400);
  }
  assert.equal((await owner.client.post(`/api/homenotes/notes/${source.id}/templates`, { name: ' Basic ' })).status, 201);
  assert.equal((await owner.client.post(`/api/homenotes/notes/${source.id}/templates`, { name: 'basic' })).status, 409);
  const otherNote = (await other.client.post('/api/homenotes/notes', {})).body.note;
  assert.equal((await other.client.post(`/api/homenotes/notes/${otherNote.id}/templates`, { name: 'Basic' })).status, 201);
  await owner.client.delete(`/api/homenotes/notes/${source.id}`);
  assert.equal((await owner.client.post(`/api/homenotes/notes/${source.id}/templates`, { name: 'Trashed' })).status, 404);
});
