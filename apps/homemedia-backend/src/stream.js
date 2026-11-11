// Lets a browser PLAY a file (video, music, animated GIF) instead of first
// downloading all of it.
//
// The problem this solves: <video>, <audio> and <img> tags can't send an
// "Authorization" header, and the frontend's old workaround (fetch the whole
// file with the header, turn it into a blob, hand that to the tag) means
// nothing plays until every byte has arrived, no seeking works, and a big
// video eats the browser's memory. That workaround was also what made the
// viewer look like it was "loading forever".
//
// The fix is a "ticket": the frontend asks (WITH its normal login) for a
// ticket for ONE file, and gets back a random, meaningless string. The tag
// then loads /api/homemedia/stream/<ticket>, and this file looks up who the
// ticket belongs to and streams the file from HomeCloud on their behalf.
//
// Why a ticket and not the login token in the URL: a URL ends up in browser
// history and server logs. A ticket only opens one file, expires, and is
// worthless without this server remembering it — so a leaked one is a far
// smaller problem than a leaked login token.
const crypto = require("crypto");
const express = require("express");
const { Readable, Transform } = require("stream");
const { asyncHandler } = require("./asyncHandler");
const { openFileStream } = require("./homecloudClient");
const { createPosterBudget, reservePosterRead } = require('./posterBudget');

// ticket -> { token, fileId, expiresAt }. Held in memory on purpose: a
// ticket is a convenience, not data. If this container restarts, tickets
// vanish and the frontend simply asks for a new one (see MediaView.jsx).
const tickets = new Map();

// Each use pushes the expiry forward again, so a three-hour film keeps
// working as long as it keeps being watched, while an abandoned ticket
// dies two hours after its last use.
const TICKET_TTL_MS = 2 * 60 * 60 * 1000;
const MAX_TICKETS = 5000; // sanity cap so a buggy client can't grow this forever

function issueTicket(token, fileId, poster = false) {
  if (tickets.size >= MAX_TICKETS) {
    // Drop the oldest (Maps iterate in insertion order).
    tickets.delete(tickets.keys().next().value);
  }
  const id = crypto.randomBytes(24).toString("base64url"); // 192 bits: not guessable
  const budget = poster ? createPosterBudget() : null;
  tickets.set(id, { token, fileId, expiresAt: budget?.expiresAt ?? Date.now() + TICKET_TTL_MS, budget });
  return id;
}

// Housekeeping: forget expired tickets once a minute. unref() so this timer
// never keeps the process (or a test run) alive on its own.
setInterval(() => {
  const now = Date.now();
  for (const [id, t] of tickets) if (t.expiresAt <= now) tickets.delete(id);
}, 60_000).unref();

// ---- Authenticated half: "give me a ticket for this file" -------------
// Mounted behind requireAuth in app.js.
const ticketRouter = express.Router();

const ticketHandler = poster => asyncHandler(async (req, res) => {
    const fileId = Number(req.params.fileId);
    if (!Number.isInteger(fileId)) return res.status(400).json({ error: "Invalid file id." });

    // Make sure the file really is this person's before handing out a
    // ticket: ask HomeCloud for just the first byte. HomeCloud 404s for
    // anything that isn't theirs, so no extra ownership code lives here.
    const probe = await openFileStream(req.token, fileId, { range: "bytes=0-0", signal: AbortSignal.timeout(5000) });
    probe.body?.cancel().catch(() => {});
    if (probe.status === 404) return res.status(404).json({ error: "File not found." });
    if (!probe.ok && probe.status !== 416) return res.status(502).json({ error: "Couldn't reach HomeCloud." });

    res.set('Cache-Control', 'no-store').json({ url: `/api/homemedia/stream/${issueTicket(req.token, fileId, poster)}` });
  });
ticketRouter.post('/:fileId/ticket', ticketHandler(false));
ticketRouter.post('/:fileId/poster-ticket', ticketHandler(true));

