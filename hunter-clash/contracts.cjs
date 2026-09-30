'use strict';
// Pure contracts only. No Firebase, UI registration or writes at import time.
const INTERNAL_ROLES = new Set(['staff', 'admin', 'super_admin']);
const STATES = Object.freeze({
  proposed: ['accepted', 'rejected', 'cancelled', 'expired'],
  accepted: ['in_progress', 'cancelled', 'expired'],
  in_progress: ['submitted', 'cancelled'],
  submitted: ['pending_verification', 'disputed'],
  pending_verification: ['verified', 'disputed', 'risk_hold'],
  risk_hold: ['pending_verification', 'voided'],
  disputed: ['pending_verification', 'voided'],
  verified: ['settled', 'risk_hold', 'voided'],
  settled: [], rejected: [], cancelled: [], expired: [], voided: []
});
Object.values(STATES).forEach(Object.freeze);
function usableActor(actor) {
  return !!actor && typeof actor.uid === 'string' && actor.uid.length > 0 &&
    actor.active === true && actor.deleted !== true &&
    !['frozen', 'disabled', 'deleted'].includes(actor.accountStatus);
}
// UX gating is advisory; trusted backend must independently enforce policy.
function entryDecision(config, actor, runtime) {
  if (!config || config.schemaVersion !== 1 || config.enabled !== true)
    return { allowed: false, reason: 'closed' };
  if (!runtime || !['sandbox', 'production'].includes(runtime.environment) ||
      runtime.environment !== config.environment || runtime.backendReady !== true)
    return { allowed: false, reason: 'environment-unverified' };
  if (!usableActor(actor)) return { allowed: false, reason: 'account-unavailable' };
  if (runtime.environment === 'production' && (actor.isTestAccount === true || actor.role === 'tester'))
    return { allowed: false, reason: 'test-account' };
  if (config.audience !== 'internal' || !INTERNAL_ROLES.has(actor.role))
    return { allowed: false, reason: 'audience-unavailable' };
  return { allowed: true, reason: 'internal' };
}
function assertRevision(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw Error('invalid-revision');
}
function assertTransition(current, next, revision, expectedRevision) {
  assertRevision(revision); assertRevision(expectedRevision);
  if (revision !== expectedRevision) throw Error('revision-conflict');
  if (!Object.hasOwn(STATES, current) || !STATES[current].includes(next))
    throw Error('invalid-transition');
  return revision + 1;
}
function settlementKey({ environment, challengeId, resultRevision, beneficiaryId, effectType }) {
  if (!['sandbox', 'production'].includes(environment)) throw Error('invalid-environment');
  assertRevision(resultRevision);
  const parts = [environment, challengeId, resultRevision, beneficiaryId, effectType];
  if ([challengeId, beneficiaryId, effectType].some(x => typeof x !== 'string' || !x.trim()))
    throw Error('invalid-settlement-key');
  // Encode tuple boundaries: user-provided delimiters cannot collide.
  return JSON.stringify(parts);
}
function assertSettlement(result, environment) {
  if (!['sandbox', 'production'].includes(environment) || !result || result.environment !== environment)
    throw Error('environment-mismatch');
  if (result.status !== 'verified' || result.verificationStatus !== 'verified' || result.riskStatus !== 'clear')
    throw Error('result-not-cleared');
  assertRevision(result.resultRevision);
  return true;
}
function publicResult(result) {
  // Explicit allowlist; do not spread private records into public data.
  return { schemaVersion: 1, challengeId: result.challengeId,
    resultRevision: result.resultRevision, status: result.status,
    rulesetVersion: result.rulesetVersion, completedAt: result.completedAt };
}
function releaseDecision(evidence) {
  const required = ['sourcePinned', 'backendAuthorization', 'sandboxIsolation',
    'idempotentSettlement', 'concurrentSubmission', 'legacyRegression', 'internalBeta'];
  const blockers = required.filter(key => !evidence || evidence[key] !== 'PASS');
  return { allowed: blockers.length === 0, blockers };
}
module.exports = Object.freeze({ STATES, entryDecision, assertTransition,
  settlementKey, assertSettlement, publicResult, releaseDecision });
