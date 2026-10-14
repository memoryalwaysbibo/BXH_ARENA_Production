'use strict';
/** Pure offline evidence validation. No network, database, identity or approval APIs. */
const crypto = require('node:crypto');
const POLICY_VERSION = 'catalog-public-evidence-v1';
const HASH = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
const validId = value => typeof value === 'string' && ID.test(value);
const validHash = value => typeof value === 'string' && HASH.test(value);
const CATEGORIES = Object.freeze(['blade', 'ratchet', 'bit', 'blade_ratchet', 'lock_chip',
  'main_blade', 'assist_blade', 'ratchet_bit', 'metal_blade', 'over_blade']);
const FIELDS = Object.freeze({
  products: Object.freeze(['productCode', 'originalName', 'line', 'packageType', 'selectionMode', 'releaseDate']),
  parts: Object.freeze(['originalName', 'category']),
  options: Object.freeze(['optionCode', 'originalName']),
  assemblyClaims: Object.freeze(['originalName']),
  contentClaims: Object.freeze(['partId', 'quantity'])
});
const IDS = Object.freeze({products: 'productId', parts: 'partId', options: 'optionId',
  assemblyClaims: 'groupId', contentClaims: 'contentClaimId'});
const SUBJECT_KEYS = Object.freeze(['productId', 'productCode', 'optionId', 'optionCode',
  'groupId', 'contentClaimId', 'partId', 'category']);
const HOSTS = new Set(['beyblade.takaratomy.co.jp', 'www.takaratomy.co.jp', 'takaratomymall.jp']);
const fail = code => { throw Error('PUBLIC_EVIDENCE_' + code); };
const check = (ok, code) => { if (!ok) fail(code); };
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v) &&
  (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);
