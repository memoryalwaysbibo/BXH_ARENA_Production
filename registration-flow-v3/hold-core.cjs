'use strict';
const {createHash} = require('node:crypto');
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const active = row => ['pending_review','confirmed'].includes(row?.status);
function validateLedger(l) {
  for (const key of ['capacity','occupiedCount','pendingReviewCount','confirmedCount','sequence','revision'])
    if (!Number.isSafeInteger(l?.[key]) || l[key] < 0) throw Error('registration-state-conflict');
  if (l.formalRevision!==undefined&&(!Number.isSafeInteger(l.formalRevision)||l.formalRevision<0||l.formalRevision>l.revision)) throw Error('registration-state-conflict');
  if (!l.capacity || l.occupiedCount !== l.pendingReviewCount + l.confirmedCount ||
      l.occupiedCount > l.capacity || l.sequence < l.occupiedCount) throw Error('registration-state-conflict');
}
function applyHold(ledger, previous, {action, uid, operationId, expectedAttemptId, now}) {
  validateLedger(ledger);
  const next = {...ledger};
  let hold;
  if (action === 'join') {
    if (active(previous)) throw Error('already-registered');
    if (next.occupiedCount >= next.capacity) throw Error('full');
    next.sequence++;
    next.pendingReviewCount++;
    next.occupiedCount++;
    hold = {uid, sequence:next.sequence, submittedAt:now, updatedAt:now,
      status:'pending_review', attemptId:hash([uid,operationId])};
  } else {
    if (!previous || previous.attemptId !== expectedAttemptId) throw Error('registration-attempt-changed');
    if (action === 'approve' || action === 'reject') {
      if (previous.status !== 'pending_review') throw Error('not-pending-review');
      next.pendingReviewCount--;
      if (action === 'approve') next.confirmedCount++;
      else next.occupiedCount--;
      hold = {...previous, status:action === 'approve' ? 'confirmed':'rejected',updatedAt:now};
    } else if (action === 'cancel') {
      if (!active(previous)) throw Error('not-active-registration');
      if (previous.status === 'confirmed') next.confirmedCount--;
      else next.pendingReviewCount--;
      next.occupiedCount--;
      hold = {...previous,status:'cancelled',updatedAt:now};
    } else throw Error('invalid-operation');
  }
  if (next.confirmedCount!==ledger.confirmedCount) next.formalRevision=(ledger.formalRevision||0)+1;
  next.revision++;
  validateLedger(next);
  return {ledger:next,hold};
}
function summary(l) {
  validateLedger(l);
  return {capacity:l.capacity,occupiedCount:l.occupiedCount,pendingReviewCount:l.pendingReviewCount,
    confirmedCount:l.confirmedCount,availableCount:l.capacity-l.occupiedCount};
}
module.exports = {applyHold,validateLedger,summary};
