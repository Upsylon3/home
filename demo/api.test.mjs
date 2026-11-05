import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seed, handle } from './api.mjs';
import { generateVaultKey, encryptString, encryptJSON, decryptString, decryptJSON } from '../apps/homevault/src/crypto.js';
const base = '/home/';
const call = (state, path, method = 'GET', body) => handle(state, new Request('https://example.test' + base + 'demo-api' + path, { method, headers: { Authorization: 'Bearer browser-demo', ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}) }, body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined }), base);
const data = async (...args) => { const res = await call(...args); assert.ok(res.ok, await res.clone().text()); return res.json(); };

test('bundled app uninstall and reinstall preserves browser data and requires enablement', async () => {
  let state = seed(base);
  const note = state.notes[0];
  const removed = await data(state, '/core/apps/homenotes', 'DELETE');
  assert.equal(removed.dataPreserved, true);
  state = structuredClone(state);
  assert.ok(!(await data(state, '/core/apps')).applications.some(app => app.slug === 'homenotes'));
  assert.equal((await call(state, '/core/apps/homenotes')).status, 404);
  assert.equal((await data(state, '/core/app-catalog')).applications.find(app => app.slug === 'homenotes').installed, false);
  const installed = await data(state, '/core/apps/homenotes/install', 'POST', {});
  assert.equal(installed.application.enabled, false);
  await data(state, '/core/apps/homenotes', 'PATCH', { enabled: true });
  assert.equal((await data(state, `/homenotes/notes/${note.id}`)).note.content, note.content);
  assert.equal((await call(state, '/core/apps/homecloud', 'PATCH', { enabled: false })).status, 409);
});

test('file bytes survive storage round trips, trash and restore; new browsers are independent', async () => {
  let state = seed(base); const form = new FormData(); form.append('file', new Blob(['Hello locally'], { type: 'text/plain' }), 'local.txt');
  const { file } = await data(state, '/homecloud/files/upload', 'POST', form);
  state = structuredClone(state);
  assert.equal(await (await call(state, `/homecloud/files/${file.id}/download`)).text(), 'Hello locally');
  await data(state, `/homecloud/files/${file.id}`, 'DELETE');
  assert.ok(!(await data(state, '/homecloud/files')).files.some(f => f.id === file.id));
  assert.ok((await data(state, '/homecloud/files/trash')).files.some(f => f.id === file.id));
  await data(state, `/homecloud/files/${file.id}/restore`, 'POST');
  assert.ok((await data(state, '/homecloud/files')).files.some(f => f.id === file.id));
  assert.ok(!seed(base).files.some(f => f.id === file.id));
});

test('notes, version restoration, tasks and local search use the same persisted state', async () => {
  const state = seed(base);
  const { note } = await data(state, '/homenotes/notes', 'POST', { title: 'Demo journal', content: 'First draft' });
  await data(state, `/homenotes/notes/${note.id}`, 'PATCH', { content: 'Revised draft', tags: ['demo'] });
  const { versions } = await data(state, `/homenotes/notes/${note.id}/versions`);
  await data(state, `/homenotes/notes/${note.id}/versions/${versions[0].id}/restore`, 'POST');
  assert.equal((await data(state, `/homenotes/notes/${note.id}`)).note.content, 'First draft');
  const { task } = await data(state, '/hometasks/tasks', 'POST', { title: 'Demo journal', dueDate: '2026-11-03', repeat: 'daily' });
  const { next } = await data(state, `/hometasks/tasks/${task.id}/complete?today=2026-11-03`, 'POST');
  assert.equal(next.dueDate, '2026-11-04');
  const result = await data(state, '/homebridge/search', 'POST', { query: 'journal', sources: ['homenotes', 'hometasks'] });
  assert.equal(result.groups[0].results[0].id, note.id);
  assert.ok(result.groups[0].results[0].href.startsWith('/home/notes/#/'));
});

test('Vault stores ciphertext, survives a storage round trip and supports trash/restore/purge', async () => {
  let state = seed(base);
  const key = await generateVaultKey();
  const title = await encryptString('Example login', key), secret = await encryptJSON({ password: 'dummy-secret-only' }, key);
  const envelope = Object.fromEntries(['kdfSalt', 'wrappedKeyMaster', 'wrappedKeyMasterIv', 'wrappedKeyRecovery', 'wrappedKeyRecoveryIv', 'verifier', 'verifierIv'].map(f => [f, 'test-envelope']));
  await data(state, '/homevault/vault', 'POST', { ...envelope, kdfParams: { m: 65536, t: 3, p: 1 } });
  const { item } = await data(state, '/homevault/vault/items', 'POST', { type: 'login', encryptedTitle: title.ciphertext, encryptedTitleIv: title.iv, encryptedData: secret.ciphertext, encryptedDataIv: secret.iv });
  assert.ok(!JSON.stringify(state).includes('dummy-secret-only'));
  assert.ok(!JSON.stringify(state).includes('Example login'));
  state = structuredClone(state);
  const stored = (await data(state, `/homevault/vault/items/${item.id}`)).item;
  assert.equal(await decryptString(stored.encryptedTitle, stored.encryptedTitleIv, key), 'Example login');
  assert.equal((await decryptJSON(stored.encryptedData, stored.encryptedDataIv, key)).password, 'dummy-secret-only');
  const wrong = await generateVaultKey();
  await assert.rejects(() => decryptJSON(stored.encryptedData, stored.encryptedDataIv, wrong));
  await data(state, `/homevault/vault/items/${item.id}`, 'DELETE');
  assert.equal((await data(state, '/homevault/vault/items')).items.length, 0);
  assert.equal((await data(state, '/homevault/vault/items?trash=true')).items.length, 1);
  await data(state, `/homevault/vault/items/${item.id}/restore`, 'POST');
  assert.equal((await data(state, '/homevault/vault/items')).items.length, 1);
  await data(state, `/homevault/vault/items/${item.id}/permanent`, 'DELETE');
  assert.equal((await call(state, `/homevault/vault/items/${item.id}`)).status, 404);
});

test('media shares Cloud bytes, favorites and albums persist, reset only restores demo state', async () => {
  const state = seed(base); const form = new FormData(); form.append('file', new Blob(['image bytes'], { type: 'image/png' }), 'photo.png');
  const { file } = await data(state, '/homemedia/upload', 'POST', form);
  await data(state, `/homemedia/favorites/${file.id}`, 'POST');
  const { album } = await data(state, '/homemedia/albums', 'POST', { name: 'My album' });
  await data(state, `/homemedia/albums/${album.id}/items`, 'POST', { fileIds: [file.id] });
  assert.equal((await data(state, '/homemedia/library?favorite=true')).files[0].favorited, true);
  assert.equal((await data(state, `/homemedia/library?albumId=${album.id}`)).files[0].id, file.id);
  assert.equal(await (await call(state, `/homemedia/${file.id}/stream`)).text(), 'image bytes');
  assert.equal((await call(state, `/homecloud/files/${file.id}/share`, 'POST', {})).status, 501);
  await data(state, '/demo/reset', 'POST');
  assert.equal(state.files.length, 2); assert.equal(state.vault, null);
});
