#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";

const [tag, rootArg = "."] = process.argv.slice(2);
if (!tag) {
  console.error("Usage: validate-release.mjs vX.Y.Z [repository-root]");
  process.exit(2);
}

const match = /^v(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)$/.exec(tag);
if (!match) {
  console.error(`Invalid stable release tag "${tag}". Expected vMAJOR.MINOR.PATCH.`);
  process.exit(1);
}

const root = resolve(rootArg);
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const version = match.slice(1).join(".");
if (pkg.version !== version) {
  console.error(`Tag ${tag} does not match root package.json version ${pkg.version}.`);
  process.exit(1);
}

const changelog = readFileSync(join(root, "CHANGELOG.md"), "utf8");
const headings = [...changelog.matchAll(/^## \[([^\]]+)\][^\r\n]*$/gm)];
const versionHeadings = headings.filter((heading) => heading[1] !== "Unreleased");
if (versionHeadings[0]?.[1] !== version) {
  console.error(
    `The newest versioned CHANGELOG.md entry is ${versionHeadings[0]?.[1] ?? "missing"}, ` +
    `not ${version}. Keep the root version and newest changelog entry aligned.`
  );
  process.exit(1);
}

const matches = versionHeadings.filter((heading) => heading[1] === version);
if (matches.length !== 1) {
  console.error(`CHANGELOG.md must contain exactly one heading for ${version}.`);
  process.exit(1);
}

const heading = matches[0];
const bodyStart = heading.index + heading[0].length;
const nextHeading = /^## \[/gm;
nextHeading.lastIndex = bodyStart;
const next = nextHeading.exec(changelog);
const notes = changelog.slice(bodyStart, next ? next.index : changelog.length).trim();
if (!notes) {
  console.error(`CHANGELOG.md section for ${version} is empty; refusing to publish.`);
  process.exit(1);
}

process.stdout.write(notes + "\n");
