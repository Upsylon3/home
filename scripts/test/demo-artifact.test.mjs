import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { verifyMetadata, verifySite } from '../demo-artifact.mjs';
const selectBuild = createRequire(import.meta.url)('../demo-select-build.cjs');
const expected = { tree: 'a'.repeat(40), head: 'b'.repeat(40), run: '123', attempt: '2', base: '/home/' };
test('deployment refuses stale source trees, wrong heads, attempts and repository paths', () => {
  verifyMetadata({ schema: 1, ...expected }, expected);
  for (const key of Object.keys(expected)) assert.throws(() => verifyMetadata({ schema: 1, ...expected, [key]: 'wrong' }, expected), /mismatch/);
  assert.throws(() => verifyMetadata({ schema: 2, ...expected }, expected));
});
test('deployment accepts static files and rejects links escaping the artifact', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'home-demo-artifact-'));
  try {
    await mkdir(path.join(root, 'site')); await mkdir(path.join(root, 'outside'));
    await writeFile(path.join(root, 'site', 'index.html'), '<h1>Demo</h1>');
    await verifySite(path.join(root, 'site'));
    await symlink(path.join(root, 'outside'), path.join(root, 'site', 'escape'), 'junction');
    await assert.rejects(() => verifySite(path.join(root, 'site')), /links/);
  } finally { assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir(), 'home-demo-artifact-'))); await rm(root, { recursive: true, force: true }); }
});
function fake({ expired = false, conclusion = 'success', head = expected.head, target = expected.tree } = {}) {
  const outputs = {};
  return { outputs, github: { rest: { repos: { getBranch: async () => ({ data: { commit: { sha: target } } }) }, actions: {
    listWorkflowRuns: async () => ({ data: { workflow_runs: [{ id: 123, head_sha: head, conclusion, event: 'pull_request', run_attempt: 2 }] } }),
    listWorkflowRunArtifacts: async () => ({ data: { artifacts: [{ id: 456, name: 'home-browser-demo-2', expired }] } })
  } } }, context: { repo: { owner: 'owner', repo: 'home' }, payload: { pull_request: { merge_commit_sha: expected.tree, head: { sha: expected.head } } } }, core: { setOutput: (key, value) => outputs[key] = value, info: () => {} } };
}
test('deployment selects only successful retained artifacts for the merged PR head', async () => {
  const good = fake(); await selectBuild(good); assert.equal(good.outputs.artifact, '456');
  for (const change of [{ expired: true }, { conclusion: 'failure' }, { head: 'c'.repeat(40) }, { target: 'd'.repeat(40) }]) await assert.rejects(() => selectBuild(fake(change)));
});

test('manual recovery can use a freshly checked main artifact after the PR artifact expired', async () => {
  const recovery = fake();
  recovery.context.payload = {};
  recovery.context.sha = expected.tree;
  recovery.github.rest.repos.listPullRequestsAssociatedWithCommit = async () => ({ data: [{ merged_at: 'now', merge_commit_sha: expected.tree, base: { ref: 'main' }, head: { sha: expected.head } }] });
  recovery.github.rest.actions.listWorkflowRuns = async ({head_sha}) => ({data: {workflow_runs: head_sha === expected.tree ? [{id: 124, head_sha: expected.tree, conclusion: 'success', event: 'workflow_dispatch', run_attempt: 2}] : []}});
  await selectBuild(recovery);
  assert.equal(recovery.outputs.source, expected.tree);
  assert.equal(recovery.outputs.run, '124');
});
