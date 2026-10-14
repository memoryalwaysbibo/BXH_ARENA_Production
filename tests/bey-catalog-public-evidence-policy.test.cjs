'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {sha256, validateSourceUrl} = require('../modules/bey-catalog/catalog-source-evidence-policy.cjs');
const {buildPublicCatalogCandidate: build} = require('../modules/bey-catalog/catalog-public-projection.cjs');
const {assertIsolatedTarget} = require('../modules/bey-catalog/safety-gate.cjs');
const URL = 'https://beyblade.takaratomy.co.jp/beyblade-x/lineup/ux99.html';
const sourceHash = sha256('synthetic official page bytes, not real product evidence');
const nilSubject = {productId: null, productCode: null, optionId: null, optionCode: null,
  groupId: null, contentClaimId: null, partId: null, category: null};
function fixture({five = false} = {}) {
  const cats = five ? ['lock_chip', 'main_blade', 'assist_blade', 'ratchet', 'bit'] : ['blade', 'ratchet', 'bit'];
  const batch = {
    products: [{productId: 'p1', productCode: 'UX-99', displayName: 'PRIVATE TRANSLATION',
      verified: true, sourceTier: 'official', note: 'PRIVATE NOTE', reviewerUid: 'PRIVATE REVIEWER'}],
    parts: cats.map((category, i) => ({partId: 'part' + i, category, massG: 123, physicalColor: 'PRIVATE COLOR'})),
    options: [{optionId: 'o1', productId: 'p1', reportedOptionCode: '03', probability: 'PRIVATE PROBABILITY'}],
    assemblyClaims: [{groupId: 'g1', productId: 'p1', optionId: 'o1', partsResolved: true, verificationStatus: 'official_direct'}],
    contentClaims: cats.map((_, i) => ({contentClaimId: 'c' + i, productId: 'p1', optionId: 'o1', groupId: 'g1', partId: 'part' + i, quantity: 1, variantId: 'PRIVATE VARIANT'})),
    sources: [{url: 'https://private.invalid?token=PRIVATE', notes: 'PRIVATE SOURCE'}],
    issues: [{reviewerUid: 'PRIVATE UID', rawDump: 'PRIVATE DUMP'}]
  };
  const base = {...nilSubject, productId: 'p1', productCode: 'UX-99'};
  const option = {...base, optionId: 'o1', optionCode: '03'};
  const group = {...option, groupId: 'g1'};
  const proof = subject => [{sourceId: 's1', sourceBytesHash: sourceHash, locator: 'Synthetic named table, row 1', subject: structuredClone(subject)}];
  const facts = [];
  const add = (section, recordId, field, value, subject) => facts.push({section, recordId, field, value, proofs: proof(subject)});
  add('products', 'p1', 'productCode', 'UX-99', base);
  add('products', 'p1', 'originalName', '架空ベイ', base);
  add('products', 'p1', 'line', 'UX', base);
  add('options', 'o1', 'optionCode', '03', option);
  add('options', 'o1', 'originalName', '架空セット', option);
  add('assemblyClaims', 'g1', 'originalName', '架空セット', group);
  batch.contentClaims.forEach((c, i) => {
    const subject = {...group, contentClaimId: c.contentClaimId, partId: c.partId, category: cats[i]};
    add('parts', c.partId, 'originalName', '部品' + i, subject);
    add('parts', c.partId, 'category', cats[i], subject);
    add('contentClaims', c.contentClaimId, 'partId', c.partId, subject);
    add('contentClaims', c.contentClaimId, 'quantity', 1, subject);
  });
  const registry = {schemaVersion: 1, registryVersion: 'synthetic-v1', batchBytesHash: '',
    sources: [{sourceId: 's1', url: URL, bytesHash: sourceHash}], facts,
    compositions: [{groupId: 'g1', expectedParts: batch.contentClaims.map((c, i) => ({contentClaimId: c.contentClaimId,
      partId: c.partId, category: cats[i], quantity: 1})), proofs: proof(group)}]};
  return {batch, registry};
}
function input(f, options = {}) {
  const batchBytes = Buffer.from(JSON.stringify(f.batch));
  const registry = {...f.registry, batchBytesHash: sha256(batchBytes)};
  const registryBytes = Buffer.from(JSON.stringify(registry));
  return {batchBytes, registryBytes, trust: {batchBytesHash: sha256(batchBytes), registryHash: sha256(registryBytes),
    registryVersion: registry.registryVersion}, ...options};
}
function withChange(fn, pattern) { const f = fixture(); fn(f); assert.throws(() => build(input(f)), pattern); }

