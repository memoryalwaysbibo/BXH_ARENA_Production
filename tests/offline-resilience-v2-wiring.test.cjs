'use strict';

const fs = require('node:fs');

const html = fs.readFileSync('index.html', 'utf8');
const offline = fs.readFileSync('offline-resilience.js', 'utf8');

const requiredHtml = [
  'let offlineQueueStatus={pending:0,conflict:0,failed:0,total:0};',
  'async function queueOfflineMatchConfirmation(',
  'queueOfflineMatchConfirmation(matchId,"score",localEval.winnerId)',
  'queueOfflineMatchConfirmation(matchId,"quick_decision",selectedWinnerId)',
  'window.BXHCommitOfflineMatch=async function(op)',
  'bxh-offline-operation-synced',
  'bxh-offline-operation-conflict',
  'bxh-offline-operation-failed',
  'bxh-offline-queue-change',
  '<script src="offline-resilience.js?v=20260930-offline-v2"></script>',
];

for (const needle of requiredHtml) {
  if (!html.includes(needle)) {
    throw new Error(`Offline Resilience V2 wiring missing: ${needle}`);
  }
}

const requiredModule = [
  'BXHOfflineQueue',
  'indexedDB',
  'bxh-offline-operation-synced',
  'bxh-offline-operation-conflict',
  'bxh-offline-operation-failed',
];

for (const needle of requiredModule) {
  if (!offline.includes(needle)) {
    throw new Error(`Offline Resilience V2 module contract missing: ${needle}`);
  }
}

console.log('Offline Resilience V2 regression gate: PASS');
