#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const VERSION = "1.6.2";
const RELEASE_TAG = `v${VERSION}`;
const ORPHAN = {
  name: "v0.8.1",
  tagObject: "b75198c52ee81c1e8186dd6a01a25ef75faa3055",
  target: "ac6ab27ff5366c5a3722edfea9fae0323c525abe",
};
const ARCHIVE = {
  name: "archive/orphaned-v0.8.1",
  target: "ac6ab27ff5366c5a3722edfea9fae0323c525abe",
};
const LEGACY = {
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
    git(force
      ? ["push", "--force", "origin", `refs/tags/${name}`]
      : ["push", "origin", `refs/tags/${name}`]);
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
function requireVersionConsistency() {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
  if (pkg.version !== VERSION) fail(`root package.json is ${pkg.version}, expected ${VERSION}`);
  if (lock.version !== VERSION || lock.packages?.[""]?.version !== VERSION) {
    fail("root package-lock.json version fields do not match package.json");
  }
  execFileSync("node", ["scripts/validate-release.mjs", RELEASE_TAG, "."], { stdio: "ignore" });
}

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
if (process.argv[2] === "--verify-only") {
  requireVersionConsistency();
  console.log("Release baseline, package lock and changelog metadata are consistent.");
  process.exit(0);
}
if (pkg.version !== VERSION) {
  console.log(`Skipping one-time reconciliation: current ecosystem version is ${pkg.version}, not ${VERSION}.`);
  process.exit(0);
}
if (git(["status", "--porcelain"])) fail("the checkout is not clean");
const head = git(["rev-parse", "HEAD"]);
const remoteMain = git(["ls-remote", "origin", "refs/heads/main"]).split(/\s+/)[0];
if (!remoteMain || remoteMain !== head) fail("checkout is not the exact current origin/main commit");
requireVersionConsistency();

// Preflight every known ref before mutating any of them. An unexpected ref
// causes a clean stop before the first deletion or force update.
let refs = parseRemoteTags();
const orphan = refs.get(ORPHAN.name);
if (orphan && (orphan.direct !== ORPHAN.tagObject || orphan.peeled !== ORPHAN.target)) {
  fail(`remote ${ORPHAN.name} no longer matches the audited orphan; refusing to rename it`);
}
if (orphan && isAncestor(ORPHAN.target, head)) {
  fail(`${ORPHAN.name} unexpectedly became reachable from main; refusing to rename it`);
}
const archive = refs.get(ARCHIVE.name);
if (archive && archive.peeled !== ARCHIVE.target && archive.direct !== ARCHIVE.target) {
  fail(`remote ${ARCHIVE.name} already exists with an unexpected target`);
}
const legacy = refs.get(LEGACY.name);
if (legacy && legacy.peeled !== LEGACY.target && !(legacy.direct === LEGACY.target && !legacy.peeled)) {
  fail(`remote ${LEGACY.name} no longer points to its audited commit`);
}
const release = refs.get(RELEASE_TAG);
if (release?.peeled && release.peeled !== head && !isAncestor(release.peeled, head)) {
  fail(`${RELEASE_TAG} exists outside current main history; refusing to move it`);
}
if (release?.direct && !release.peeled && release.direct !== head) {
  fail(`${RELEASE_TAG} is a lightweight tag on an unexpected commit`);
}

// Preserve the old orphaned commit under a clearly non-release archival ref,
// then remove the misleading SemVer release name.
if (orphan) {
  if (!archive?.peeled) {
    createAnnotatedTag(
      ARCHIVE.name,
      ARCHIVE.target,
      "Archive orphaned v0.8.1 release commit; this commit was never merged into main.",
      Boolean(archive)
    );
  }
  git(["push", "origin", `:${"refs/tags/" + ORPHAN.name}`]);
  if (gitExists(["show-ref", "--verify", "--quiet", `refs/tags/${ORPHAN.name}`])) {
    git(["tag", "-d", ORPHAN.name]);
  }
  console.log("Archived the unreachable v0.8.1 commit and removed its misleading release tag.");
} else {
  console.log("The v0.8.1 release ref is already absent.");
}
refs = parseRemoteTags();
const archived = refs.get(ARCHIVE.name);
if (!archived?.peeled || archived.peeled !== ARCHIVE.target) {
  fail("post-reconciliation verification failed for archive/orphaned-v0.8.1");
}

// Normalize v1.1.5 to an annotated tag without changing its commit target.
if (legacy?.peeled === LEGACY.target) {
  console.log("v1.1.5 is already annotated on its original commit.");
} else if (!legacy || (legacy.direct === LEGACY.target && !legacy.peeled)) {
  createAnnotatedTag(LEGACY.name, LEGACY.target, "Release v1.1.5", Boolean(legacy));
  console.log("Normalized v1.1.5 to an annotated tag on the same commit.");
} else {
  fail("v1.1.5 changed unexpectedly during reconciliation");
}

// Publish the corrected current baseline once. On later main pushes, leave
// an already-valid v1.6.2 tag at its original release commit; never move it.
refs = parseRemoteTags();
const current = refs.get(RELEASE_TAG);
if (current?.peeled) {
  console.log(`${RELEASE_TAG} is already annotated; leaving its immutable target unchanged.`);
} else if (current?.direct === head) {
  createAnnotatedTag(RELEASE_TAG, head, `Release ${RELEASE_TAG}`, true);
  console.log(`Converted ${RELEASE_TAG} to an annotated tag on the current commit.`);
} else if (!current) {
  createAnnotatedTag(RELEASE_TAG, head, `Release ${RELEASE_TAG}`, false);
  console.log(`Created annotated ${RELEASE_TAG} on ${head}.`);
} else {
  fail(`${RELEASE_TAG} already exists with an unexpected target`);
}

refs = parseRemoteTags();
const finalRelease = refs.get(RELEASE_TAG);
if (!finalRelease?.peeled || !isAncestor(finalRelease.peeled, head)) {
  fail(`post-push verification failed for ${RELEASE_TAG}`);
}
console.log("Legacy tag reconciliation completed; no historical commit was rewritten.");