test('offline projection is deterministic, immutable, non-mutating and generic beyond three SKUs', () => {
  const f = fixture(), before = JSON.stringify(f), i = input(f), out = build(i);
  assert.deepEqual(build(i), out); assert.equal(JSON.stringify(f), before);
  assert.equal(out.status, 'not_published'); assert.equal(out.productionWritable, false);
  assert.equal(out.publicPayload.products[0].productCode, 'UX-99');
  assert.equal(out.publicPayload.products[0].compositionComplete, false);
  assert.equal(out.publicPayload.assemblyRelations.length, 1); assert.equal(out.publicPayload.contentFacts.length, 3);
  assert.deepEqual(out.publicPayload.products[0].sourceUrls.originalName, [URL]);
  assert(Object.isFrozen(out.publicPayload.products[0]));
  assert.throws(() => { out.publicPayload.products[0].originalName = 'mutated'; }, TypeError);
});
test('ordering of facts, source proofs and manifests does not affect public output', () => {
  const f = fixture(), before = build(input(f)).publicPayload;
  f.registry.facts.reverse(); f.registry.compositions[0].expectedParts.reverse();
  f.batch.parts.reverse(); f.batch.contentClaims.reverse();
  assert.deepEqual(build(input(f)).publicPayload, before);
});
test('five-part CX composition is complete only with all five independently evidenced claims', () => {
  const f = fixture({five: true});
  assert.equal(build(input(f)).publicPayload.assemblyRelations[0].expectedParts.length, 5);
  f.registry.facts = f.registry.facts.filter(x => !(x.section === 'contentClaims' && x.recordId === 'c2'));
  const out = build(input(f));
  assert.equal(out.publicPayload.assemblyRelations.length, 0);
  assert.equal(out.publicPayload.contentFacts.length, 0);
  assert.equal(out.publicPayload.products[0].compositionComplete, false);
});
test('hash pins cover exact batch bytes and exact registry bytes', () => {
  const i = input(fixture());
  assert.throws(() => build({...i, batchBytes: Buffer.concat([i.batchBytes, Buffer.from(' ')])}), /STALE_BATCH_BYTES/);
  assert.throws(() => build({...i, registryBytes: Buffer.concat([i.registryBytes, Buffer.from(' ')])}), /REGISTRY_HASH_MISMATCH/);
  assert.throws(() => build({...i, trust: {...i.trust, registryVersion: 'v2'}}), /REGISTRY_VERSION_MISMATCH/);
  assert.throws(() => build({...i, trust: {...i.trust, registryHash: ''}}), /TRUST_PIN_REQUIRED/);
});
test('registry must identify the same batch and schema version', () => {
  const i = input(fixture()), r = JSON.parse(i.registryBytes);
  r.batchBytesHash = 'a'.repeat(64); i.registryBytes = JSON.stringify(r); i.trust.registryHash = sha256(i.registryBytes);
  assert.throws(() => build(i), /REGISTRY_BATCH_MISMATCH/);
  withChange(f => { f.registry.schemaVersion = 2; }, /REGISTRY_VERSION_MISMATCH/);
});
test('raw official/verified/reviewer flags never constitute evidence', () => {
  const f = fixture(); f.registry.facts = []; f.registry.compositions = [];
  const out = build(input(f));
  for (const rows of Object.values(out.publicPayload)) assert.equal(rows.length, 0);
  assert(out.diagnostics.length > 0);
});
test('missing source, source hash, locator and proof fail closed', () => {
  withChange(f => { f.registry.facts[0].proofs = []; }, /MISSING_PROOF/);
  withChange(f => { f.registry.facts[0].proofs[0].sourceId = 'missing'; }, /SOURCE_OR_HASH_MISMATCH/);
  withChange(f => { f.registry.facts[0].proofs[0].sourceBytesHash = 'a'.repeat(64); }, /SOURCE_OR_HASH_MISMATCH/);
  withChange(f => { f.registry.facts[0].proofs[0].locator = ''; }, /LOCATOR_REQUIRED/);
  withChange(f => { delete f.registry.sources[0].bytesHash; }, /MISSING_FIELD/);
});
test('unknown and forbidden registry fields cannot become public', () => {
  for (const field of ['displayNameZhTW', 'massG', 'color', 'performance', 'compatibility', 'legality', 'verificationStatus', 'reviewerUid', 'assets', 'notes']) {
    withChange(f => { f.registry.facts[0].field = field; }, /FIELD_NOT_ALLOWED/);
  }
  withChange(f => { f.registry.admin = true; }, /UNKNOWN_OR_FORBIDDEN_FIELD/);
  withChange(f => { f.registry.sources[0].rawDump = 'private'; }, /UNKNOWN_OR_FORBIDDEN_FIELD/);
  withChange(f => { f.registry.facts[0].proofs[0].verified = true; }, /UNKNOWN_OR_FORBIDDEN_FIELD/);
});
test('prototype keys in both input documents are rejected', () => {
  for (const key of ['__proto__', 'constructor', 'prototype']) {
    const f = fixture(); Object.defineProperty(f.batch.products[0], key, {value: {polluted: true}, enumerable: true});
    assert.throws(() => build(input(f)), /PROTOTYPE_KEY/);
    const g = fixture(); Object.defineProperty(g.registry, key, {value: 'private', enumerable: true});
    assert.throws(() => build(input(g)), /PROTOTYPE_KEY/);
  }
  assert.equal({}.polluted, undefined);
});
test('official URLs use exact https hosts and reject tokens, private params, paths and redirects', () => {
  const bad = [
    'http://beyblade.takaratomy.co.jp/x', 'https://beyblade.takaratomy.co.jp.evil.com/x',
    'https://evilbeyblade.takaratomy.co.jp/x', 'https://beyblade.takaratomy.co.jp@evil.com/x',
    'https://user:pass@beyblade.takaratomy.co.jp/x', URL + '?token=abc', URL + '?redirect=https://evil.com',
    URL + '#access_token=abc', URL + '?utm_source=test', URL + '?',
    'file:///tmp/official.pdf', '/workspace/private.json', 'https://127.0.0.1/a',
    'https://beyblade.takaratomy.co.jp:8443/a', 'https://beyblade.takaratomy.co.jp/private/a',
    'https://beyblade.takaratomy.co.jp/%70rivate/a', 'https://beyblade.takaratomy.co.jp\\@evil.com/a'
  ];
  for (const url of bad) assert.throws(() => validateSourceUrl(url), /SOURCE_URL/, url);
  assert.equal(validateSourceUrl(URL), URL);
  const jpPdf = 'https://www.takaratomy.co.jp/support/manual/items/4904810097167_%EF%BC%B5%EF%BC%B8.pdf';
  assert.equal(validateSourceUrl(jpPdf), jpPdf);
  for (const path of ['/%ZZ.pdf', '/%2Fprivate/a', '/%255Ftoken/a', '/%00.pdf', '/%5Cprivate/a'])
    assert.throws(() => validateSourceUrl('https://www.takaratomy.co.jp' + path), /SOURCE_URL/);
  assert.equal(validateSourceUrl('https://takaratomymall.jp/shop/g/goods.aspx?g=4904810097167'), 'https://takaratomymall.jp/shop/g/goods.aspx?g=4904810097167');
});
test('HTML, control characters and secret-looking names never reach public output', () => {
  for (const name of ['<img src=x onerror=alert(1)>', 'x\u0000y', 'https://private.invalid/token', 'token=secret', '/tmp/private.json', 'person@example.com']) {
    withChange(f => { f.registry.facts[1].value = name; }, /PUBLIC_VALUE_INVALID/);
  }
});
test('conflicting or duplicate facts and changing source versions are rejected', () => {
  withChange(f => { f.registry.facts.push({...f.registry.facts[1], value: '別の名称'}); }, /CONFLICTING_FACT/);
  withChange(f => { f.registry.facts.push(structuredClone(f.registry.facts[1])); }, /DUPLICATE_FACT/);
  withChange(f => { f.registry.sources.push({...f.registry.sources[0], sourceId: 's2', bytesHash: 'b'.repeat(64)}); }, /CONFLICTING_SOURCE_VERSION/);
  withChange(f => { f.registry.compositions.push(structuredClone(f.registry.compositions[0])); }, /CONFLICTING_COMPOSITION/);
});
test('cross-SKU, option and group evidence cannot be transplanted', () => {
  for (const [key, value] of [['productId', 'p2'], ['productCode', 'UX-98'], ['optionId', 'o2'], ['optionCode', '04'], ['groupId', 'g2']]) {
    withChange(f => { f.registry.facts.find(x => x.section === 'contentClaims').proofs[0].subject[key] = value; }, /PROOF_SUBJECT_MISMATCH/);
  }
});
test('wrong part, part category, quantity and claimed IDs cannot be transplanted', () => {
  withChange(f => { f.registry.facts.find(x => x.section === 'parts').proofs[0].subject.category = 'bit'; }, /PROOF_SUBJECT_MISMATCH/);
  withChange(f => { f.registry.facts.find(x => x.section === 'parts').proofs[0].subject.partId = 'part2'; }, /PROOF_SUBJECT_MISMATCH/);
  withChange(f => { f.registry.facts.find(x => x.section === 'contentClaims' && x.field === 'partId').value = 'part2'; }, /VALUE_OR_IDENTITY_MISMATCH/);
  withChange(f => { f.registry.facts.find(x => x.section === 'contentClaims' && x.field === 'quantity').value = 2; }, /VALUE_OR_IDENTITY_MISMATCH/);
  withChange(f => { f.registry.facts[0].value = 'UX-98'; }, /VALUE_OR_IDENTITY_MISMATCH/);
});
test('generic part evidence supports part identity but cannot establish a SKU composition', () => {
  const f = fixture();
  for (const x of f.registry.facts.filter(x => x.section === 'parts')) {
    const p = f.batch.parts.find(p => p.partId === x.recordId);
    x.proofs[0].subject = {...nilSubject, partId: p.partId, category: p.category};
  }
  assert.equal(build(input(f)).publicPayload.parts.length, 3);
  const c = f.registry.facts.find(x => x.section === 'contentClaims');
  c.proofs[0].subject = {...nilSubject, partId: 'part0', category: 'blade'};
  assert.throws(() => build(input(f)), /PROOF_SUBJECT_MISMATCH/);
});
test('missing or inconsistent raw dependencies fail closed', () => {
  withChange(f => { f.batch.options[0].productId = 'missing'; }, /DEPENDENCY/);
  withChange(f => { f.batch.contentClaims[0].partId = 'missing'; }, /DEPENDENCY/);
  withChange(f => { f.batch.contentClaims[0].optionId = 'missing'; }, /DEPENDENCY/);
  withChange(f => { f.batch.assemblyClaims[0].productId = 'missing'; }, /DEPENDENCY/);
});
test('missing public dependencies withhold downstream entities without dangling references', () => {
  const f = fixture(); f.registry.facts = f.registry.facts.filter(x => x.section !== 'products');
  const p = build(input(f, {includePartialCompositionFacts: true})).publicPayload;
  for (const section of ['products', 'options', 'assemblyRelations', 'contentFacts', 'partialCompositionFacts']) assert.equal(p[section].length, 0);
});
test('explicit complete manifest cannot omit a raw claim or use a different part/category', () => {
  withChange(f => { f.registry.compositions[0].expectedParts.pop(); }, /EXPECTED_PARTS_INCOMPLETE/);
  withChange(f => { f.registry.compositions[0].expectedParts[0].partId = 'part2'; }, /EXPECTED_PART_MISMATCH/);
  withChange(f => { f.registry.compositions[0].expectedParts[0].category = 'bit'; }, /EXPECTED_PART_MISMATCH/);
  withChange(f => { f.registry.compositions[0].proofs = []; }, /MISSING_PROOF/);
});
test('raw partsResolved and expectedIndependentParts cannot replace an evidenced manifest', () => {
  const f = fixture(); f.batch.assemblyClaims[0].expectedIndependentParts = 3; f.registry.compositions = [];
  const out = build(input(f));
  assert.equal(out.publicPayload.products.length, 1); assert.equal(out.publicPayload.products[0].compositionComplete, false);
  assert.equal(out.publicPayload.assemblyRelations.length, 0); assert.equal(out.publicPayload.contentFacts.length, 0);
});
test('UX-18-05 style single ratchet evidence is withheld by default and only opt-in as an incomplete fact', () => {
  const f = fixture(); f.registry.compositions = [];
  f.registry.facts = f.registry.facts.filter(x => x.section !== 'contentClaims' || x.recordId === 'c1');
  const byDefault = build(input(f)).publicPayload;
  assert(!Object.hasOwn(byDefault, 'partialCompositionFacts')); assert.equal(byDefault.contentFacts.length, 0);
  const p = build(input(f, {includePartialCompositionFacts: true})).publicPayload;
  assert.equal(p.partialCompositionFacts.length, 1); assert.equal(p.partialCompositionFacts[0].partId, 'part1');
  assert.equal(p.partialCompositionFacts[0].compositionComplete, false); assert(!Object.hasOwn(p.partialCompositionFacts[0], 'groupId'));
  assert.equal(p.products[0].compositionComplete, false); assert.equal(p.options[0].compositionComplete, false);
  assert.equal(p.assemblyRelations.length, 0); assert.equal(p.contentFacts.length, 0);
});
test('no private raw fields, proof locators, dump, identity or research states leak', () => {
  const out = build(input(fixture())), json = JSON.stringify(out.publicPayload);
  for (const text of ['PRIVATE', 'reviewer', 'verified', 'publicationStatus', 'research', 'verificationStatus', 'variantId', 'rawDump', 'locator', 'Synthetic named table', 'bytesHash', 'diagnostics', 'policyVersion', 'not_published']) assert(!json.includes(text), text);
  assert.deepEqual(Object.keys(out.publicPayload), ['products', 'parts', 'options', 'assemblyRelations', 'contentFacts']);
});
test('all public foreign keys resolve within public payload', () => {
  const p = build(input(fixture())).publicPayload;
  for (const o of p.options) assert(p.products.some(x => x.productId === o.productId));
  for (const g of p.assemblyRelations) { assert(p.options.some(x => x.optionId === g.optionId)); assert(p.products.some(x => x.productId === g.productId)); }
  for (const c of p.contentFacts) { assert(p.assemblyRelations.some(x => x.groupId === c.groupId)); assert(p.parts.some(x => x.partId === c.partId)); }
});
test('build rejects unexpected publication options and legacy gate still denies production', () => {
  assert.throws(() => build({...input(fixture()), publish: true}), /UNKNOWN_BUILD_OPTION/);
  assert.throws(() => build({...input(fixture()), includePartialCompositionFacts: 'true'}), /PARTIAL_OPTION_INVALID/);
  assert.throws(() => assertIsolatedTarget({projectId: 'bxh-arena', emulatorHost: '127.0.0.1:8080', mode: 'emulator'}), /PRODUCTION_TARGET_FORBIDDEN/);
});


