'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { assertSandboxRuntime } = require('../hunter-clash/server/runtime-boundary.cjs');
const { buildBundle } = require('../hunter-clash/prepare-cloud-test-bundle.cjs');
const project = 'bxh-hc-test';
const handles = id => ({ db: { projectId: id }, auth: { app: { options: { projectId: id } } } });
test('runtime boundary accepts only exact demo emulator or dedicated cloud test projects', () => {
  const demo = handles('demo-hunter-clash');
  assert.equal(assertSandboxRuntime(demo.db,demo.auth,{FUNCTIONS_EMULATOR:'true',FIRESTORE_EMULATOR_HOST:'127.0.0.1:8180',FIREBASE_AUTH_EMULATOR_HOST:'127.0.0.1:9098'}).mode,'emulator');
  const cloud = handles(project);
  assert.equal(assertSandboxRuntime(cloud.db,cloud.auth,{HC_RUNTIME_MODE:'isolated-cloud-test'},project).mode,'isolated-cloud-test');
  for (const id of ['bxh-arena','bxh-arena-beta','demo-hunter-clash','random-project','bxh-hc-test-other']) {
    const h=handles(id); assert.throws(()=>assertSandboxRuntime(h.db,h.auth,{HC_RUNTIME_MODE:'isolated-cloud-test'},id));
  }
  assert.throws(()=>assertSandboxRuntime(cloud.db,cloud.auth,{HC_RUNTIME_MODE:'isolated-cloud-test',FIRESTORE_EMULATOR_HOST:'127.0.0.1:8180'},project));
  assert.throws(()=>assertSandboxRuntime(cloud.db,cloud.auth,{HC_RUNTIME_MODE:'isolated-cloud-test'},'bxh-hc-test-other'));
});
test('bundle is deterministic, immutable-source identified, App Check enforced and not authorized to deploy', () => {
  const parent=fs.mkdtempSync(path.join(os.tmpdir(),'hc-bundle-test-'));
  const output=path.join(parent,'hc-cloud-test-candidate');
  try {
    const manifest=buildBundle({projectId:project,sourceCommit:'a'.repeat(40),output});
    assert.equal(manifest.deploymentAuthorized,false); assert.equal(manifest.productionDataAllowed,false);
    assert.equal(manifest.publicEntryEnabled,false); assert.equal(manifest.appCheckEnforced,true);
    assert.equal(manifest.sourceCommit,'a'.repeat(40)); assert.match(manifest.treeSha256,/^[a-f0-9]{64}$/);
    const entry=fs.readFileSync(path.join(output,'functions.cjs'),'utf8');
    assert.match(entry,/enforceAppCheck:true/); assert.match(entry,/invoker:'private'/); assert(entry.includes(`const PROJECT="${project}"`));
    const firebase=JSON.parse(fs.readFileSync(path.join(output,'firebase.json'),'utf8'));
    assert.equal(firebase.functions.codebase,'hc-isolated-test'); assert.equal(firebase.firestore.rules,'firestore.rules');
    assert.throws(()=>buildBundle({projectId:project,sourceCommit:'a'.repeat(40),output}),/output-already-exists/);
  } finally { fs.rmSync(parent,{recursive:true,force:true}); }
});
test('bundle builder rejects Production, Beta, demo, arbitrary projects and mutable source refs', () => {
  for(const id of ['bxh-arena','bxh-arena-beta','demo-hunter-clash','random-project','bxh-hc-test-other'])
    assert.throws(()=>buildBundle({projectId:id,sourceCommit:'a'.repeat(40),output:'/tmp/hc-cloud-test-invalid'}),/invalid-cloud-test-project/);
  assert.throws(()=>buildBundle({projectId:project,sourceCommit:'main',output:'/tmp/hc-cloud-test-invalid'}),/invalid-source-commit/);
});
