'use strict';
// Read-only evidence check. A CI pass alone does not prove a deployment.
function backendProvenanceDecision(evidence) {
  const blockers = [];
  if (!evidence || evidence.schemaVersion !== 1)
    return { allowed: false, blockers: ['missing-backend-evidence'] };
  if (evidence.repository !== 'memoryalwaysbibo/BXH_ARENA_Functions_Production' ||
      evidence.projectId !== 'bxh-arena') blockers.push('backend-target-mismatch');
  if (!/^[a-f0-9]{40}$/.test(evidence.sourceCommit || '')) blockers.push('invalid-backend-commit');
  const run = evidence.run;
  if (!run || !Number.isSafeInteger(run.id) || run.id <= 0 ||
      run.head_sha !== evidence.sourceCommit || run.status !== 'completed' ||
      run.conclusion !== 'success') blockers.push('backend-run-unverified');
  const jobs = evidence.jobs;
  if (!Array.isArray(jobs) || !jobs.length || jobs.some(job =>
      !job || !run || job.run_id !== run.id || job.status !== 'completed' || job.conclusion !== 'success'))
    blockers.push('backend-jobs-unverified');
  const steps = Array.isArray(jobs) ? jobs.flatMap(job => Array.isArray(job?.steps) ? job.steps : []) : [];
  for (const [target, name] of [
    ['rules', 'Deploy Production Firestore Rules'],
    ['functions', 'Deploy Production Functions']
  ]) {
    if (!steps.some(step => step.name === name && step.status === 'completed' && step.conclusion === 'success'))
      blockers.push('backend-' + target + '-not-deployed');
  }
  // Deployment logs and runtime identity must still be reconciled separately.
  if (evidence.runtimeReconciled !== true) blockers.push('backend-runtime-unreconciled');
  return { allowed: blockers.length === 0, blockers };
}
module.exports = { backendProvenanceDecision };
