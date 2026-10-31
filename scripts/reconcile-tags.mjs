#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const VERSION = "1.6.2";
const TAG = `v${VERSION}`;
const EXPECTED_ORPHAN = {
  name: "v0.8.1",
  ref: "b75198c52ee81c1e8186dd6a01a25ef75faa3055",
  target: "ac6ab27ff5366c5a3722edfea9fae0323c525abe",
};
const LEGACY_LIGHTWEIGHT = {
  name: "v1.1.5",
  target: "3bcbaaa21446be3acc17c37d9ccc5301fe5b7c2b",
};

function git(args, options = {}) {
  return execFileSync("git", args, {
    encoding: "utf8",
    stdio: options.quiet ? ["ignore", "ignore", "ignore"] : ["ignore", "pipe", "pipe"],
  }).trim();
}
function gitExists(args) {
  try { git(args, { quiet: true }); return true; } catch { return false; }
}
function fail(message) {
  console.error(`Tag reconciliation stopped: ${message}`);
  process.exit(1);
}
function parseRemoteTags() {
  const output = git(["ls-remote", "--tags", "origin"]);
  const refs = new Map();
  for (const line of output.split(/\r?\n/).filter(Boolean)) {
    const [sha, ref] = line.split(/\s+/);
    const peeled = ref.endsWith("^{}");
    const name = ref.replace(/^refs\/tags\//, "").replace(/\^\{\}$/, "");
    const item = refs.get(name) ?? {};
    item[peeled ? "peeled" : "direct"] = sha;
    refs.set(name, item);
  }
  return refs;
}
function localTag(name) {
  const ref = `refs/tags/${name}`;
  if (!gitExists(["show-ref", "--verify", "--quiet", ref])) return null;
  return { type: git(["cat-file", "-t", ref]), target: git(["rev-parse", `${ref}^{commit}`]) };
}
function createAnnotatedTag(name, target, message, force) {
  const local = localTag(name);
  if (local && local.type === "tag" && local.target === target) {
    if (force) git(["push", "--force", "origin", `refs/tags/${name}`]);
    else git(["push", "origin", `refs/tags/${name}`]);
    return;
  }
  if (local) git(["tag", "-d", name]);
  git(["tag", "-a", "-f", name, target, "-m", message]);
  git(force
    ? ["push", "--force", "origin", `refs/tags/${name}`]
    : ["push", "origin", `refs/tags/${name}`]);
}
function isAncestor(older, newer) {
  try { git(["merge-base", "--is-ancestor", older, newer], { quiet: true }); return true; }
  catch (error) {
    if (error?.status === 1) return false;
    throw error;
  }
}

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const mode = process.argv[2];
if (mode === "--verify-only") {
  if (pkg.version !== VERSION) fail(`expected root version ${VERSION}, found ${pkg.version}`);
  execFileSync("node", ["scripts/validate-release.mjs", TAG, "."], { stdio: "ignore" });
  console.log("Release baseline and changelog metadata are internally consistent.");
  process.exit(0);
}
if (pkg.version !== VERSION) {
  console.log(`Skipping one-time reconciliation: current ecosystem version is ${pkg.version}, not ${VERSION}.`);
  process.exit(0);
}
if (git(["status", "--porcelain"])) fail("the checkout is not clean");
const head = git(["rev-parse", "HEAD"]);
const remoteMainLine = git(["ls-remote", "origin", "refs/heads/main"]).split(/\s+/)[0];
if (!remoteMainLine || remoteMainLine !== head) {
  fail("checkout is not the exact current origin/main commit");
}
execFileSync("node", ["scripts/validate-release.mjs", TAG, "."], { stdio: "ignore" });

let refs = parseRemoteTags();
const orphan = refs.get(EXPECTED_ORPHAN.name);
if (orphan) {
  if (orphan.direct !== EXPECTED_ORPHAN.ref || orphan.peeled !== EXPECTED_ORPHAN.target) {
    fail(`remote ${EXPECTED_ORPHAN.name} no longer matches the audited orphan; refusing to delete it`);
  }
  if (isAncestor(EXPECTED_ORPHAN.target, head)) {
    fail(`${EXPECTED_ORPHAN.name} unexpectedly became reachable from main; refusing to delete it`);
  }
  git(["push", "origin", `:${"refs/tags/" + EXPECTED_ORPHAN.name}`]);
  if (gitExists(["show-ref", "--verify", "--quiet", `refs/tags/${EXPECTED_ORPHAN.name}`])) {
    git(["tag", "-d", EXPECTED_ORPHAN.name]);
  }
  console.log("Removed the audited, unreachable v0.8.1 orphan tag.");
} else {
  console.log("The audited v0.8.1 orphan tag is already absent.");
}

refs = parseRemoteTags();
const legacy = refs.get(LEGACY_LIGHTWEIGHT.name);
if (legacy?.peeled === LEGACY_LIGHTWEIGHT.target) {
  console.log("v1.1.5 is already annotated on its original commit.");
} else if (!legacy || (legacy.direct === LEGACY_LIGHTWEIGHT.target && !legacy.peeled)) {
  createAnnotatedTag(LEGACY_LIGHTWEIGHT.name, LEGACY_LIGHTWEIGHT.target,
    "Release v1.1.5", Boolean(legacy));
  console.log("Normalized v1.1.5 to an annotated tag on the same commit.");
} else {
  fail("v1.1.5 no longer points to its audited release commit; refusing to move it");
}

refs = parseRemoteTags();
const current = refs.get(TAG);
if (current?.peeled && current.peeled !== head && !isAncestor(current.peeled, head)) {
  fail(`${TAG} exists but is not reachable from current main; refusing to move it`);
}
if (current?.peeled) {
  console.log(`${TAG} already exists as an annotated tag on reachable history; leaving it unchanged.`);
} else if (current?.direct === head) {
  createAnnotatedTag(TAG, head, `Release ${TAG}`, true);
  console.log(`Converted ${TAG} to an annotated tag on the same current commit.`);
} else if (!current) {
  createAnnotatedTag(TAG, head, `Release ${TAG}`, false);
  console.log(`Created annotated ${TAG} on ${head}.`);
} else {
  fail(`${TAG} already exists with an unexpected target; refusing to overwrite it`);
}

refs = parseRemoteTags();
const finalTag = refs.get(TAG);
if (!finalTag?.peeled || !isAncestor(finalTag.peeled, head)) {
  fail(`post-push verification failed for ${TAG}`);
}
console.log("Legacy tag reconciliation completed; no historical commit was rewritten.");
