'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {planStaging,applyEmulatorStaging}=require('../modules/bey-catalog/catalog-staging.cjs');
function batch(){return {batchId:'DATA-TEST-01',dataOrigin:'source-tiered-research',productionWritable:false,autoPublish:false,
sources:[{sourceId:'official-a',url:'https://example.org/product',automatedAccess:'not_enabled'}],
products:[{productId:'product-a',sourceId:'official-a'}],
parts:[{partId:'part-a'},{partId:'part-b'}],
variants:[{variantId:'variant-a',partId:'part-a'}],
colors:[{colorId:'black'}],
options:[{optionId:'option-a',productId:'product-a'}],
assemblyClaims:[{groupId:'group-a',productId:'product-a',optionId:'option-a'}],
contentClaims:[{contentClaimId:'content-a',productId:'product-a',optionId:'option-a',groupId:'group-a',partId:'part-a',variantId:'variant-a'}],
issues:[{issueId:'issue-a',productId:'product-a'}]};}
const target={mode:'emulator',projectId:'demo-bxh-catalog-db01',emulatorHost:'127.0.0.1:8080',readOnlyProduction:true};
test('research batch is deterministic and unpublished',()=>{const a=planStaging(batch()),b=planStaging(batch());assert.equal(a.recordCount,10);assert.deepEqual(a.records.map(x=>x.sha256),b.records.map(x=>x.sha256));assert.equal(a.autoPublish,false);});
test('missing references and wrong variant/part combinations are blocked',()=>{const a=batch();a.variants[0].partId='unknown';assert.throws(()=>planStaging(a),/VARIANT_PART_MISSING/);const b=batch();b.contentClaims[0].partId='part-b';assert.throws(()=>planStaging(b),/VARIANT_PART_MISMATCH/);});
test('duplicate IDs and unapproved source are blocked',()=>{const a=batch();a.parts.push({partId:'part-a'});assert.throws(()=>planStaging(a),/DUPLICATE_ID/);const b=batch();b.sources[0].automatedAccess='enabled';assert.throws(()=>planStaging(b),/UNAPPROVED_SOURCE/);});
test('staging is idempotent and conflict preserving',async()=>{const store=new Map(),adapter={emulatorOnly:true,get:async(c,id)=>store.get(c+'/'+id),put:async(c,id,v)=>store.set(c+'/'+id,v)};const p=planStaging(batch());assert.equal((await applyEmulatorStaging(p,adapter,target)).inserted,10);assert.equal((await applyEmulatorStaging(p,adapter,target)).unchanged,10);store.set('beyProducts/product-a',{sha256:'changed'});const r=await applyEmulatorStaging(p,adapter,target);assert.equal(r.conflicts,1);assert.equal(r.deleted,0);assert.equal(r.published,0);});
test('production, remote and unverified adapters are refused',async()=>{const p=planStaging(batch()),a={emulatorOnly:true,get:async()=>null,put:async()=>{throw Error('SHOULD_NOT_WRITE')}};await assert.rejects(()=>applyEmulatorStaging(p,a,{...target,projectId:'bxh-arena'}),/PRODUCTION/);await assert.rejects(()=>applyEmulatorStaging(p,a,{...target,emulatorHost:'remote:8080'}),/LOCAL_EMULATOR/);await assert.rejects(()=>applyEmulatorStaging(p,{...a,emulatorOnly:false},target),/EMULATOR_ADAPTER_REQUIRED/);});
