const { HOMECORE_URL } = require("@home/homecore-client");

const SOURCES = [
  { slug: "homecloud", name: "HomeCloud", env: "HOMECLOUD_BACKEND_INTERNAL_URL", path: "/api/homecloud/files/all" },
  { slug: "homemedia", name: "HomeMedia", env: "HOMEMEDIA_BACKEND_INTERNAL_URL" },
  { slug: "homenotes", name: "HomeNotes", env: "HOMENOTES_BACKEND_INTERNAL_URL", path: "/api/homenotes/notes" },
  { slug: "hometasks", name: "HomeTasks", env: "HOMETASKS_BACKEND_INTERNAL_URL", path: "/api/hometasks/tasks" }
];

function baseUrl(source) {
  const defaults = {
    homecloud: "http://homecloud-backend:4500",
    homemedia: "http://homemedia-backend:4200",
    homenotes: "http://homenotes-backend:4400",
    hometasks: "http://hometasks-backend:4700"
  };
  return (process.env[source.env] || defaults[source.slug]).replace(/\/$/, "");
}

async function getJson(url, token) {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    signal: AbortSignal.timeout(4500)
  });
  if (!response.ok) throw new Error(`upstream returned ${response.status}`);
  return response.json();
}

function addQuery(url, values) {
  const target = new URL(url);
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== null && value !== "") target.searchParams.set(key, String(value));
  }
  return target.toString();
}

function toResult(source, kind, item, title, description, updatedAt, href, sourceId = item.id) {
  return {
    id: `${source}:${kind}:${item.id}`,
    source,
    kind,
    title: String(title || "Untitled"),
    description: description ? String(description).slice(0, 220) : "",
    updatedAt: updatedAt || null,
    href,
    sourceId: String(sourceId)
  };
}

async function searchHomeCloud({ query, limit, token }) {
  const source = SOURCES[0];
  const data = await getJson(
    addQuery(`${baseUrl(source)}${source.path}`, { search: query, limit }),
    token
  );
  const files = Array.isArray(data.files) ? data.files : [];
  return {
    results: files.map((file) =>
      toResult(
        "homecloud",
        "file",
        file,
        file.name,
        [file.mimetype, Number.isFinite(file.size) ? `${file.size.toLocaleString("en-US")} bytes` : ""].filter(Boolean).join(" · "),
        file.createdAt,
        "/cloud/"
      )
    ),
    truncated: Boolean(data.truncated)
  };
}

async function searchHomeMedia({ query, limit, token }) {
  const source = SOURCES[1];
  const root = baseUrl(source);
  const [library, albums] = await Promise.all([
    getJson(addQuery(`${root}/api/homemedia/library`, { search: query, limit }), token),
    getJson(`${root}/api/homemedia/albums`, token)
  ]);
  const files = Array.isArray(library.files) ? library.files.slice(0, limit) : [];
  const matchingAlbums = (Array.isArray(albums.albums) ? albums.albums : [])
    .filter((album) => album.name?.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
    .slice(0, limit);

  const results = files.map((file) =>
    toResult(
      "homemedia",
      file.kind || "media",
      file,
      file.name,
      [file.kind, file.mimetype].filter(Boolean).join(" · "),
      file.createdAt,
      "/media/"
    )
  );
  for (const album of matchingAlbums) {
    results.push(
      toResult("homemedia", "album", album, album.name, `${album.itemCount} items`, album.updatedAt, "/media/")
    );
  }
  results.sort((a, b) => {
    const left = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
    const right = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
    return (Number.isFinite(right) ? right : 0) - (Number.isFinite(left) ? left : 0);
  });
  return { results: results.slice(0, limit), truncated: results.length > limit };
}

async function searchHomeNotes({ query, limit, token }) {
  const source = SOURCES[2];
  const data = await getJson(addQuery(`${baseUrl(source)}${source.path}`, { search: query }), token);
  const notes = Array.isArray(data.notes) ? data.notes.slice(0, limit) : [];
  return {
    results: notes.map((note) =>
      toResult("homenotes", "note", note, note.title, note.excerpt, note.updatedAt, "/notes/")
    ),
    truncated: notes.length >= limit
  };
}

async function searchHomeTasks({ query, limit, token }) {
  const source = SOURCES[3];
  const data = await getJson(
    addQuery(`${baseUrl(source)}${source.path}`, { search: query, status: "all", limit }),
    token
  );
  const tasks = Array.isArray(data.tasks) ? data.tasks.slice(0, limit) : [];
  return {
    results: tasks.map((task) =>
      toResult(
        "hometasks",
        "task",
        task,
        task.title,
        [task.completedAt ? "Completed" : "Open", task.priority && task.priority !== "none" ? `${task.priority} priority` : "", task.dueDate ? `Due ${task.dueDate}` : ""]
          .filter(Boolean)
          .join(" · "),
        task.updatedAt || task.completedAt || task.createdAt,
        "/tasks/"
      )
    ),
    truncated: tasks.length >= limit
  };
}

const SEARCHERS = {
  homecloud: searchHomeCloud,
  homemedia: searchHomeMedia,
  homenotes: searchHomeNotes,
  hometasks: searchHomeTasks
};

async function searchAll({ query, limit, token }) {
  const registry = await getJson(`${HOMECORE_URL}/api/core/apps`, token);
  const installed = new Map(
    (Array.isArray(registry.applications) ? registry.applications : []).map((application) => [application.slug, application])
  );

  const outcomes = await Promise.all(
    SOURCES.map(async (source) => {
      const application = installed.get(source.slug);
      if (!application) {
        return { source, status: "not_installed", results: [], truncated: false };
      }
      if (!application.enabled) {
        return { source, status: "disabled", results: [], truncated: false };
      }
      try {
        const result = await SEARCHERS[source.slug]({ query, limit, token });
        return { source, status: "available", ...result };
      } catch {
        // A single optional app being offline must not break search across the ecosystem.
        return { source, status: "unavailable", results: [], truncated: false };
      }
    })
  );

  const mediaFileIds = new Set(
    outcomes
      .filter((outcome) => outcome.source.slug === "homemedia")
      .flatMap((outcome) => outcome.results.filter((result) => result.kind !== "album").map((result) => result.sourceId))
  );

  const results = outcomes.flatMap((outcome) => {
    if (outcome.source.slug === "homecloud") {
      return outcome.results.filter((result) => !mediaFileIds.has(result.sourceId));
    }
    return outcome.results;
  });

  results.sort((a, b) => {
    const left = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
    const right = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
    return (Number.isFinite(right) ? right : 0) - (Number.isFinite(left) ? left : 0);
  });

  const publicResults = results.map(({ sourceId, ...result }) => result);
  return {
    query,
    total: publicResults.length,
    results: publicResults,
    sources: outcomes.map((outcome) => ({
      slug: outcome.source.slug,
      name: outcome.source.name,
      status: outcome.status,
      count: outcome.results.length,
      truncated: Boolean(outcome.truncated)
    }))
  };
}

module.exports = { searchAll };
