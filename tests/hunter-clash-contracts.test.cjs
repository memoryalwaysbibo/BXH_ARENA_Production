'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const hc = require('../hunter-clash/contracts.cjs');
const actor = { uid: 'staff-1', active: true, role: 'staff' };
const config = { schemaVersion: 1, enabled: true, audience: 'internal', environment: 'sandbox' };
const runtime = { environment: 'sandbox', backendReady: true };
test('entry fails closed for missing settings, backend, account or environment', () => {
  for (const [c, a, r] of [[null, actor, runtime], [config, actor, null],
    [config, actor, {...runtime, backendReady:false}], [config, null, runtime],
    [config, actor, {...runtime, environment:'production'}]])
    assert.equal(hc.entryDecision(c,a,r).allowed,false);
});
test('internal access checks every role and disabled account', () => {
  for (const role of ['staff','admin','super_admin'])
    assert.equal(hc.entryDecision(config,{...actor,role},runtime).allowed,true);
  for (const role of ['player','guest','tester',undefined])
    assert.equal(hc.entryDecision(config,{...actor,role},runtime).allowed,false);
  for (const patch of [{active:false},{deleted:true},{accountStatus:'frozen'}, {uid:''}])
    assert.equal(hc.entryDecision(config,{...actor,...patch},runtime).allowed,false);
});
test('public audience cannot be enabled through this foundation', () => {
  assert.equal(hc.entryDecision({...config,audience:'public'},actor,runtime).allowed,false);
});
test('production excludes test accounts even with privileged role', () => {
  assert.equal(hc.entryDecision({...config,environment:'production'},
    {...actor,isTestAccount:true},{...runtime,environment:'production'}).allowed,false);
});
test('stale revisions and skipped verification reject transitions', () => {
  assert.equal(hc.assertTransition('proposed','accepted',0,0),1);
  assert.throws(()=>hc.assertTransition('proposed','accepted',1,0),/revision-conflict/);
  assert.throws(()=>hc.assertTransition('submitted','settled',0,0),/invalid-transition/);
  for (const terminal of ['settled','voided','expired','cancelled'])
    assert.throws(()=>hc.assertTransition(terminal,'proposed',0,0),/invalid-transition/);
  assert.throws(()=>hc.assertTransition('toString','verified',0,0),/invalid-transition/);
  assert.throws(()=>hc.assertTransition('verified','settled',-1,-1),/invalid-revision/);
});
test('idempotency keys isolate environment, result revision and tuple boundaries', () => {
  const input={environment:'sandbox',challengeId:'a:b',resultRevision:1,beneficiaryId:'c',effectType:'xp'};
  const key=hc.settlementKey(input);
  assert.equal(key,hc.settlementKey({...input}));
  for (const patch of [{environment:'production'},{resultRevision:2},{challengeId:'a',beneficiaryId:'b:c'}])
    assert.notEqual(key,hc.settlementKey({...input,...patch}));
});
test('settlement rejects unverified, risky and cross-environment records', () => {
  const r={environment:'sandbox',status:'verified',verificationStatus:'verified',riskStatus:'clear',resultRevision:1};
  assert.equal(hc.assertSettlement(r,'sandbox'),true);
  for (const patch of [{status:'submitted'},{verificationStatus:'pending'},{riskStatus:'hold'},{environment:'production'}])
    assert.throws(()=>hc.assertSettlement({...r,...patch},'sandbox'));
});
test('public projection drops private identities and risk evidence', () => {
  const p=hc.publicResult({challengeId:'c1',uid:'private',email:'private',participants:['secret'],
    riskDetails:{ip:'secret'},attestations:['secret']});
  assert.equal(p.challengeId,'c1');
  for (const k of ['uid','email','participants','riskDetails','attestations']) assert.equal(Object.hasOwn(p,k),false);
});
test('release requires explicit PASS for every critical check', () => {
  const empty=hc.releaseDecision(null); assert.equal(empty.allowed,false);
  const evidence=Object.fromEntries(empty.blockers.map(k=>[k,'PASS']));
  assert.equal(hc.releaseDecision(evidence).allowed,true);
  for (const value of ['FAIL','BLOCKED','NOT RUN',true,undefined])
    assert.equal(hc.releaseDecision({...evidence,backendAuthorization:value}).allowed,false);
});
