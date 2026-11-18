export function uploadPath(path) {
  const parts = String(path).split('/');
  if (parts.some((part, index) => !part || part === '.' || part === '..' || /[\\\0]/.test(part) ||
    (index < parts.length - 1 && (part.length > 100 || part.trim() !== part))) || parts.length > 32) {
    throw new Error('Unsupported folder path. Use names of 1–100 characters without path separators, leading/trailing spaces or dot segments.');
  }
  return parts;
}

export function selectedFiles(files) {
  return Array.from(files || []).map(file => {
    const path = file.webkitRelativePath || file.name;
    uploadPath(path);
    return { file, path };
  });
}

export async function droppedFiles(transfer, limit = 1000) {
  // Capture entries synchronously while the browser still exposes the drop.
  const entries = Array.from(transfer.items || []).filter(item => item.kind === 'file').map(item => item.webkitGetAsEntry?.());
  if (!entries.length || entries.some(entry => !entry)) return selectedFiles(transfer.files);
  const result = [];
  async function walk(entry, parent = '') {
    const path = parent + entry.name;
    uploadPath(path);
    if (entry.isFile) {
      const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
      result.push({ file, path });
      if (result.length > limit) throw new Error(`Select at most ${limit} files at once.`);
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      for (;;) {
        const batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
        if (!batch.length) break;
        for (const child of batch) await walk(child, path + '/');
      }
    }
  }
  for (const entry of entries) await walk(entry);
  return result;
}

// Match SQLite NOCASE (ASCII), without accidentally merging Unicode names.
const folded = name => name.replace(/[A-Z]/g, char => char.toLowerCase());
export function folderResolver(api, rootId, checkSession = () => {}) {
  const folders = new Map();
  let loaded;
  const key = (parent, name) => `${parent ?? 'root'}\0${folded(name)}`;
  return async path => {
    const parts = uploadPath(path).slice(0, -1);
    let parent = rootId ?? null;
    if (!parts.length) return parent;
    checkSession();
    loaded ||= api.listAll().then(({ data }) => {
      for (const folder of data.folders) folders.set(key(folder.parentId, folder.name), Promise.resolve(folder.id));
    }).catch(error => { loaded = null; throw error; });
    await loaded;
    for (const name of parts) {
      checkSession();
      const slot = key(parent, name);
      if (!folders.has(slot)) {
        const parentId = parent;
        const creating = api.create(name, parentId).then(({ data }) => data.folder.id).catch(async error => {
          // Another upload/tab may have created it after the initial list.
          checkSession();
          const { data } = await api.list(parentId);
          const existing = data.folders.find(folder => folded(folder.name) === folded(name));
          if (existing) return existing.id;
          throw error;
        });
        folders.set(slot, creating);
        creating.catch(() => { if (folders.get(slot) === creating) folders.delete(slot); });
      }
      parent = await folders.get(slot);
    }
    checkSession();
    return parent;
  };
}

export function createUploadQueue({ run, onChange, onSuccess, onIdle, concurrency = 3, limit = 1000 }) {
  let items = [], running = 0, sequence = 0, disposed = false, idleReported = true;
  const emit = () => { if (!disposed) onChange(items.map(({ file, resolveFolder, token, controller, ...item }) => ({ ...item }))); };
  function pump() {
    if (disposed) return;
    for (const item of items) {
      if (running >= concurrency) break;
      if (item.status !== 'queued') continue;
      item.status = 'uploading'; item.controller = new AbortController(); running++;
      Promise.resolve().then(() => run(item, pct => { item.pct = pct; emit(); }, item.controller.signal))
        .then(result => { if (!item.controller.signal.aborted) { item.status = 'completed'; item.pct = 100; item.file = null; if (!disposed) onSuccess?.(result); } })
        .catch(error => { item.status = item.controller.signal.aborted ? 'cancelled' : 'failed'; item.error = error.message; })
        .finally(() => { running--; if (item.controller.signal.aborted) item.status = 'cancelled'; emit(); pump(); });
    }
    emit();
    if (!running && !items.some(item => item.status === 'queued') && !idleReported) { idleReported = true; onIdle?.(); }
  }
  return {
    add(entries, metadata = {}) {
      if (items.length + entries.length > limit) throw new Error(`Keep at most ${limit} files in the queue. Clear completed uploads before adding more.`);
      entries.forEach(entry => uploadPath(entry.path));
      items.push(...entries.map(entry => ({ ...entry, ...metadata, id: ++sequence, status: 'queued', pct: 0, error: '' })));
      idleReported = false; pump();
    },
    retry(id) { const item = items.find(item => item.id === id); if (item?.file && ['failed', 'cancelled'].includes(item.status)) { item.status = 'queued'; item.error = ''; item.pct = 0; idleReported = false; pump(); } },
    cancel(id) { const item = items.find(item => item.id === id); if (item?.status === 'queued') item.status = 'cancelled'; else if (item?.status === 'uploading') item.controller.abort(); emit(); pump(); },
    clearCompleted() { items = items.filter(item => item.status !== 'completed'); emit(); },
    resume() { disposed = false; },
    dispose() { disposed = true; for (const item of items) { item.controller?.abort(); if (item.status === 'queued') item.status = 'cancelled'; } }
  };
}