test('fixed options may be unnamed structural nodes supported by an explicit manifest', () => {
  const f = fixture(); delete f.batch.options[0].reportedOptionCode;
  f.registry.facts = f.registry.facts.filter(x => x.section !== 'options');
  for (const x of [...f.registry.facts, ...f.registry.compositions])
    for (const proof of x.proofs) proof.subject.optionCode = null;
  const p = build(input(f)).publicPayload;
  assert.equal(p.options.length, 1); assert(!Object.hasOwn(p.options[0], 'originalName'));
  assert(!Object.hasOwn(p.options[0], 'optionCode')); assert.equal(p.assemblyRelations.length, 1);
  assert.deepEqual(p.options[0].sourceUrls.optionId, [URL]);
});
test('complete manifests may produce unnamed assemblies without inventing a composite name', () => {
  const f = fixture(); f.registry.facts = f.registry.facts.filter(x => x.section !== 'assemblyClaims');
  const p = build(input(f)).publicPayload;
  assert.equal(p.assemblyRelations.length, 1); assert.equal(p.assemblyRelations[0].compositionComplete, true);
  assert(!Object.hasOwn(p.assemblyRelations[0], 'originalName')); assert.equal(p.contentFacts.length, 3);
});
test('group completeness never claims exhaustive product or option inventory', () => {
  const p = build(input(fixture())).publicPayload;
  assert.equal(p.assemblyRelations[0].compositionComplete, true);
  assert.equal(p.products[0].compositionComplete, false); assert.equal(p.options[0].compositionComplete, false);
});
test('IDs and hashes must be strings instead of coerced numeric or object values', () => {
  withChange(f => { f.batch.products[0].productId = 123; }, /RECORD_ID_INVALID/);
  withChange(f => { f.registry.sources[0].sourceId = 123; }, /SOURCE_OR_HASH_REQUIRED/);
  withChange(f => { f.registry.facts[0].recordId = 123; }, /RECORD_ID_INVALID/);
  withChange(f => { f.registry.sources[0].bytesHash = 123; }, /SOURCE_OR_HASH_REQUIRED/);
  const i = input(fixture()); i.trust.batchBytesHash = 123;
  assert.throws(() => build(i), /TRUST_PIN_REQUIRED/);
});
test('line must agree with the pinned model code and any known raw line', () => {
  withChange(f => { f.registry.facts.find(x => x.field === 'line').value = 'BX'; }, /VALUE_OR_IDENTITY_MISMATCH/);
  withChange(f => { f.batch.products[0].line = 'CX'; }, /VALUE_OR_IDENTITY_MISMATCH/);
});
test('full projection rejects credential-bearing paths on otherwise official hosts', () => {
  for (const path of ['/beyblade-x/token=abc123', '/api_key_abc123',
    '/password=abc123', '/auth;sessionid=abc123', '/user@example.com',
    '/token%3Dabc123', '/sessionid=abc123']) {
    withChange(f => { f.registry.sources[0].url = 'https://beyblade.takaratomy.co.jp' + path; }, /SOURCE_URL_PRIVATE/);
  }
});

