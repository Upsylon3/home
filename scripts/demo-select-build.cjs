// Runs only from the merged/default-branch deployment workflow, never from downloaded artifacts.
module.exports = async ({ github, context, core }) => {
  const { owner, repo } = context.repo;
  const target = context.payload.pull_request?.merge_commit_sha || context.sha;
  const branch = await github.rest.repos.getBranch({ owner, repo, branch: 'main' });
  if (branch.data.commit.sha !== target) throw new Error('This deployment has been superseded by a newer main commit. Verify the latest main, then deploy it.');
  let source = context.payload.pull_request?.head.sha;
  if (!source) {
    const associated = await github.rest.repos.listPullRequestsAssociatedWithCommit({ owner, repo, commit_sha: target });
    source = associated.data.find(pr => pr.merged_at && pr.merge_commit_sha === target && pr.base.ref === 'main')?.head.sha || target;
  }
  for (const candidate of [...new Set([source, target])]) {
  const runs = await github.rest.actions.listWorkflowRuns({ owner, repo, workflow_id: 'demo.yml', head_sha: candidate, status: 'success', per_page: 100 });
  for (const run of runs.data.workflow_runs) {
    if (run.head_sha !== candidate || run.conclusion !== 'success' || !['pull_request', 'workflow_dispatch'].includes(run.event)) continue;
    const artifacts = await github.rest.actions.listWorkflowRunArtifacts({ owner, repo, run_id: run.id });
    const artifact = artifacts.data.artifacts.find(a => a.name === 'home-browser-demo-' + run.run_attempt && !a.expired);
    if (!artifact) continue;
    core.setOutput('run', String(run.id)); core.setOutput('attempt', String(run.run_attempt));
    core.setOutput('artifact', String(artifact.id)); core.setOutput('source', candidate);
    core.info('Reusing checked demo artifact from workflow run ' + run.id);
    return;
  }
  }
  throw new Error('No retained successful demo build matches this source. Run Browser demo on main, then rerun Deploy browser demo.');
};
