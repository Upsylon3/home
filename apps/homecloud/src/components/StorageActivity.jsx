import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { formatDate, describeActivity } from '../utils.js';

export default function StorageActivity({ admin = false }) {
  const [activity, setActivity] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  async function refresh() {
    setError(''); setLoading(true);
    try { setActivity((await (admin ? api.admin.activity() : api.myActivity())).data.activity); }
    catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { refresh(); }, [admin]);
  if (error) return <><p role="alert">{error}</p><button className="btn btn-ghost" disabled={loading} onClick={refresh}>Retry</button></>;
  if (loading || activity === null) return <p role="status">Loading activity…</p>;
  if (!activity.length) return <p>No storage activity yet.</p>;
  return <div style={{ overflowX: 'auto' }}><table className="file-table">
    <thead><tr>{admin && <th>Who</th>}<th>What</th><th>When</th></tr></thead>
    <tbody>{activity.slice(0, admin ? 200 : 15).map((entry, i) => <tr key={i}>
      {admin && <td className="file-name">{entry.username}</td>}
      <td className="file-meta">{describeActivity(entry)}</td>
      <td className="file-meta">{formatDate(entry.createdAt)}</td>
    </tr>)}</tbody>
  </table></div>;
}
