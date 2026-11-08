// Demo contracts mirror the public frontend APIs. This is deliberately not an auth server.
const stamp = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
const json = (value, status = 200) => Response.json(value, { status });
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const clean = row => { if (!row) return row; const { blob, versions, ...rest } = row; return rest; };
const active = row => !row.deletedAt;
const match = (a, b) => String(a ?? '') === String(b ?? '');
const find = (rows, id) => rows.find(row => match(row.id, id)) || fail('Not found.', 404);
const valid = (value, label = 'Name') => typeof value === 'string' && value.trim() ? value.trim() : fail(label + ' is required.');
export function seed(base = '/home/') {
  const now = stamp();
  const applications = [
    ['cloud', 'HomeCloud', 'Files, folders, and a place for everything.'],
    ['media', 'HomeMedia', 'Your photos, videos, and music.'],
    ['notes', 'HomeNotes', 'A quiet space to collect your thoughts.'],
    ['tasks', 'HomeTasks', 'Plans, projects, and everyday tasks.'],
    ['monitor', 'HomeMonitor', 'A simulated view of your home server.'],
    ['vault', 'HomeVault', 'Try an encrypted vault with test secrets.']
  ].map(([prefix, name, description], i) => ({ id: i + 1, slug: name.toLowerCase(), name, description, baseUrl: base + prefix + '/', enabled: true, version: 'demo' }));
  const picture = new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="960" height="640" viewBox="0 0 960 640"><rect width="960" height="640" fill="#f3e9d2"/><circle cx="700" cy="190" r="80" fill="#e0892b"/><path d="M0 540L290 180 600 540Z" fill="#4aaaa5"/><path d="M300 540L650 280 960 540Z" fill="#7d5426"/><path d="M0 540H960V640H0Z" fill="#221a13"/><text x="40" y="605" fill="#f3e9d2" font-size="32" font-family="sans-serif">A little room to explore -- HOME demo</text></svg>'], { type: 'image/svg+xml' });
  const file = new Blob(['Welcome to HOME.\nThis file lives only in your browser.\nTry uploading files, writing notes, completing tasks, and creating a test Vault.\n'], { type: 'text/plain' });
  return {
    version: 1, nextId: 100, user: { id: 1, username: 'demo', displayName: 'Explorer', role: 'admin', disabled: false, twoFactorEnabled: false, quotaOverride: null, createdAt: now }, applications,
    files: [{ id: 1, originalName: 'Welcome to HOME.txt', name: 'Welcome to HOME.txt', mimetype: 'text/plain', size: file.size, folderId: null, createdAt: now, deletedAt: null, blob: file }, { id: 5, originalName: 'A little room to explore.svg', name: 'A little room to explore.svg', mimetype: 'image/svg+xml', size: picture.size, folderId: null, createdAt: now, deletedAt: null, hasThumbnail: true, blob: picture }],
    folders: [], noteFolders: [],
    notes: [{ id: 2, title: 'Make yourself at home', content: '# Welcome home\n\nThis is the real HOME interface with a browser-only storage layer.\n\n- Upload a file in **HomeCloud**\n- Write a note here\n- Complete a task\n- Create a test vault in **HomeVault**\n\nYour changes survive refreshes on this browser. A different computer starts its own demo.\n', tags: ['welcome'], attachments: [], folderId: null, isFavorite: true, deletedAt: null, createdAt: now, updatedAt: now, versions: [] }],
    tasks: [{ id: 3, title: 'Explore your HOME', notes: 'Open the apps from the dashboard and try them out.', priority: 'medium', dueDate: new Date().toISOString().slice(0, 10), repeat: 'none', projectId: 4, isDone: false, completedAt: null, reminderAt: null, reminderState: null, createdAt: now, updatedAt: now }],
    projects: [{ id: 4, name: 'Getting started', createdAt: now, updatedAt: now }], albums: [], favorites: [], vault: null, items: [], activity: [], notifications: []
  };
}
export async function handle(state, request, base = '/home/') {
  try { return await route(state, request, base); }
  catch (error) { if (error.status) return json({ error: error.message }, error.status); throw error; }
}
async function route(s, request, base) {
  const url = new URL(request.url);
  const p = url.pathname.slice((base + 'demo-api').length);
  const q = url.searchParams;
  const method = request.method;
  const write = method !== 'GET';
  let body = {};
  if (write && request.headers.get('content-type')?.includes('application/json')) body = await request.json();
  const now = stamp();
  const create = (rows, defaults = {}) => { const row = { ...defaults, ...body, id: s.nextId++, createdAt: now, updatedAt: now }; rows.push(row); return row; };
  const remove = (rows, row) => rows.splice(rows.indexOf(row), 1);
  const quota = () => ({ usedBytes: s.files.reduce((n, f) => n + f.size, 0), quotaBytes: 1024 ** 3 });
  const event = action => s.activity.unshift({ id: s.nextId++, action, eventType: action, applicationSlug: p.split('/')[1], createdAt: now, metadata: {} });
  if (p === '/demo/status') return json({ demo: true });
  if (p === '/demo/reset' && method === 'POST') { Object.assign(s, seed(base)); return json({ ok: true }); }
  if (p === '/auth/registration' && method === 'GET') return json({ requiresSetupCode: false, ownerCreated: true });
  if (['/auth/login', '/auth/register'].includes(p) && method === 'POST') {
    // Credentials are never stored. All sign-ins enter the same local sandbox.
    valid(body.username, 'Demo name');
    s.user.username = body.username.trim(); s.user.displayName = body.username.trim();
    return json({ token: 'browser-demo', user: s.user });
  }
  if (!request.headers.get('authorization') && !/\/(download|thumbnail|stream)$/.test(p)) return json({ error: 'Sign in to the local demo.' }, 401);
  if (p === '/auth/me' || p === '/core/users/me') {
    if (write) s.user.displayName = valid(body.displayName, 'Display name');
    return json(p === '/auth/me' ? s.user : { user: s.user });
  }
  if (p === '/auth/logout-everywhere') return json({ ok: true });
  if (p === '/auth/change-password' || p.startsWith('/auth/2fa/')) return json({ error: 'Account passwords and two-factor authentication require a real HomeCore server. Demo sign-in is simulated.' }, 501);
  if (p === '/core/users/me/sessions') return json({ sessions: [{ id: 'demo', createdAt: now, lastSeenAt: now, userAgent: 'This browser demo' }] });
  if (p === '/core/health') return json({ status: 'healthy', checks: { database: 'healthy', storage: 'healthy' } });
  if (p === '/core/system') return json({ version: '1.6.2 · browser demo', uptimeSeconds: 0, platform: 'browser' });
  if (p === '/core/permissions') return json({ permissions: [] });
  if (p.includes('/activity')) return json(p.startsWith('/core') ? { events: s.activity.slice(0, Number(q.get('limit') || 50)) } : { activity: s.activity.slice(0, 50) });
  if (p === '/core/notifications') return json({ notifications: s.notifications });
  if (p.startsWith('/core/notifications/')) { find(s.notifications, p.split('/')[3]).readAt = now; return json({ ok: true }); }
  if (p === '/core/delegations') return json({ grants: [] });
  const demoCatalog = () => seed(base).applications.map(app => {
    const row = s.applications.find(item => item.slug === app.slug && item.installed !== false);
    return { ...app, manifestVersion: 1, installed: !!row, enabled: !!row?.enabled,
      dependencies: ['homemedia', 'homenotes'].includes(app.slug) ? ['homecloud'] : [], permissions: [] };
  });
  const requireDependencies = (slug, enabled = false) => {
    for (const dependency of demoCatalog().find(app => app.slug === slug)?.dependencies || []) {
      if (!s.applications.some(app => app.slug === dependency && app.installed !== false && (!enabled || app.enabled))) fail(`Install${enabled ? ' and enable' : ''} ${dependency} first.`, 409);
    }
  };
  if (p === '/core/app-catalog' && method === 'GET') return json({ applications: demoCatalog() });
  if (/^\/core\/apps\/[^/]+\/install$/.test(p) && method === 'POST') {
    const slug = p.split('/')[3], manifest = demoCatalog().find(app => app.slug === slug) || fail('Application not available.', 404);
    if (Object.keys(body).length) fail('Install accepts no manifest overrides.');
    if (manifest.installed) fail('Application already installed.', 409);
    requireDependencies(slug);
    let app = s.applications.find(item => item.slug === slug);
    if (app) Object.assign(app, manifest, { installed: true, enabled: false });
    else { app = { ...manifest, id: s.nextId++, installed: true, enabled: false }; s.applications.push(app); }
    return json({ application: app }, 201);
  }
  if (p === '/core/apps') {
    if (method === 'POST') fail('Installing external apps requires a HOME server.', 501);
    return json({ applications: s.applications.filter(app => app.installed !== false) });
  }
  if (p.startsWith('/core/apps/')) {
    const app = s.applications.find(a => a.installed !== false && (match(a.id, p.split('/')[3]) || a.slug === p.split('/')[3])) || fail('App not found.', 404);
    if (method === 'PATCH') {
      if (body.enabled === true) requireDependencies(app.slug, true);
      if (body.enabled === false && demoCatalog().some(item => item.dependencies.includes(app.slug) && item.installed && item.enabled)) fail('Disable dependent applications first.', 409);
      if (typeof body.enabled === 'boolean') app.enabled = body.enabled;
    } else if (method === 'DELETE') {
      if (app.slug === 'homecloud') fail('HomeCloud is the storage foundation.');
      app.installed = false; app.enabled = false;
      return json({ ok: true, dataPreserved: true });
    }
    return json({ application: app });
  }
  if (p === '/admin/users' || p === '/core/admin/users') return json({ users: [{ ...s.user, ...quota() }] });
  if (p.startsWith('/admin/users/')) fail('Multi-user administration requires a HOME server.', 501);
  if (p.startsWith('/homebridge/')) {
    if (p === '/homebridge/automation' && method === 'GET') return json({ available: false, enabled: false, enrolled: false, reason: 'Background automation requires a server.' });
    if (p === '/homebridge/search') {
      const term = String(body.query || '').toLowerCase();
      return json({ limit: 20, groups: (body.sources || []).filter(source => ['homenotes', 'hometasks'].includes(source)).map(source => ({ source, name: source === 'homenotes' ? 'Notes' : 'Tasks', status: 'ok', limited: false, results: (source === 'homenotes' ? s.notes.filter(active) : s.tasks).filter(row => (row.title + (row.content || row.notes || '')).toLowerCase().includes(term)).slice(0, 20).map(row => ({ id: row.id, title: row.title, excerpt: (row.content || row.notes || '').slice(0, 160), href: base + (source === 'homenotes' ? 'notes/#/notes/' : 'tasks/#/?task=') + row.id })) })) });
    }
    fail('Background automation requires a HOME server.', 501);
  }
  if (p.startsWith('/homevault/admin/')) {
    if (method === 'DELETE') { if (body.confirmation !== 'DELETE ' + s.user.id || body.vaultId !== s.vault?.id) fail('Check the vault and confirm the account id.'); s.vault = null; s.items = []; return json({ ok: true }); }
    return json(s.vault ? { exists: true, vaultId: s.vault.id } : { exists: false });
  }
  if (p === '/homevault/vault') {
    if (method === 'GET') return json(s.vault ? { exists: true, vault: s.vault } : { exists: false });
    if (method === 'DELETE') { s.vault = null; s.items = []; return json({ ok: true }); }
    if (method === 'POST') {
      if (s.vault) fail('A vault already exists.', 409);
      for (const f of ['kdfSalt', 'wrappedKeyMaster', 'wrappedKeyMasterIv', 'wrappedKeyRecovery', 'wrappedKeyRecoveryIv', 'verifier', 'verifierIv']) valid(body[f], f);
      s.vault = { ...body, id: s.nextId++, createdAt: now, updatedAt: now }; return json({ vault: s.vault }, 201);
    }
  }
  if (p === '/homevault/vault/rewrap' || p === '/homevault/vault/regenerate-recovery') {
    if (!s.vault) fail('Create a vault first.', 404);
    const fields = p.endsWith('/rewrap') ? ['kdfSalt', 'kdfParams', 'wrappedKeyMaster', 'wrappedKeyMasterIv'] : ['wrappedKeyRecovery', 'wrappedKeyRecoveryIv'];
    for (const f of fields) if (!body[f]) fail('Missing ' + f);
    for (const f of fields) s.vault[f] = body[f];
    s.vault.updatedAt = now; return json({ vault: s.vault });
  }
  if (p.startsWith('/homevault/vault/items')) {
    if (!s.vault) fail('Create a vault first.', 404);
    const [, , , , id, action] = p.split('/');
    if (!id) {
      if (method === 'GET') return json({ items: s.items.filter(i => Boolean(i.deletedAt) === (q.get('trash') === 'true')) });
      if (!['login', 'note', 'card'].includes(body.type)) fail('Invalid item type.');
      for (const f of ['encryptedTitle', 'encryptedTitleIv', 'encryptedData', 'encryptedDataIv']) valid(body[f], f);
      return json({ item: create(s.items, { deletedAt: null }) }, 201);
    }
    const item = find(s.items, id);
    if (action === 'restore') item.deletedAt = null;
    else if (action === 'permanent' && method === 'DELETE') remove(s.items, item);
    else if (method === 'DELETE') item.deletedAt = now;
    else if (method === 'PATCH') { for (const f of ['type', 'encryptedTitle', 'encryptedTitleIv', 'encryptedData', 'encryptedDataIv']) if (body[f] !== undefined) item[f] = body[f]; item.updatedAt = now; }
    return json({ item });
  }
  if (p === '/homecloud/files/quota') return json(quota());
  if (p === '/homecloud/files/upload' || p === '/homemedia/upload') {
    const form = await request.formData(); const blob = form.get('file');
    if (!(blob instanceof Blob)) fail('Choose a file.');
    if (blob.size > 100 * 1024 ** 2) fail('The browser demo supports files up to 100 MB.');
    const file = { id: s.nextId++, originalName: blob.name || 'Attachment', name: blob.name || 'Attachment', mimetype: blob.type || 'application/octet-stream', size: blob.size, folderId: form.get('folderId') ? Number(form.get('folderId')) : null, createdAt: now, deletedAt: null, blob };
    s.files.push(file); event('file.uploaded'); return json({ file: clean(file) }, 201);
  }
  if (p === '/homecloud/files' || p === '/homecloud/files/trash') return json({ files: s.files.filter(f => p.endsWith('/trash') ? !!f.deletedAt : active(f) && match(f.folderId, q.get('folderId'))).map(clean), breadcrumb: breadcrumb(s.folders, q.get('folderId')) });
  if (p === '/homecloud/files/shares') return json({ shares: [] });
  if (p.startsWith('/homecloud/files/')) {
    const [, , , id, action] = p.split('/');
    if (id === 'download-batch') fail('Download files individually in the browser demo.', 501);
    const file = find(s.files, id);
    if (action === 'share') fail('Public sharing needs a server. This file exists only in this browser.', 501);
    if (action === 'download' || action === 'thumbnail') return binary(file, action === 'download', request);
    if (action === 'restore') file.deletedAt = null;
    else if (action === 'permanent' && method === 'DELETE') remove(s.files, file);
    else if (action === 'move') file.folderId = body.folderId || null;
    else if (method === 'DELETE') file.deletedAt = now;
    return json({ file: clean(file) });
  }
  if (p.startsWith('/homecloud/folders') || p.startsWith('/homenotes/note-folders')) {
    const rows = p.startsWith('/homecloud') ? s.folders : s.noteFolders;
    const [, , , id, action] = p.split('/');
    if (method === 'GET') return json({ folders: (!id ? rows.filter(r => match(r.parentId, q.get('parentId'))) : rows), breadcrumb: breadcrumb(rows, q.get('parentId')) });
    if (!id) return json({ folder: create(rows, { name: valid(body.name), parentId: body.parentId || null }) }, 201);
    const folder = find(rows, id);
    if (method === 'DELETE') {
      if (rows.some(f => match(f.parentId, id)) || (rows === s.folders ? s.files : s.notes).some(f => match(f.folderId, id))) fail('Move the contents out before deleting this demo folder.');
      remove(rows, folder);
    } else {
      if (body.name !== undefined) folder.name = valid(body.name);
      if (body.parentId !== undefined) {
        if (breadcrumb(rows, body.parentId).some(f => match(f.id, id))) fail('A folder cannot be moved inside itself.');
        folder.parentId = body.parentId || null;
      }
    }
    return json({ folder });
  }
  if (p === '/homenotes/tags') return json({ tags: [...new Set(s.notes.filter(active).flatMap(n => n.tags))].map(name => ({ name, count: s.notes.filter(n => active(n) && n.tags.includes(name)).length })) });
  if (p.startsWith('/homenotes/notes')) {
    const [, , , id, action, subId, subAction] = p.split('/');
    if (!id || id === 'trash') {
      if (method === 'POST') { valid(body.title || 'Untitled'); return json({ note: clean(create(s.notes, { title: 'Untitled', content: '', folderId: null, tags: [], attachments: [], isFavorite: false, deletedAt: null, versions: [] })) }, 201); }
      let notes = s.notes.filter(n => id === 'trash' ? !!n.deletedAt : active(n));
      if (q.has('folderId')) notes = notes.filter(n => match(n.folderId, q.get('folderId')));
      if (q.get('favorite') === 'true' || q.get('favorites') === 'true') notes = notes.filter(n => n.isFavorite);
      if (q.get('tag')) notes = notes.filter(n => n.tags.includes(q.get('tag')));
      if (q.get('search')) notes = notes.filter(n => (n.title + n.content).toLowerCase().includes(q.get('search').toLowerCase()));
      return json({ notes: notes.map(n => ({ ...clean(n), excerpt: n.content.slice(0, 160) })) });
    }
    const note = find(s.notes, id);
    if (action === 'restore') note.deletedAt = null;
    else if (action === 'permanent' && method === 'DELETE') remove(s.notes, note);
    else if (action === 'versions') {
      if (method === 'GET') return json({ versions: note.versions });
      const version = find(note.versions, subId); note.title = version.title; note.content = version.content;
    } else if (action === 'attachments') {
      if (method === 'DELETE') note.attachments = note.attachments.filter(a => !match(a.fileId, subId));
      else if (subId === 'link') { find(s.files, body.fileId); note.attachments.push({ fileId: body.fileId, name: body.name, addedAt: now }); }
      else {
        const form = await request.formData(); const file = form.get('file');
        if (!(file instanceof Blob)) fail('Choose a file.');
        const stored = { id: s.nextId++, blob: file, originalName: file.name, name: file.name, mimetype: file.type, size: file.size, folderId: null, createdAt: now, deletedAt: null };
        s.files.push(stored); note.attachments.push({ fileId: stored.id, name: file.name, addedAt: now });
      }
    } else if (method === 'DELETE') note.deletedAt = now;
    else if (method === 'PATCH') {
      if (body.title !== undefined || body.content !== undefined) note.versions.unshift({ id: s.nextId++, title: note.title, content: note.content, createdAt: now });
      for (const f of ['title', 'content', 'tags', 'isFavorite', 'folderId']) if (body[f] !== undefined) note[f] = body[f];
      note.updatedAt = now;
    }
    if (write) event('note.updated');
    return json({ note: clean(note) });
  }
  if (p === '/hometasks/reminders/status') return json({ available: false });
  if (p === '/hometasks/summary') {
    const tasks = s.tasks.filter(t => !t.isDone), today = q.get('today');
    return json({ open: tasks.length, overdue: tasks.filter(t => t.dueDate && t.dueDate < today).length, dueToday: tasks.filter(t => t.dueDate === today).length });
  }
  if (p.startsWith('/hometasks/projects')) {
    const id = p.split('/')[3];
    if (!id) {
      if (method === 'POST') { valid(body.name); return json({ project: create(s.projects) }, 201); }
      return json({ projects: s.projects.map(p => ({ ...p, openCount: s.tasks.filter(t => match(t.projectId, p.id) && !t.isDone).length, taskCount: s.tasks.filter(t => match(t.projectId, p.id)).length })) });
    }
    const project = find(s.projects, id);
    if (method === 'DELETE') { remove(s.projects, project); s.tasks.filter(t => match(t.projectId, id)).forEach(t => t.projectId = null); }
    else project.name = valid(body.name);
    return json({ project });
  }
  if (p.startsWith('/hometasks/tasks')) {
    const [, , , id, action] = p.split('/');
    if (!id) {
      if (method === 'POST') { valid(body.title, 'Title'); return json({ task: create(s.tasks, { notes: '', priority: 'none', dueDate: null, repeat: 'none', projectId: null, isDone: false, completedAt: null, reminderAt: null, reminderState: null }) }, 201); }
      let tasks = s.tasks.filter(t => q.get('status') === 'all' || t.isDone === (q.get('status') === 'done'));
      if (q.get('scope') === 'assigned') tasks = []; // One simulated account; no real sharing in the demo.
      if (q.has('projectId')) tasks = tasks.filter(t => match(t.projectId, q.get('projectId')));
      const today = q.get('today'), due = q.get('due');
      if (due) tasks = tasks.filter(t => due === 'none' ? !t.dueDate : t.dueDate && (due === 'overdue' ? t.dueDate < today : due === 'today' ? t.dueDate === today : t.dueDate > today));
      if (q.get('search')) tasks = tasks.filter(t => (t.title + t.notes).toLowerCase().includes(q.get('search').toLowerCase()));
      return json({ tasks });
    }
    const task = find(s.tasks, id); let next = null;
    if (method === 'DELETE') remove(s.tasks, task);
    else if (action === 'complete') {
      if (!task.isDone && task.repeat !== 'none' && task.dueDate) {
        const date = new Date(task.dueDate + 'T12:00:00Z'); const today = q.get('today') || new Date().toISOString().slice(0, 10);
        do { if (task.repeat === 'monthly') date.setUTCMonth(date.getUTCMonth() + 1); else if (task.repeat === 'yearly') date.setUTCFullYear(date.getUTCFullYear() + 1); else date.setUTCDate(date.getUTCDate() + (task.repeat === 'weekly' ? 7 : 1)); } while (date.toISOString().slice(0, 10) <= today || task.repeat === 'weekdays' && [0, 6].includes(date.getUTCDay()));
        next = { ...task, id: s.nextId++, dueDate: date.toISOString().slice(0, 10), createdAt: now, updatedAt: now }; s.tasks.push(next);
      }
      task.isDone = true; task.completedAt = now;
    } else if (action === 'reopen') { task.isDone = false; task.completedAt = null; }
    else if (method === 'PATCH') { for (const f of ['title', 'notes', 'priority', 'dueDate', 'repeat', 'projectId']) if (body[f] !== undefined) task[f] = body[f]; }
    if (write) { task.updatedAt = now; event('task.updated'); }
    return json({ task, next });
  }
  if (p.startsWith('/homemedia/')) return media(s, p, q, method, body, base, request, create, remove);
  if (p === '/homemonitor/status') return json({ at: Date.now(), alertsEnabled: false, alerts: [], system: { cpuPercent: 12, memory: { percent: 25, usedBytes: 2 * 1024 ** 3, totalBytes: 8 * 1024 ** 3 }, loadAverage: [0.12, 0.18, 0.2], uptimeSeconds: 86400, network: null }, disks: [{ label: 'Simulated server', usedPercent: 20, usedBytes: 20 * 1024 ** 3, totalBytes: 100 * 1024 ** 3 }], services: s.applications.map(a => ({ slug: a.slug, name: a.name, status: a.enabled ? 'up' : 'disabled', latencyMs: 0, detail: 'Simulated · browser demo' })), backups: { status: 'unknown', sources: [], detail: 'No server backups run in the browser demo.' } });
  if (p === '/homemonitor/history') return json({ hours: 24, samples: Array.from({ length: 24 }, (_, i) => ({ t: Math.floor(Date.now() / 1000) - (23 - i) * 3600, cpu: 12 + Math.sin(i) * 5, memory: 25 + Math.sin(i / 3) * 2 })) });
  if (p === '/homemonitor/disk-growth') return json({ days: 90, disks: [] });
  fail('This feature needs a HOME server and is not available in the browser demo.', 501);
}
function breadcrumb(rows, id) {
  const result = [], seen = new Set();
  while (id) { if (seen.has(String(id))) break; seen.add(String(id)); const row = rows.find(r => match(r.id, id)); if (!row) break; result.unshift(clean(row)); id = row.parentId; }
  return result;
}
function binary(file, download, request) {
  const blob = file.blob instanceof Blob ? file.blob : new Blob([file.blob], { type: file.mimetype });
  const headers = { 'Content-Type': file.mimetype || blob.type || 'application/octet-stream', 'Accept-Ranges': 'bytes', 'X-Content-Type-Options': 'nosniff' };
  if (download) headers['Content-Disposition'] = `attachment; filename*=UTF-8''${encodeURIComponent(file.originalName)}`;
  const range = request.headers.get('range')?.match(/^bytes=(\d+)-(\d*)$/);
  if (range) { const start = Number(range[1]), end = Math.min(Number(range[2] || blob.size - 1), blob.size - 1); if (start > end) return new Response(null, { status: 416 }); headers['Content-Range'] = `bytes ${start}-${end}/${blob.size}`; return new Response(blob.slice(start, end + 1), { status: 206, headers }); }
  return new Response(blob, { headers });
}
function media(s, p, q, method, body, base, request, create, remove) {
  const library = () => s.files.filter(f => active(f) && /^(image|video|audio)\//.test(f.mimetype));
  const expose = f => ({ ...clean(f), isFavorite: s.favorites.includes(f.id), favorited: s.favorites.includes(f.id), kind: f.mimetype.split('/')[0], hasThumbnail: f.mimetype.startsWith('image/') });
  if (p === '/homemedia/upload-folder') return json({ folderId: null });
  if (p === '/homemedia/library') {
    let files = library();
    if (q.get('type')) files = files.filter(f => f.mimetype.startsWith(q.get('type') + '/'));
    if (q.get('favorites') === 'true' || q.get('favorite') === 'true') files = files.filter(f => s.favorites.includes(f.id));
    if (q.get('albumId')) files = files.filter(f => find(s.albums, q.get('albumId')).fileIds.includes(f.id));
    if (q.get('search')) files = files.filter(f => f.originalName.toLowerCase().includes(q.get('search').toLowerCase()));
    return json({ files: files.map(expose), items: files.map(expose), total: files.length, hasMore: false });
  }
  if (p.startsWith('/homemedia/favorites/')) { const file = find(s.files, p.split('/')[3]); s.favorites = s.favorites.filter(id => id !== file.id); if (method === 'POST') s.favorites.push(file.id); return json({ favorited: method === 'POST' }); }
  if (p.startsWith('/homemedia/albums')) {
    const [, , , id, action, fileId] = p.split('/');
    const summary = a => ({ ...a, itemCount: a.fileIds.filter(id => library().some(f => f.id === id)).length, count: a.fileIds.length });
    if (!id) { if (method === 'GET') return json({ albums: s.albums.map(summary) }); valid(body.name); return json({ album: summary(create(s.albums, { fileIds: [], coverFileId: null })) }, 201); }
    const album = find(s.albums, id);
    if (action === 'items') { if (method === 'POST') album.fileIds = [...new Set([...album.fileIds, ...body.fileIds])]; else album.fileIds = album.fileIds.filter(id => !match(id, fileId)); }
    else if (method === 'DELETE') remove(s.albums, album);
    else if (method === 'PATCH') { if (body.name !== undefined) album.name = valid(body.name); if (body.coverFileId !== undefined) album.coverFileId = body.coverFileId; }
    return json({ album: summary(album) });
  }
  const [, , id, action] = p.split('/'); const file = find(s.files, id);
  if (action === 'thumbnail' || action === 'stream') return binary(file, false, request);
  if (action === 'ticket') return json({ url: base + 'demo-api/homemedia/' + id + '/stream' });
  if (action === 'exif') return json({ exif: null });
  fail('This media feature requires a server.', 501);
}
