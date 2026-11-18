import { useEffect, useMemo, useRef, useState } from 'react';
import { useBlocker } from 'react-router-dom';
import { api, getToken, setToken } from '../api.js';
import { createUploadQueue, droppedFiles, folderResolver, selectedFiles } from '../uploadQueue.js';

export default function UploadZone({ onUploaded, onError, onActivity, onSettled, folderId, showPicker = true }) {
  const inputRef = useRef(null), folderRef = useRef(null);
  const callbacks = useRef(null);
  callbacks.current = { onUploaded, onError, onActivity, onSettled };
  const [dragOver, setDragOver] = useState(false), [rows, setRows] = useState([]);
  const queue = useMemo(() => createUploadQueue({
    onChange: setRows,
    onSuccess: result => { callbacks.current.onActivity?.(); callbacks.current.onUploaded?.(result); },
    onIdle: () => callbacks.current.onSettled?.(),
    run: async (item, progress, signal) => {
      const check = () => { if (getToken() !== item.token) throw new Error('Your session changed. Reselect files after signing in.'); if (signal.aborted) throw new DOMException('Upload cancelled.', 'AbortError'); };
      check();
      const destination = await item.resolveFolder(item.path);
      check();
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        const abort = () => xhr.abort();
        signal.addEventListener('abort', abort, { once: true });
        const finish = callback => value => { signal.removeEventListener('abort', abort); callback(value); };
        const fail = finish(reject), done = finish(resolve);
        xhr.open('POST', '/api/homecloud/files/upload');
        if (item.token) xhr.setRequestHeader('Authorization', `Bearer ${item.token}`);
        xhr.upload.onprogress = event => { if (event.lengthComputable) progress(Math.round(event.loaded / event.total * 100)); };
        xhr.onerror = () => fail(new Error('Upload failed. Check your connection and retry.'));
        xhr.onabort = () => fail(new DOMException('Upload cancelled.', 'AbortError'));
        xhr.onload = () => {
          let body;
          try { body = JSON.parse(xhr.responseText); } catch { /* handled below */ }
          if (xhr.status === 401 && getToken() === item.token) { setToken(null); window.dispatchEvent(new CustomEvent('homecloud:session-expired')); }
          try { check(); } catch (error) { fail(error); return; }
          if (xhr.status >= 200 && xhr.status < 300 && body?.file) done({ ...body.file, folderId: destination });
          else fail(new Error(typeof body?.error === 'string' ? body.error : 'Upload failed.'));
        };
        const form = new FormData(); form.append('file', item.file, item.path.split('/').at(-1));
        if (destination != null) form.append('folderId', destination);
        xhr.send(form);
      });
    }
  }), []);
  const active = rows.some(row => ['queued', 'uploading'].includes(row.status));
  const blocker = useBlocker(active);
  useEffect(() => { queue.resume(); return () => queue.dispose(); }, [queue]);
  useEffect(() => {
    const unload = event => { if (active) { event.preventDefault(); event.returnValue = ''; } };
    const logout = event => { if (active && !window.confirm('Cancel pending uploads and sign out? Files already received by the server are kept.')) event.preventDefault(); };
    window.addEventListener('beforeunload', unload); window.addEventListener('homecloud:before-logout', logout);
    return () => { window.removeEventListener('beforeunload', unload); window.removeEventListener('homecloud:before-logout', logout); };
  }, [active]);
  function enqueue(entries) {
    try {
      if (!entries.length) throw new Error('No files found. Empty folders are not uploaded.');
      const token = getToken();
      const resolveFolder = folderResolver(api.folders, folderId, () => { if (getToken() !== token) throw new Error('Your session changed. Reselect files after signing in.'); });
      queue.add(entries, { token, resolveFolder });
    } catch (error) { onError?.(error.message); }
  }
  const canChooseFolder = typeof document !== 'undefined' && 'webkitdirectory' in document.createElement('input');
  return <section aria-label="Uploads">
    {blocker.state === 'blocked' && <div role="alertdialog" aria-label="Uploads are still running" className="error-banner">
      <p>Leaving cancels queued transfers. Files or folders already received by the server are kept.</p>
      <button className="btn btn-ghost" autoFocus onClick={() => blocker.reset()}>Keep uploading</button>
      <button className="btn btn-danger-ghost" onClick={() => { queue.dispose(); blocker.proceed(); }}>Cancel uploads and leave</button>
    </div>}
    {showPicker && <>
      <div className={`dropzone ${dragOver ? 'dragover' : ''}`} role="button" tabIndex={0} aria-label="Upload files"
        onClick={() => inputRef.current?.click()}
        onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); inputRef.current?.click(); } }}
        onDragOver={event => { event.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)}
        onDrop={event => { event.preventDefault(); setDragOver(false); droppedFiles(event.dataTransfer).then(enqueue).catch(error => onError?.(error.message)); }}>
        <div>Drop files or folders here, or click to browse files</div><div className="hint">up to 1 GB per file · 3 transfers at a time · up to 1000 queued files</div>
        <input ref={inputRef} type="file" multiple aria-label="Choose files" onChange={event => { try { enqueue(selectedFiles(event.target.files)); } catch (error) { onError?.(error.message); } event.target.value = ''; }} />
      </div>
      <button type="button" className="btn btn-ghost" disabled={!canChooseFolder} onClick={() => folderRef.current?.click()}>Choose folder</button>
      {!canChooseFolder && <p>Folder selection is unavailable in this browser. Use file selection instead.</p>}
      <input ref={folderRef} type="file" multiple webkitdirectory="" hidden aria-label="Choose folder files" onChange={event => { try { enqueue(selectedFiles(event.target.files)); } catch (error) { onError?.(error.message); } event.target.value = ''; }} />
    </>}
    {!!rows.length && <>
      <p role="status">{rows.filter(row => row.status === 'completed').length} completed · {rows.filter(row => row.status === 'failed').length} failed · {rows.filter(row => row.status === 'queued').length} queued</p>
      <p>Uploads keep their starting folder. Refreshing forgets this queue; completed files and created folders stay on the server.</p>
      <button className="btn btn-ghost btn-sm" onClick={() => queue.clearCompleted()}>Clear completed uploads</button>
      <ul style={{ paddingLeft: 20 }}>{rows.map(row => <li key={row.id} style={{ overflowWrap: 'anywhere', margin: '12px 0' }}>
        <span>{row.path} — {row.status}{row.status === 'uploading' ? ` (${row.pct}%)` : ''}</span>
        {row.error && <p>{row.error}</p>}
        {['failed', 'cancelled'].includes(row.status) && <button className="btn btn-ghost btn-sm" onClick={() => queue.retry(row.id)}>Retry {row.path}</button>}
        {['queued', 'uploading'].includes(row.status) && <button className="btn btn-ghost btn-sm" onClick={() => queue.cancel(row.id)}>Cancel {row.path}</button>}
      </li>)}</ul>
    </>}
  </section>;
}
