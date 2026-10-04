'use strict';

const fs = require('node:fs');

const HIGH_EXACT = new Set([
  'index.html',
  'firebase.json',
  'firestore.rules',
  'storage.rules',
  'package.json',
  'package-lock.json',
  'double-elimination-core.js',
  'referee-fault-core.js',
  'scripts/run-regression-core.cjs',
  'scripts/verify-production-frontend.cjs',
  'playwright.e2e.config.cjs',
  'playwright.deep-e2e.config.cjs'
]);

const HIGH_PATTERNS = [
  /^\.github\/workflows\//,
  /^modules\/cloud\//,
  /^modules\/main-app\/core\.js$/,
  /^modules\/main-app\/(?:tournament-operations|match-utils|domain-utils|registration-utils|hunter-utils)\.js$/,
  /^tests\/e2e\//,
  /(?:^|\/)(?:auth|permission|security|firestore|firebase|cloud|runtime|settlement|bracket|score)(?:[-_.\/]|$)/i
];

const LOW_PATTERNS = [
  /^(?:docs\/|README(?:\.|$))/i,
  /\.(?:md|txt)$/i,
  /^tests\/(?!e2e\/).+\.test\.cjs$/i
];

const MEDIUM_PATTERN = /\.(?:js|cjs|mjs|html|css|json|svg|png|jpe?g|webp|gif|ico)$/i;

function normalize(paths) {
  return [...new Set(paths.map(value => String(value || '').trim().replace(/^\.\//, '')).filter(Boolean))].sort();
}

function automaticLevel(paths) {
  if (!paths.length) return {level: 'high', reason: 'No changed paths were detected; fail-safe to HIGH.'};
  const high = paths.find(path => HIGH_EXACT.has(path) || HIGH_PATTERNS.some(pattern => pattern.test(path)));
  if (high) return {level: 'high', reason: 'High-risk path: ' + high};
  const nonLow = paths.filter(path => !LOW_PATTERNS.some(pattern => pattern.test(path)));
  const medium = nonLow.find(path => MEDIUM_PATTERN.test(path));
  if (medium) return {level: 'medium', reason: 'Runtime or visual path: ' + medium};
  if (nonLow.length) return {level: 'medium', reason: 'Unclassified path fails safe to MEDIUM: ' + nonLow[0]};
  return {level: 'low', reason: 'Documentation or isolated non-E2E tests only.'};
}

function classify(inputPaths, override = 'auto') {
  const paths = normalize(inputPaths);
  const allowed = new Set(['auto', 'low', 'medium', 'high']);
  if (!allowed.has(override)) throw new Error('Invalid risk override: ' + override);
  const automatic = automaticLevel(paths);
  const level = override === 'auto' ? automatic.level : override;
  return {
    level,
    run_ui: level !== 'low',
    run_e2e: level === 'high',
    run_deep: level === 'high',
    reason: override === 'auto' ? automatic.reason : 'Manual acceptance override: ' + override,
    paths
  };
}

if (require.main === module) {
  const paths = fs.readFileSync(0, 'utf8').split(/\r?\n/);
  const result = classify(paths, process.env.RISK_OVERRIDE || 'auto');
  console.log('level=' + result.level);
  console.log('run_ui=' + result.run_ui);
  console.log('run_e2e=' + result.run_e2e);
  console.log('run_deep=' + result.run_deep);
  console.log('reason=' + result.reason);
  console.log('changed_files=' + result.paths.length);
}

module.exports = { classify };
