'use strict';
// Read-only inventory. A collected inventory is never deployment reconciliation.
const { createHash } = require('node:crypto');
const PROJECT = 'bxh-arena';
const prefix = `projects/${PROJECT}/`;
class AuditError extends Error {}
const fail = code => { throw new AuditError(code); };
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const scalar = (value, pattern) => typeof value === 'string' && value.length <= 512 && pattern.test(value) ? value : null;
const id = value => scalar(value, /^[A-Za-z0-9_.:/()-]+$/);
const timestamp = value => scalar(value, /^\d{4}-\d\d-\d\dT[\d:.]+Z$/);
const hash = value => createHash('sha256').update(value).digest('hex');
function functionRecord(value) {
  if (!object(value) || !new RegExp(`^${prefix}locations/[a-z0-9-]+/functions/[A-Za-z0-9_-]+$`).test(value.name)) fail('invalid-function-resource');
  return {
    name: value.name, updateTime: timestamp(value.updateTime),
    state: id(value.state || value.status), environment: id(value.environment),
    versionId: typeof value.versionId === 'number' && Number.isSafeInteger(value.versionId) ? String(value.versionId) : id(value.versionId),
    runtime: id(value.buildConfig?.runtime || value.runtime),
    build: id(value.buildConfig?.build || value.buildName),
    revision: id(value.serviceConfig?.revision)
  };
}
function releaseRecord(value) {
  if (!object(value) || !new RegExp(`^${prefix}releases/[A-Za-z0-9_.()/+-]+$`).test(value.name) ||
      !new RegExp(`^${prefix}rulesets/[A-Za-z0-9_-]+$`).test(value.rulesetName)) fail('invalid-release-resource');
  return { name: value.name, rulesetName: value.rulesetName, createTime: timestamp(value.createTime), updateTime: timestamp(value.updateTime) };
}
function rulesetRecord(value, expected) {
  if (!object(value) || value.name !== expected || !Array.isArray(value.source?.files) || !value.source.files.length) fail('invalid-ruleset');
  const names = new Set();
  const files = value.source.files.map(file => {
    if (!object(file) || !scalar(file.name, /^[A-Za-z0-9_.\/-]+$/) || typeof file.content !== 'string' || names.has(file.name)) fail('invalid-ruleset-file');
    names.add(file.name);
    return { name: file.name, bytes: Buffer.byteLength(file.content), sha256: hash(file.content) };
  }).sort((a, b) => a.name.localeCompare(b.name));
  return { name: expected, createTime: timestamp(value.createTime), files, manifestSha256: hash(JSON.stringify(files)) };
}
async function collectRuntimeAudit({ projectId, token, fetchImpl = fetch, now = () => new Date() }) {
  if (projectId !== PROJECT) fail('unsupported-project');
  if (typeof token !== 'string' || !token || /\s/.test(token)) fail('missing-access-token');
  const startedAt = now().toISOString();
  async function get(url) {
    try {
      const response = await fetchImpl(url, { method: 'GET', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(30000) });
      if (!response.ok) fail(`http-${Number.isInteger(response.status) ? response.status : 'error'}`);
      const body = await response.json();
      if (!object(body)) fail('invalid-response');
      return body;
    } catch (error) { if (error instanceof AuditError) throw error; fail('request-failed'); }
  }
  async function list(base, key, convert) {
    const records = [], seen = new Set(), resources = new Set();
    let pageToken = '';
    for (let page = 0; page < 100; page++) {
      const url = new URL(base); url.searchParams.set('pageSize', '100');
      if (pageToken) url.searchParams.set('pageToken', pageToken);
      const body = await get(url.href);
      if (body.unreachable !== undefined && (!Array.isArray(body.unreachable) || body.unreachable.length)) fail('unreachable-regions');
      if (body[key] !== undefined && !Array.isArray(body[key])) fail('invalid-list');
      for (const item of body[key] || []) {
        const record = convert(item);
        if (resources.has(record.name)) fail('duplicate-resource');
        resources.add(record.name); records.push(record);
      }
      if (body.nextPageToken === undefined || body.nextPageToken === '') return records.sort((a, b) => a.name.localeCompare(b.name));
      if (typeof body.nextPageToken !== 'string' || body.nextPageToken.length > 4096 || seen.has(body.nextPageToken)) fail('invalid-pagination');
      pageToken = body.nextPageToken; seen.add(pageToken);
    }
    fail('page-limit');
  }
  async function capture(work) {
    try { return { status: 'COLLECTED', records: await work() }; }
    catch (error) { return { status: 'INCOMPLETE', reason: error instanceof AuditError ? error.message : 'collection-failed', records: [] }; }
  }
  const functionsV1 = await capture(() => list(`https://cloudfunctions.googleapis.com/v1/${prefix}locations/-/functions`, 'functions', functionRecord));
  const functionsV2 = await capture(() => list(`https://cloudfunctions.googleapis.com/v2/${prefix}locations/-/functions`, 'functions', functionRecord));
  const releases = await capture(() => list(`https://firebaserules.googleapis.com/v1/${prefix}releases`, 'releases', releaseRecord));
  const rulesets = releases.status === 'COLLECTED' ? await capture(async () => {
    const records = [];
    for (const name of [...new Set(releases.records.map(item => item.rulesetName))].sort()) {
      records.push(rulesetRecord(await get(`https://firebaserules.googleapis.com/v1/${name}`), name));
    }
    return records;
  }) : { status: 'INCOMPLETE', reason: 'release-list-incomplete', records: [] };
  return {
    schemaVersion: 1, projectId, startedAt, completedAt: now().toISOString(), readOnly: true,
    collectionStatus: [functionsV1, functionsV2, releases, rulesets].every(item => item.status === 'COLLECTED') ? 'COLLECTED' : 'INCOMPLETE',
    runtimeReconciled: false, hcDeploymentVerified: false,
    functionsV1, functionsV2, releases, rulesets
  };
}
async function main(args) {
  const { spawnSync } = require('node:child_process');
  const { writeFile, rename, unlink } = require('node:fs/promises');
  const { resolve, dirname, basename, join } = require('node:path');
  if (args.length !== 4 || args[0] !== '--project' || args[1] !== PROJECT || args[2] !== '--out' || !args[3]) fail('usage: --project bxh-arena --out REPORT.json');
  const auth = spawnSync('gcloud', ['auth', 'print-access-token'], { encoding: 'utf8', timeout: 30000, maxBuffer: 65536 });
  if (auth.error || auth.status !== 0) fail('gcloud-access-token-unavailable');
  const report = await collectRuntimeAudit({ projectId: PROJECT, token: auth.stdout.trim() });
  const destination = resolve(args[3]);
  const temporary = join(dirname(destination), `.${basename(destination)}.${require('node:crypto').randomUUID()}.tmp`);
  try {
    await writeFile(temporary, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    await rename(temporary, destination);
  } finally { await unlink(temporary).catch(() => {}); }
  console.log(`Runtime inventory: ${report.collectionStatus}; reconciliation remains unverified.`);
  return report.collectionStatus === 'COLLECTED' ? 0 : 1;
}
if (require.main === module) main(process.argv.slice(2)).then(code => { process.exitCode = code; }).catch(error => {
  console.error(error instanceof AuditError ? error.message : 'runtime-audit-failed'); process.exitCode = 1;
});
module.exports = { collectRuntimeAudit, main };
