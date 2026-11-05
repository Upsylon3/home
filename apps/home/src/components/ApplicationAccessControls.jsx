import { useState } from 'react';
import { api } from '../api.js';

const labels = {
  'files.read': 'Read my Cloud files and folders, including downloads and Trash',
  'files.write': 'Upload, move, rename and restore my Cloud files and folders',
  'files.delete': 'Delete my Cloud files and folders, including permanent deletion',
  'files.share': 'View, create and revoke public links to my Cloud files'
};
export default function ApplicationAccessControls() {
  const [data, setData] = useState(null), [selected, setSelected] = useState(''), [permissions, setPermissions] = useState([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [token, setToken] = useState(''), [notice, setNotice] = useState('');
  const app = data?.apps.find(app => app.slug === selected);
  async function refresh() {
    const [apps, access] = await Promise.all([api.apps.list(), api.applicationAccess.list()]);
    setData({ apps: apps.data.applications.filter(app => app.enabled && app.permissions.some(key => labels[key])), access: access.data.access });
  }
  async function load() {
    setBusy(true); setError('');
    try { await refresh(); }
    catch (error) { setError(error.message); }
    finally { setBusy(false); }
  }
  async function create(event) {
    event.preventDefault();
    if (busy || !app || !permissions.length) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await api.applicationAccess.create(app.slug, permissions);
      // Memory only: never persist an application key in browser storage.
      setToken(result.data.token);
      setNotice('Access key created. It expires in 30 days. Copy it now; it will not be shown again.');
      await refresh();
      setPermissions([]);
    } catch (error) { setError(error.message); }
    finally { setBusy(false); }
  }
  async function revoke(access) {
    if (!window.confirm(`Revoke ${access.applicationName}’s access key? It will stop working immediately.`)) return;
    setBusy(true); setError('');
    try { await api.applicationAccess.revoke(access.id); setToken(''); setNotice('Application access revoked.'); await refresh(); }
    catch (error) { setError(error.message); }
    finally { setBusy(false); }
  }
  return <section className="panel" aria-labelledby="application-access-title">
    <h3 id="application-access-title" className="panel-title">Application access</h3>
    <p className="panel-desc">Give a registered application limited access to your Cloud data with its own revocable key. Choose only what it needs. Keys cannot manage accounts or access Vault, Notes or Tasks.</p>
    <p className="panel-desc">Give the key only to the named application. Anyone holding it has the selected access. Your usual Home login stays separate; these keys do not sandbox the bundled browser apps.</p>
    {!data && <button className="btn btn-ghost btn-sm" type="button" disabled={busy} onClick={load}>{busy ? 'Loading application access…' : 'Manage application access'}</button>}
    {error && <div role="alert" className="error-banner">{error} <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={load}>Retry</button></div>}
    {data && <>
      {!data.apps.length ? <p>No enabled applications declare supported file permissions. Ask an administrator to install and enable the application first.</p> : <form onSubmit={create}>
        <div className="field"><label htmlFor="access-application">Application</label>
          <select id="access-application" value={selected} disabled={busy || !!token} onChange={event => { setSelected(event.target.value); setPermissions([]); }}>
            <option value="">Choose an application</option>
            {data.apps.map(app => <option value={app.slug} key={app.slug}>{app.name}</option>)}
          </select>
        </div>
        {app && <fieldset disabled={busy || !!token}><legend>Allow this application to:</legend>
          {app.permissions.filter(key => labels[key]).map(key => <label key={key} style={{ display: 'block', margin: '12px 0' }}>
            <input type="checkbox" checked={permissions.includes(key)} onChange={event => setPermissions(current => event.target.checked ? [...current, key] : current.filter(item => item !== key))} />{' '}{labels[key]}
          </label>)}
        </fieldset>}
        <p className="panel-desc">Applies only to your data. Expires after 30 days. Password changes, Sign out everywhere, account changes and disabling/uninstalling the app invalidate access.</p>
        <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !!token || !permissions.length}>Allow selected access and create key</button>
      </form>}
      <div role="status" aria-live="polite">{notice && <p>{notice}</p>}{busy && <p>Working…</p>}</div>
      {token && <div className="field"><label htmlFor="application-access-key">New access key</label>
        <textarea id="application-access-key" readOnly value={token} spellCheck={false} autoComplete="off" style={{ width: '100%', overflowWrap: 'anywhere' }} />
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setToken(''); setNotice('Key hidden. If you did not save it, revoke access and create another.'); }}>Hide key</button>
      </div>}
      <h4>Your application keys</h4>
      {!data.access.length && <p>You have not granted application access.</p>}
      {data.access.map(access => <div className="session-row" key={access.id} style={{ flexWrap: 'wrap', gap: 12 }}>
        <div><strong>{access.applicationName}</strong><p>{access.permissions.map(key => labels[key]).join('; ')}</p>
          <p>{access.status} · expires {new Date(access.expiresAt).toLocaleString()}</p></div>
        {access.status !== 'revoked' && <button type="button" className="btn btn-danger-ghost" disabled={busy} onClick={() => revoke(access)}>Revoke {access.applicationName} access</button>}
      </div>)}
    </>}
  </section>;
}
