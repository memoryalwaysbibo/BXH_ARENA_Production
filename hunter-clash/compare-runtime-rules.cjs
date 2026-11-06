'use strict';
const { createHash } = require('node:crypto');
const reference = require('./rules-source-reference.json');
const PROJECT = 'bxh-arena';
const digest = value => createHash('sha256').update(value).digest('hex');
function files(value) {
  if (!Array.isArray(value) || !value.length) return null;
  const names = new Set(), result = [];
  for (const file of value) {
    if (!file || typeof file.name !== 'string' || !/^[A-Za-z0-9_.\/-]+$/.test(file.name) ||
        names.has(file.name) || !Number.isSafeInteger(file.bytes) || file.bytes < 0 ||
        typeof file.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(file.sha256)) return null;
    names.add(file.name); result.push({ name: file.name, bytes: file.bytes, sha256: file.sha256 });
  }
  return result.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
}
function compareRuntimeRules(inventory) {
  const result = { schemaVersion: 1, status: 'BLOCKED', sourceCommit: reference.sourceCommit,
    projectId: PROJECT, rulesMatch: false, runtimeReconciled: false, hcDeploymentVerified: false, blockers: [] };
  const block = code => { result.blockers.push(code); return result; };
  if (!inventory || inventory.schemaVersion !== 1 || inventory.projectId !== PROJECT || inventory.readOnly !== true) return block('invalid-inventory-target');
  if (inventory.collectionStatus !== 'COLLECTED' || ['functionsV1', 'functionsV2', 'releases', 'rulesets'].some(key => inventory[key]?.status !== 'COLLECTED' || !Array.isArray(inventory[key]?.records))) return block('inventory-incomplete');
  const start = Date.parse(inventory.startedAt), end = Date.parse(inventory.completedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return block('invalid-observation-time');
  result.observedAt = new Date(end).toISOString();
  const selected = inventory.releases.records.filter(item => item && reference.releaseNames.includes(item.name));
  if (!selected.length) return block('firestore-release-missing');
  if (new Set(selected.map(item => item.name)).size !== selected.length) return block('duplicate-firestore-release');
  const names = [...new Set(selected.map(item => item.rulesetName))];
  if (names.length !== 1 || typeof names[0] !== 'string' || !/^projects\/bxh-arena\/rulesets\/[A-Za-z0-9_-]+$/.test(names[0])) return block('ambiguous-or-invalid-firestore-ruleset');
  const candidates = inventory.rulesets.records.filter(item => item?.name === names[0]);
  if (candidates.length !== 1) return block('firestore-ruleset-missing-or-duplicate');
  const actual = files(candidates[0].files), expected = files(reference.files);
  if (!actual || !expected || digest(JSON.stringify(actual)) !== candidates[0].manifestSha256) return block('invalid-ruleset-manifest');
  result.releaseNames = selected.map(item => item.name).sort(); result.rulesetName = names[0];
  const allNames = [...new Set([...expected, ...actual].map(file => file.name))].sort();
  result.differences = allNames.flatMap(name => {
    const a = actual.find(file => file.name === name), e = expected.find(file => file.name === name);
    if (!e) return [{ name, reason: 'unexpected-file' }];
    if (!a) return [{ name, reason: 'missing-file' }];
    if (a.sha256 !== e.sha256 || a.bytes !== e.bytes) return [{ name, reason: 'content-mismatch' }];
    return [];
  });
  result.rulesMatch = result.differences.length === 0;
  result.status = result.rulesMatch ? 'MATCH' : 'MISMATCH';
  return result;
}
async function main(args) {
  if (args.length !== 2 || args[0] !== '--inventory' || !args[1]) {
    console.error('usage: --inventory REPORT.json'); return 1;
  }
  let inventory;
  try { inventory = JSON.parse(await require('node:fs/promises').readFile(args[1], 'utf8')); }
  catch { console.error('inventory-file-unreadable-or-invalid'); return 1; }
  const result = compareRuntimeRules(inventory);
  console.log(JSON.stringify(result, null, 2));
  return result.status === 'MATCH' ? 0 : 1;
}
if (require.main === module) main(process.argv.slice(2)).then(code => { process.exitCode = code; }).catch(() => {
  console.error('rules-comparison-failed'); process.exitCode = 1;
});
module.exports = { compareRuntimeRules, main };
