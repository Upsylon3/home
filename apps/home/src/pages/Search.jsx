import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api.js";
import { timeAgo } from "../utils.js";

const SOURCE_NAMES = {
  homecloud: "HomeCloud",
  homemedia: "HomeMedia",
  homenotes: "HomeNotes",
  hometasks: "HomeTasks"
};

const STATUS_LABELS = {
  available: "Available",
  disabled: "Disabled",
  not_installed: "Not installed",
  unavailable: "Temporarily unavailable"
};

export default function SearchPage() {
  const [params, setParams] = useSearchParams();
  const routeQuery = params.get("q") || "";
  const [query, setQuery] = useState(routeQuery);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setQuery(routeQuery);
    if (routeQuery.length < 2) {
      setData(null);
      setLoading(false);
      setError("");
      return undefined;
    }

    let cancelled = false;
    setLoading(true);
    setError("");
    api.globalSearch(routeQuery)
      .then(({ data: result }) => {
        if (!cancelled) setData(result);
      })
      .catch((err) => {
        if (!cancelled) {
          setData(null);
          setError(err.message || "Search is temporarily unavailable.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [routeQuery]);

  function submit(event) {
    event.preventDefault();
    const next = query.trim();
    if (next.length < 2) {
      setError("Enter at least two characters to search.");
      return;
    }
    setParams({ q: next });
  }

  return (
    <main className="page">
      <header className="page-header">
        <p className="page-eyebrow">HomeBridge · Across your apps</p>
        <h1 className="page-title">Search everything</h1>
        <p className="page-subtitle">
          Find files, photos, notes and tasks from one place. Results follow each app's existing access rules.
        </p>
      </header>

      <form className="global-search-form" onSubmit={submit} role="search">
        <label className="global-search-label" htmlFor="global-search">Search your HOME</label>
        <div className="global-search-controls">
          <input
            id="global-search"
            className="global-search-input"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Try a filename, note or task…"
            minLength={2}
            maxLength={100}
            autoComplete="off"
          />
          <button className="btn btn-primary" type="submit" disabled={loading}>
            {loading ? "Searching…" : "Search"}
          </button>
        </div>
        <p className="global-search-hint">Search is live and read-only. HomeVault is intentionally excluded.</p>
      </form>

      {error && <div className="error-banner" role="alert">{error}</div>}
      {loading && <p className="global-search-message" role="status">Searching enabled apps…</p>}

      {!loading && data && (
        <>
          <section className="global-search-sources" aria-label="Search source status">
            <div className="global-search-summary">
              <h2 className="section-heading">Results</h2>
              <span className="global-search-total">{data.total} found</span>
            </div>
            <div className="status-strip">
              {data.sources.map((source) => (
                <div className="status-pill" key={source.slug} title={STATUS_LABELS[source.status]}>
                  <span className={`status-dot ${source.status === "available" ? "healthy" : source.status === "unavailable" ? "degraded" : "pending"}`} />
                  <span className="status-label">{SOURCE_NAMES[source.slug] || source.name}</span>
                  <span className="global-search-source-count">{source.status === "available" ? source.count : STATUS_LABELS[source.status]}</span>
                </div>
              ))}
            </div>
          </section>

          {data.results.length === 0 ? (
            <div className="list-panel">
              <div className="empty-state">
                <span className="glyph">?</span>
                No matching items were found.
              </div>
            </div>
          ) : (
            <div className="global-search-results">
              {data.results.map((result) => (
                <a className="global-search-result" href={result.href} key={result.id}>
                  <div className="global-search-result-copy">
                    <div className="global-search-result-meta">
                      <span className="list-row-app">{SOURCE_NAMES[result.source] || result.source}</span>
                      <span className="global-search-kind">{result.kind}</span>
                    </div>
                    <h3>{result.title}</h3>
                    {result.description && <p>{result.description}</p>}
                  </div>
                  <span className="list-row-time">{timeAgo(result.updatedAt)}</span>
                </a>
              ))}
            </div>
          )}
        </>
      )}

      {!routeQuery && !loading && (
        <div className="global-search-welcome">
          <span className="global-search-welcome-mark" aria-hidden="true">⌕</span>
          <p>One search across the things you have stored in HOME.</p>
        </div>
      )}
    </main>
  );
}
