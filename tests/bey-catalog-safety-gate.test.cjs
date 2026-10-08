'use strict';
const test=require('node:test'); const assert=require('node:assert/strict');
const {assertIsolatedTarget,inspectResearchBatch,allowedCollections}=require('../modules/bey-catalog/safety-gate.cjs');
const valid={projectId:'demo-bxh-catalog-db01',emulatorHost:'127.0.0.1:8080',mode:'emulator'};
test('accepts only local emulator demo target',()=>{assert.equal(assertIsolatedTarget(valid).mode,'emulator');assert.equal(assertIsolatedTarget({...valid,emulatorHost:'localhost:8080'}).mode,'emulator');});
test('rejects production even when emulator host exists',()=>assert.throws(()=>assertIsolatedTarget({...valid,projectId:'bxh-arena'}),/PRODUCTION/));
test('rejects non-local, missing emulator, or non-demo targets',()=>{for(const x of [{...valid,emulatorHost:'10.0.0.1:8080'},{...valid,emulatorHost:undefined},{...valid,projectId:'bxh-catalog-staging'},{...valid,mode:'cloud'}])assert.throws(()=>assertIsolatedTarget(x));});
test('rejects unsafe dataset flags',()=>{const d={dataOrigin:'source-tiered-research',productionWritable:false,autoPublish:false,sources:[{sourceId:'a',url:'https://example.org',automatedAccess:'not_enabled'}]};assert.equal(inspectResearchBatch(d).mode,'DRY_RUN_ONLY');for(const x of [{...d,productionWritable:true},{...d,autoPublish:true},{...d,sources:[{sourceId:'a',url:'https://example.org',automatedAccess:'enabled'}]}])assert.throws(()=>inspectResearchBatch(x));});
test('does not expose player or match collections',()=>{assert(!allowedCollections.some(x=>/player|match|tournament|score/i.test(x)));});