test('numeric and string ID collisions cannot reuse another product evidence key', () => {
  const f = fixture();
  f.batch.products = [{productId: 123, productCode: 'UX-99'}, {productId: '123', productCode: 'BX-01'}];
  f.batch.options[0].productId = 123; f.batch.assemblyClaims[0].productId = 123;
  for (const c of f.batch.contentClaims) c.productId = 123;
  for (const x of [...f.registry.facts, ...f.registry.compositions]) {
    if (x.section === 'products') x.recordId = '123';
    for (const p of x.proofs) p.subject.productId = 123;
  }
  assert.throws(() => build(input(f)), /RECORD_ID_INVALID/);
});


test('full projection rejects session and access-token paths without relying on secret value spelling', () => {
  for (const path of ['/beyblade-x/page.html;jsessionid=abc123',
    '/beyblade-x/access_token/abc123', '/beyblade-x/access-token-abc123',
    '/beyblade-x/refresh_token/abc123', '/beyblade-x/id_token/abc123',
    '/beyblade-x/id-token=abc123', '/beyblade-x/%61ccess_token/abc123',
    '/.env', '/.env.local', '/.git/config', '/beyblade-x/.git/config']) {
    withChange(f => { f.registry.sources[0].url = 'https://beyblade.takaratomy.co.jp' + path; }, /SOURCE_URL_PRIVATE/);
  }
  const f = fixture();
  const jpPdf = 'https://www.takaratomy.co.jp/support/manual/items/4904810097167_%EF%BC%B5%EF%BC%B8.pdf';
  f.registry.sources[0].url = jpPdf;
  assert.deepEqual(build(input(f)).publicPayload.products[0].sourceUrls.originalName, [jpPdf]);
});