function keys(value, allowed, required = allowed) {
  check(object(value), 'OBJECT_REQUIRED');
  check(Object.keys(value).every(k => allowed.includes(k)), 'UNKNOWN_OR_FORBIDDEN_FIELD');
  check(required.every(k => Object.hasOwn(value, k)), 'MISSING_FIELD');
}
function noProto(value) {
  if (!value || typeof value !== 'object') return;
  check(Array.isArray(value) || object(value), 'PLAIN_JSON_REQUIRED');
  for (const key of Object.keys(value)) {
    check(!['__proto__', 'prototype', 'constructor'].includes(key), 'PROTOTYPE_KEY');
    noProto(value[key]);
  }
}
function sha256(bytes) {
  check(typeof bytes === 'string' || Buffer.isBuffer(bytes) || bytes instanceof Uint8Array, 'BYTES_REQUIRED');
  return crypto.createHash('sha256').update(bytes).digest('hex');
}
function parseBytes(bytes) {
  let out;
  try { out = JSON.parse(typeof bytes === 'string' ? bytes : Buffer.from(bytes).toString('utf8')); }
  catch { fail('INVALID_JSON'); }
  noProto(out);
  return out;
}
function stable(value) {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (object(value)) return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + stable(value[k])).join(',') + '}';
  return JSON.stringify(value);
}
function deepFreeze(value) {
  if (value && typeof value === 'object') {
    for (const v of Object.values(value)) deepFreeze(v);
    Object.freeze(value);
  }
  return value;
}
function publicText(value, limit = 240) {
  return typeof value === 'string' && value.length > 0 && value.length <= limit && value.trim() === value &&
    !/[\u0000-\u001f\u007f-\u009f<>]/u.test(value) &&
    !/(?:https?:\/\/|file:|\/(?:tmp|home|Users|workspace)\/|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|Bearer\s|api[_-]?key|(?:token|secret|password)\s*[:=])/i.test(value);
}
function validateSourceUrl(input) {
  check(typeof input === 'string' && input.length <= 1000 && !/[\s\\]/u.test(input), 'SOURCE_URL_INVALID');
  let url;
  try { url = new URL(input); } catch { fail('SOURCE_URL_INVALID'); }
  check(url.protocol === 'https:' && HOSTS.has(url.hostname) && !url.port &&
    !url.username && !url.password && !url.hash && url.href === input, 'SOURCE_URL_NOT_PUBLIC_OFFICIAL');
  let path;
  try { path = decodeURIComponent(url.pathname); } catch { fail('SOURCE_URL_INVALID'); }
  check(!/[\\%\u0000-\u001f\u007f-\u009f]/u.test(path) &&
    publicText(path, 1000) &&
    !/(?:^|[\/;])(?:private|auth|login|session(?:id)?|jsessionid|(?:access|refresh|id)[-_]?tokens?|tokens?|secrets?|credentials?|api[-_]?keys?|passwords?|admin|account|\.env|\.git)(?:[./_;=-]|$)/i.test(path), 'SOURCE_URL_PRIVATE');
  // The official mall's public product number is the only permitted query parameter.
  const params = [...url.searchParams];
  check(params.length === 0 || (url.hostname === 'takaratomymall.jp' &&
    url.pathname === '/shop/g/goods.aspx' && params.length === 1 && params[0][0] === 'g' && /^\d{8,14}$/.test(params[0][1])), 'SOURCE_URL_QUERY_FORBIDDEN');
  check(!input.includes('?') || params.length > 0, 'SOURCE_URL_QUERY_FORBIDDEN');
  return input;
}
function indexBatch(batch) {
  check(object(batch), 'BATCH_REQUIRED');
  const index = {};
  for (const [section, idKey] of Object.entries(IDS)) {
    check(Array.isArray(batch[section]), 'BATCH_SECTION_REQUIRED');
    index[section] = new Map();
    for (const row of batch[section]) {
      check(object(row) && validId(row[idKey]), 'RECORD_ID_INVALID');
      check(!index[section].has(row[idKey]), 'DUPLICATE_RECORD');
      index[section].set(row[idKey], row);
    }
  }
  for (const p of index.products.values()) check(publicText(p.productCode, 80), 'PRODUCT_CODE_INVALID');
  for (const p of index.parts.values()) check(CATEGORIES.includes(p.category), 'PART_CATEGORY_INVALID');
  for (const o of index.options.values()) {
    check(index.products.has(o.productId), 'DEPENDENCY_MISSING');
    check([o.officialOptionCode, o.reportedOptionCode].every(x => x == null || publicText(x, 80)), 'OPTION_CODE_INVALID');
  }
  for (const g of index.assemblyClaims.values()) {
    const o = index.options.get(g.optionId);
    check(index.products.has(g.productId) && o && o.productId === g.productId, 'DEPENDENCY_MISSING_OR_MISMATCH');
  }
  for (const c of index.contentClaims.values()) {
    const g = index.assemblyClaims.get(c.groupId);
    check(g && g.productId === c.productId && g.optionId === c.optionId &&
      index.parts.has(c.partId) && Number.isSafeInteger(c.quantity) && c.quantity > 0 && c.quantity <= 100, 'DEPENDENCY_MISSING_OR_MISMATCH');
  }
  return index;
}
function subjectFor(index, section, recordId, partContentId = null) {
  const row = index[section].get(recordId);
  check(row, 'RECORD_MISSING');
  let p, o, g, c, part;
  if (section === 'products') p = row;
  if (section === 'options') o = row;
  if (section === 'assemblyClaims') g = row;
  if (section === 'contentClaims') c = row;
  if (section === 'parts') {
    part = row;
    if (partContentId === null) return {productId: null, productCode: null, optionId: null,
      optionCode: null, groupId: null, contentClaimId: null, partId: row.partId, category: row.category};
    c = index.contentClaims.get(partContentId);
    check(c && c.partId === row.partId, 'PART_EVIDENCE_CONTEXT_REQUIRED');
  }
  if (c) { g = index.assemblyClaims.get(c.groupId); part = index.parts.get(c.partId); }
  if (g) o = index.options.get(g.optionId);
  if (o) p = index.products.get(o.productId);
  return {productId: p.productId, productCode: p.productCode,
    optionId: o?.optionId ?? null, optionCode: o ? (o.officialOptionCode ?? o.reportedOptionCode ?? null) : null,
    groupId: g?.groupId ?? null, contentClaimId: c?.contentClaimId ?? null,
    partId: part?.partId ?? null, category: part?.category ?? null};
}
function validateValue(index, fact) {
  const row = index[fact.section].get(fact.recordId);
  check(row, 'RECORD_MISSING');
  const {section, field, value} = fact;
  if (field === 'quantity') check(Number.isSafeInteger(value) && value > 0 && value <= 100 && value === row.quantity, 'VALUE_OR_IDENTITY_MISMATCH');
  else check(publicText(value), 'PUBLIC_VALUE_INVALID');
  if (field === 'category') check(CATEGORIES.includes(value) && value === row.category, 'VALUE_OR_IDENTITY_MISMATCH');
  if (field === 'partId') check(value === row.partId, 'VALUE_OR_IDENTITY_MISMATCH');
  if (field === 'productCode') check(value === row.productCode, 'VALUE_OR_IDENTITY_MISMATCH');
  if (field === 'optionCode') check(value === (row.officialOptionCode ?? row.reportedOptionCode), 'VALUE_OR_IDENTITY_MISMATCH');
  if (field === 'line') check(['BX', 'CX', 'UX'].includes(value) &&
    row.productCode.startsWith(value + '-') && (row.line == null || row.line === value), 'VALUE_OR_IDENTITY_MISMATCH');
  if (field === 'packageType') check(['booster', 'starter', 'random_booster', 'deck_set', 'part_set'].includes(value), 'VALUE_INVALID');
  if (field === 'selectionMode') check(['fixed', 'random_one'].includes(value), 'VALUE_INVALID');
  if (field === 'releaseDate') check(/^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value, 'VALUE_INVALID');
  check(Object.hasOwn(FIELDS, section), 'SECTION_NOT_ALLOWED');
}
function validateProofs(index, sources, proofs, section, recordId) {
  check(Array.isArray(proofs) && proofs.length > 0, 'MISSING_PROOF');
  for (const proof of proofs) {
    keys(proof, ['sourceId', 'sourceBytesHash', 'locator', 'subject']);
    const source = sources.get(proof.sourceId);
    check(source && validHash(proof.sourceBytesHash) && proof.sourceBytesHash === source.bytesHash, 'SOURCE_OR_HASH_MISMATCH');
    check(publicText(proof.locator, 500), 'LOCATOR_REQUIRED');
    keys(proof.subject, SUBJECT_KEYS);
    const expected = subjectFor(index, section, recordId, proof.subject.contentClaimId);
    check(stable(expected) === stable(proof.subject), 'PROOF_SUBJECT_MISMATCH');
  }
}
function validateEvidenceRegistry({batchBytes, registryBytes, trust} = {}) {
  keys(trust, ['batchBytesHash', 'registryHash', 'registryVersion']);
  check(validHash(trust.batchBytesHash) && validHash(trust.registryHash) && publicText(trust.registryVersion, 80), 'TRUST_PIN_REQUIRED');
  check(sha256(batchBytes) === trust.batchBytesHash, 'STALE_BATCH_BYTES');
  check(sha256(registryBytes) === trust.registryHash, 'REGISTRY_HASH_MISMATCH');
  const batch = parseBytes(batchBytes), registry = parseBytes(registryBytes);
  keys(registry, ['schemaVersion', 'registryVersion', 'batchBytesHash', 'sources', 'facts', 'compositions']);
  check(registry.schemaVersion === 1 && registry.registryVersion === trust.registryVersion, 'REGISTRY_VERSION_MISMATCH');
  check(registry.batchBytesHash === trust.batchBytesHash, 'REGISTRY_BATCH_MISMATCH');
  check(Array.isArray(registry.sources) && Array.isArray(registry.facts) && Array.isArray(registry.compositions), 'REGISTRY_ARRAY_REQUIRED');
  const index = indexBatch(batch), sources = new Map(), facts = new Map(), compositions = new Map();
  for (const source of registry.sources) {
    keys(source, ['sourceId', 'url', 'bytesHash']);
    check(validId(source.sourceId) && validHash(source.bytesHash), 'SOURCE_OR_HASH_REQUIRED');
    validateSourceUrl(source.url);
    check(!sources.has(source.sourceId), 'DUPLICATE_SOURCE');
    for (const previous of sources.values()) check(previous.url !== source.url || previous.bytesHash === source.bytesHash, 'CONFLICTING_SOURCE_VERSION');
    sources.set(source.sourceId, source);
  }
  for (const fact of registry.facts) {
    keys(fact, ['section', 'recordId', 'field', 'value', 'proofs']);
    check(Object.hasOwn(FIELDS, fact.section) && FIELDS[fact.section].includes(fact.field), 'FIELD_NOT_ALLOWED');
    check(validId(fact.recordId), 'RECORD_ID_INVALID');
    validateValue(index, fact);
    validateProofs(index, sources, fact.proofs, fact.section, fact.recordId);
    const key = `${fact.section}/${fact.recordId}/${fact.field}`;
    check(!facts.has(key), facts.has(key) && stable(facts.get(key).value) !== stable(fact.value) ? 'CONFLICTING_FACT' : 'DUPLICATE_FACT');
    facts.set(key, fact);
  }
  for (const manifest of registry.compositions) {
    keys(manifest, ['groupId', 'expectedParts', 'proofs']);
    check(validId(manifest.groupId) && index.assemblyClaims.has(manifest.groupId), 'GROUP_MISSING');
    check(!compositions.has(manifest.groupId), 'CONFLICTING_COMPOSITION');
    validateProofs(index, sources, manifest.proofs, 'assemblyClaims', manifest.groupId);
    check(Array.isArray(manifest.expectedParts) && manifest.expectedParts.length > 0, 'EXPECTED_PARTS_REQUIRED');
    const seen = new Set();
    for (const part of manifest.expectedParts) {
      keys(part, ['contentClaimId', 'partId', 'category', 'quantity']);
      const c = index.contentClaims.get(part.contentClaimId), p = index.parts.get(part.partId);
      check(c && p && c.groupId === manifest.groupId && c.partId === part.partId && p.category === part.category && c.quantity === part.quantity, 'EXPECTED_PART_MISMATCH');
      check(!seen.has(part.contentClaimId), 'DUPLICATE_EXPECTED_PART');
      seen.add(part.contentClaimId);
    }
    // Do not let a trusted adapter accidentally promote a smaller subset as the full composition.
    const all = [...index.contentClaims.values()].filter(c => c.groupId === manifest.groupId);
    check(all.length === seen.size && all.every(c => seen.has(c.contentClaimId)), 'EXPECTED_PARTS_INCOMPLETE');
    compositions.set(manifest.groupId, manifest);
  }
  // Internal validation result deliberately contains private input. Never serialize it to a client.
  return {index, sources, facts, compositions};
}
module.exports = {POLICY_VERSION, FIELDS, IDS, CATEGORIES, sha256, stable, deepFreeze,
  validateSourceUrl, validateEvidenceRegistry};