// ---- Public half: "play whatever this ticket is for" -------------------
// Mounted BEFORE requireAuth in app.js — the ticket itself is the
// credential, and a media tag has no way to send anything else.
const streamRouter = express.Router();

streamRouter.get(
  "/:ticket",
  asyncHandler(async (req, res) => {
    const ticket = tickets.get(req.params.ticket);
    if (!ticket || ticket.expiresAt <= Date.now()) {
      tickets.delete(req.params.ticket);
      return res.status(404).json({ error: "This link has expired. Reload to get a new one." });
    }
    if (!ticket.budget) ticket.expiresAt = Date.now() + TICKET_TTL_MS;
    let reservation;
    if (ticket.budget) {
      try { reservation = reservePosterRead(ticket.budget, req.headers.range); }
      catch (error) { return res.status(error.status).json({ error: error.message }); }
    }

    // If the viewer closes the tab or skips ahead, stop pulling bytes from
    // HomeCloud instead of downloading the rest of a video nobody watches.
    const abort = new AbortController();
    const deadline = ticket.budget ? setTimeout(() => abort.abort(), Math.max(1, ticket.expiresAt - Date.now())) : null;
    res.on("close", () => { clearTimeout(deadline); abort.abort(); });

    let upstream;
    try {
      upstream = await openFileStream(ticket.token, ticket.fileId, { range: reservation?.range || req.headers.range, signal: abort.signal });
    } catch (err) {
      if (err.name === "AbortError") { res.destroy(); return; }
      throw err;
    }

    if (upstream.status === 401) {
      upstream.body?.cancel().catch(() => {});
      // The login behind this ticket was revoked (signed out everywhere,
      // password changed...). The ticket must die with it.
      tickets.delete(req.params.ticket);
      return res.status(401).json({ error: "Your session has expired. Please sign in again." });
    }
    if (upstream.status === 404) { upstream.body?.cancel().catch(() => {}); return res.status(404).json({ error: "File not found." }); }
    // 200 = whole file, 206 = the slice the browser asked for, 416 = it
    // asked for a slice that doesn't exist. Anything else is a failure.
    if (![200, 206, 416].includes(upstream.status)) {
      upstream.body?.cancel().catch(() => {});
      return res.status(502).json({ error: "HomeCloud couldn't provide this file." });
    }
    if (reservation && (upstream.status === 200 || Number(upstream.headers.get('content-length')) > reservation.bytes)) {
      upstream.body?.cancel().catch(() => {});
      return res.status(502).json({ error: 'Cloud did not honor the bounded preview range.' });
    }

    res.status(upstream.status);
    // Copy only the headers that describe the bytes. Deliberately NOT
    // copied: HomeCloud's "Content-Disposition: attachment", which tells a
    // browser to save the file rather than show it.
    for (const name of ["content-type", "content-length", "content-range", "accept-ranges", "last-modified", "etag"]) {
      const value = upstream.headers.get(name);
      if (value) res.setHeader(name, value);
    }
    res.setHeader("Content-Disposition", "inline");
    // Uploaded HTML/SVG must never become an active same-origin document when
    // someone opens a bearer link directly. Media elements still decode bytes.
    res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader("Cache-Control", reservation ? 'private, no-store' : "private, max-age=3600");

    if (!upstream.body) return res.end();
    let source = Readable.fromWeb(upstream.body);
    if (reservation) {
      let remaining = reservation.bytes;
      const bounded = new Transform({ transform(chunk, _encoding, done) {
        if (chunk.length > remaining) return done(new Error('Preview byte limit exceeded.'));
        remaining -= chunk.length; done(null, chunk);
      } });
      source.on('error', error => bounded.destroy(error));
      source = source.pipe(bounded);
    }
    source
      .on("error", () => res.destroy()) // upstream died mid-file: cut the connection so the browser can retry
      .pipe(res);
  })
);

module.exports = { ticketRouter, streamRouter };
