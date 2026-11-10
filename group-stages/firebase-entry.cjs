'use strict';

const { initializeApp, getApps } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { createCoordinator } = require('./coordinator.cjs');
const { createGroupStageCommand } = require('./command.cjs');
const { createHistoryReader } = require('../group-history/read.cjs');
const { createGroupSettlement } = require('./settlement.cjs');

if (!getApps().length) initializeApp();
const db = getFirestore();
const coordinator = createCoordinator(db);
const run = createGroupStageCommand(coordinator, createHistoryReader(db),
  createGroupSettlement(db, coordinator, { serverTimestamp: () => FieldValue.serverTimestamp() }));
const invalid = new Set(['group-room-code', 'group-invalid-action', 'group-invalid-count']);
const forbidden = new Set(['group-permission-denied', 'group-room-disabled']);

exports.groupStageCommand = onCall({
  region: 'asia-east1', enforceAppCheck: true, timeoutSeconds: 300, invoker: 'public',
}, async request => {
  try {
    return await run(request);
  } catch (error) {
    const code = error?.code;
    if (code === 'group-auth-required') throw new HttpsError('unauthenticated', code);
    if (forbidden.has(code)) throw new HttpsError('permission-denied', code);
    if (invalid.has(code)) throw new HttpsError('invalid-argument', code);
    if (typeof code === 'string' && code.startsWith('group-')) {
      throw new HttpsError('failed-precondition', code);
    }
    throw error;
  }
});
