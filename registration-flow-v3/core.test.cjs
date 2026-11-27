'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {summarize, transition} = require('./core.cjs');
const apply = (rows, action, registrationId, capacity = 2) => transition({rows, capacity}, {action, registrationId}, 100);
test('hold occupies immediately, approve does not consume a second seat', () => {
  const held = apply([], 'join', 'playerA');
  assert.deepEqual(held.summary, {capacity:2,pendingReviewCount:1,confirmedCount:0,occupiedCount:1,availableCount:1});
  const approved = apply(held.rows, 'approve', 'playerA');
  assert.equal(approved.summary.availableCount, 1);
  assert.equal(approved.summary.confirmedCount, 1);
  assert.equal(approved.summary.pendingReviewCount, 0);
});
test('pending holds can exhaust capacity; rejection releases exactly one seat', () => {
  const one = apply([], 'join', 'playerA');
  const two = apply(one.rows, 'join', 'playerB');
  assert.throws(() => apply(two.rows, 'join', 'playerC'), /full/);
  const rejected = apply(two.rows, 'reject', 'playerA');
  assert.equal(rejected.summary.availableCount, 1);
  assert.equal(apply(rejected.rows, 'join', 'playerC').summary.availableCount, 0);
  assert.throws(() => apply(rejected.rows, 'reject', 'playerA'), /not-pending-review/);
});
test('duplicate joins and stale review decisions do not change counts', () => {
  const held = apply([], 'join', 'playerA');
  assert.throws(() => apply(held.rows, 'join', 'playerA'), /already-registered/);
  const approved = apply(held.rows, 'approve', 'playerA');
  assert.throws(() => apply(approved.rows, 'reject', 'playerA'), /not-pending-review/);
  assert.equal(approved.summary.occupiedCount, 1);
});
test('cancellation releases an occupied seat', () => {
  const held = apply([], 'join', 'playerA');
  assert.equal(apply(held.rows, 'cancel', 'playerA').summary.availableCount, 2);
  const approved = apply(held.rows, 'approve', 'playerA');
  assert.equal(apply(approved.rows, 'cancel', 'playerA').summary.availableCount, 2);
});
test('inconsistent rows fail closed', () => {
  const row = {registrationId:'playerA',status:'pending_review'};
  assert.throws(() => summarize(2, [row,row]), /registration-state-conflict/);
  assert.throws(() => summarize(1, [row,{...row,registrationId:'playerB'}]), /registration-state-conflict/);
});
