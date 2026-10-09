'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {buildTw06ReviewQueue}=require('../modules/bey-catalog/catalog-tw06-review-queue.cjs');
const sections=['sources','products','parts','variants','colors','options','assemblyClaims','contentClaims','issues'];
function fixture(){
 const x={batchId:'DATA-01B-20261009-ZHTW-TW05',productionWritable:false,autoPublish:false,
 sources:[],products:[{productId:'product_000009',localizationStatus:'provisional_translation'}],
 parts:[{partId:'part_000034',localizationStatus:'taiwan_name_pending'}],
 variants:[{variantId:'variant_000010',localizationStatus:'product_source_verified_color_pending',colorPhysicalVerification:'pending'}],
 colors:[],options:[],assemblyClaims:[
  {groupId:'group_000007',verificationStatus:'supplier_pending',requiresManufacturerCompositionReview:true},
  {groupId:'group_000014',localizationStatus:'needs_original_kit_recheck'}],
 contentClaims:[],issues:[]};
 while(sections.reduce((n,s)=>n+x[s].length,0)<197)x.issues.push({issueId:'issue_'+x.issues.length});
 return x;
}
test('queue derives pending evidence without marking any item approved',()=>{
 const a=fixture(),snapshot=JSON.stringify(a),q=buildTw06ReviewQueue(a);
 assert.equal(q.summary.total,6);
 assert.deepEqual([q.summary.P0,q.summary.P1,q.summary.P2],[2,3,1]);
 assert(q.items.every(i=>i.reviewState==='pending'&&!i.evidenceVerified&&!i.canAutoPublish));
 assert.equal(q.items[0].priority,'P0');
 assert.equal(JSON.stringify(a),snapshot);
});
test('queue identifiers are deterministic, unique and keyed by record and issue',()=>{
 const a=buildTw06ReviewQueue(fixture()),b=buildTw06ReviewQueue(fixture());
 assert.deepEqual(a,b);
 assert.equal(new Set(a.items.map(x=>x.queueId)).size,a.items.length);
 const v=a.items.filter(x=>x.recordId==='variant_000010');
 assert.equal(v.length,2);
 assert.notEqual(v[0].queueId,v[1].queueId);
});
test('production, wrong revision and incomplete batch are rejected',()=>{
 const a=fixture();a.productionWritable=true;assert.throws(()=>buildTw06ReviewQueue(a),/TW06_QUEUE_RESEARCH_REQUIRED/);
 const b=fixture();b.batchId='DATA-01B-20261009';assert.throws(()=>buildTw06ReviewQueue(b),/TW06_QUEUE_RESEARCH_REQUIRED/);
 const c=fixture();c.issues=[];assert.throws(()=>buildTw06ReviewQueue(c),/TW06_QUEUE_EXPECTED_197/);
});
