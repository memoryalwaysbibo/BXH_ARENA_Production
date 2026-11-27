'use strict';

// The V3 transaction layer must read the canonical room and registration rows
// before applying this pure transition. Pending review occupies a real seat.
const statuses = new Set(['pending_review', 'confirmed', 'rejected', 'cancelled']);
const idPattern = /^[A-Za-z0-9_-]{1,128}$/;
function summarize(capacity, rows) {
  if (!Number.isSafeInteger(capacity) || capacity < 1) throw Error('invalid-capacity');
  if (!Array.isArray(rows)) throw Error('invalid-registrations');
  const ids = new Set();
  let pendingReviewCount = 0, confirmedCount = 0;
  for (const row of rows) {
    if (!idPattern.test(row.registrationId || '') || ids.has(row.registrationId) || !statuses.has(row.status))
      throw Error('registration-state-conflict');
    ids.add(row.registrationId);
    if (row.status === 'pending_review') pendingReviewCount++;
    if (row.status === 'confirmed') confirmedCount++;
  }
  const occupiedCount = pendingReviewCount + confirmedCount;
  if (occupiedCount > capacity) throw Error('registration-state-conflict');
  return {capacity, pendingReviewCount, confirmedCount, occupiedCount, availableCount: capacity - occupiedCount};
}

function transition({capacity, rows}, {action, registrationId}, now) {
  const before = summarize(capacity, rows);
  if (!idPattern.test(registrationId || '') || !Number.isFinite(now)) throw Error('invalid-operation');
  const previous = rows.find(row => row.registrationId === registrationId);
  let next;
  switch (action) {
    case 'join':
      if (previous && ['pending_review', 'confirmed'].includes(previous.status)) throw Error('already-registered');
      if (!before.availableCount) throw Error('full');
      next = {registrationId, status: 'pending_review', submittedAt: now, updatedAt: now};
      break;
    case 'approve':
    case 'reject':
      if (previous?.status !== 'pending_review') throw Error('not-pending-review');
      next = {...previous, status: action === 'approve' ? 'confirmed' : 'rejected', reviewedAt: now, updatedAt: now};
      break;
    case 'cancel':
      if (!previous || !['pending_review', 'confirmed'].includes(previous.status)) throw Error('not-active-registration');
      next = {...previous, status: 'cancelled', cancelledAt: now, updatedAt: now};
      break;
    default: throw Error('invalid-operation');
  }
  const nextRows = previous ? rows.map(row => row.registrationId === registrationId ? next : row) : [...rows, next];
  return {row: next, rows: nextRows, summary: summarize(capacity, nextRows)};
}
module.exports = {summarize, transition};
