import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

// The shared-login module (src/session.js, a copy of design/session.js)
// only needs `localStorage`, so a tiny in-memory stand-in is enough — no
// browser or jsdom required.
function installFakeStorage() {
  const data = new Map();
  globalThis.localStorage = {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
    _data: data
  };
}

const { getToken, setToken } = await import("../src/session.js");

beforeEach(installFakeStorage);

test("a token saved by one app is what every other app reads", () => {
  setToken("abc");
  assert.equal(getToken(), "abc");
});

test("signing out clears the shared token", () => {
  setToken("abc");
  setToken(null);
  assert.equal(getToken(), null);
});

test("upgrade path: an old per-app token is adopted, and the old keys are cleaned up", () => {
  // Someone who was already signed in to HomeMedia before this change.
  localStorage.setItem("homemedia_token", "old-media-token");
  localStorage.setItem("home_token", "old-home-token");

  // One of the old tokens is adopted rather than lost (which one doesn't matter: all
  // of them belong to the same account).
  assert.ok(["old-media-token", "old-home-token"].includes(getToken()));
  assert.equal(localStorage.getItem("homemedia_token"), null);
  assert.equal(localStorage.getItem("home_token"), null);
});

test("signing out also removes any leftover per-app tokens, so nothing signs you back in", () => {
  localStorage.setItem("homevault_token", "stale");
  setToken(null);
  assert.equal(getToken(), null);
});

test("blocked storage behaves like being signed out instead of crashing", () => {
  globalThis.localStorage = {
    getItem() { throw new Error("blocked"); },
    setItem() { throw new Error("blocked"); },
    removeItem() { throw new Error("blocked"); }
  };
  assert.equal(getToken(), null);
  assert.doesNotThrow(() => setToken("abc"));
});
