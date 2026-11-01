import { useEffect, useRef, useState } from "react";
import { api } from "../api.js";

export default function Search() {
  const [query, setQuery] = useState("");
  const [sources, setSources] = useState(["homenotes", "hometasks"]);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const active = useRef(null);
  useEffect(() => () => active.current?.abort(), []);

  function choose(source, checked) {
    setSources(current => checked ? [...current, source] : current.filter(value => value !== source));
    setResult(null);
  }

  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    active.current = new AbortController();
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const { data } = await api.search(query.trim(), sources, active.current.signal);
      setResult(data);
    } catch (err) {
      if (err.name !== "AbortError") setError("Search is unavailable. HomeBridge may be stopped. Try again, or search inside Notes and Tasks.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="page bridge-search">
      <header className="page-header">
        <p className="page-eyebrow">HomeBridge</p>
        <h1 className="page-title">Search notes and tasks</h1>
        <p className="page-subtitle">Find your own notes and tasks, then open them in their app. Vault contents are never searched.</p>
      </header>
      <form onSubmit={submit}>
        <div className="field">
          <label htmlFor="bridge-query">Search text</label>
          <input id="bridge-query" value={query} minLength={2} maxLength={200} required disabled={busy}
            onChange={event => { setQuery(event.target.value); setResult(null); }} />
        </div>
        <fieldset disabled={busy} className="bridge-sources">
          <legend>Search in</legend>
          {[["homenotes", "Notes"], ["hometasks", "Tasks"]].map(([source, name]) => (
            <label key={source}>
              <input type="checkbox" checked={sources.includes(source)} onChange={event => choose(source, event.target.checked)} />
              {name}
            </label>
          ))}
        </fieldset>
        <button className="btn btn-primary" disabled={busy || sources.length === 0 || query.trim().length < 2}>
          {busy ? "Searching…" : "Search"}
        </button>
        <p className="page-subtitle">Only selected apps are queried when you submit. Queries and results are not saved.</p>
      </form>
      {error && <p className="error-banner" role="alert">{error}</p>}
      <div role="status" className="bridge-status">
        {busy ? "Searching selected apps…" : result ? `${result.groups.reduce((sum, group) => sum + group.results.length, 0)} results returned.` : ""}
      </div>
      {result?.groups.map(group => (
        <section key={group.source} className="section" aria-label={`${group.name} results`}>
          <h2 className="section-heading">{group.name}</h2>
          {group.status === "disabled" && <p>This app is not installed or is disabled. It was not searched.</p>}
          {group.status === "unavailable" && <p role="alert">This app could not be searched. Try again; other results are still available.</p>}
          {group.status === "ok" && group.results.length === 0 && <p>No matching items in this app.</p>}
          {group.limited && <p>Showing the first {result.limit} matches. Narrow your search for more specific results.</p>}
          <ul className="bridge-results">
            {group.results.map(item => (
              <li key={item.id}>
                <a href={item.href}><strong>{item.title || "Untitled"}</strong><span>{item.excerpt}</span></a>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </main>
  );
}
