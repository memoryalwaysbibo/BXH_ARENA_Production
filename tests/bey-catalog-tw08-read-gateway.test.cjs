'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {readTaiwanReviewQueue}=require('../modules/bey-catalog/catalog-tw08-read-gateway.cjs');
const SECTIONS=['sources','products','parts','variants','colors','options','assemblyClaims','contentClaims','issues'];
function fixture(){
 const batch={batchId:'DATA-01B-20261009-ZHTW-TW05',productionWritable:false,autoPublish:false,
 sources:[],products:[{productId:'product_000009',localizationStatus:'provisional_translation'}],
 parts:[],variants:[],colors:[],options:[],assemblyClaims:[],contentClaims:[],issues:[]};
 for(let i=1;i<=11;i++)batch.parts.push({partId:'part_'+String(i).padStart(6,'0'),
  ...(i<=3?{localizationStatus:'taiwan_name_pending'}:{verificationStatus:'supplier_pending'})});
 for(let i=1;i<=5;i++)batch.assemblyClaims.push({groupId:'group_'+String(i).padStart(6,'0'),
  verificationStatus:'supplier_pending',...(i<=2?{localizationStatus:'taiwan_name_pending_supplier_source'}:{})});
 for(let i=1;i<=11;i++)batch.variants.push({variantId:'variant_'+String(i).padStart(6,'0'),
  colorPhysicalVerification:'pending',...(i===10?{localizationStatus:'product_source_verified_color_pending'}:{})});
 while(SECTIONS.reduce((n,s)=>n+batch[s].length,0)<197)batch.issues.push({issueId:'issue_'+batch.issues.length});
 return batch;
}
function adapter({role='admin',active=true,testAccount=false,batch=fixture(),failToken=false}={}){
 const counts={users:0,batches:0,verifies:0};
 return {counts,
  verifyIdToken:async(token,checkRevoked)=>{counts.verifies++;assert.equal(checkRevoked,true);if(failToken)throw Error('REVOKED_TOKEN');return {uid:token==='anonymous'?'anonymous_1':'admin_1',firebase:{sign_in_provider:token==='anonymous'?'anonymous':'password'}};},
  loadUserByUid:async()=>{counts.users++;return {role,active,isTestAccount:testAccount};},
  loadResearchBatch:async()=>{counts.batches++;return batch;}
 };
}
test('real 197-entity queue generates 31 items and paginates 10/10/10/1',async()=>{
 const a=adapter(),seen=[],sizes=[];let cursor=null;
 do{
  const result=await readTaiwanReviewQueue({adapter:a,idToken:'verified-token',request:{cursor,limit:10}});
  assert.equal(result.access,'preview');assert.equal(result.canPublish,false);assert.equal(result.canApprove,false);
  assert.deepEqual(result.summary,{total:31,P0:5,P1:15,P2:11,visible:31});
  sizes.push(result.items.length);seen.push(...result.items.map(x=>x.queueId));cursor=result.nextCursor;
 }while(cursor);
 assert.deepEqual(sizes,[10,10,10,1]);
 assert.equal(new Set(seen).size,31);
 assert.equal(a.counts.batches,4);
});
test('priority and search filters work with bounded responses',async()=>{
 const a=adapter();
 const p0=await readTaiwanReviewQueue({adapter:a,idToken:'verified-token',request:{filter:'P0',limit:20}});
 assert.equal(p0.items.length,5);assert(p0.items.every(x=>x.priority==='P0'));
 const q=await readTaiwanReviewQueue({adapter:a,idToken:'verified-token',request:{query:'variant_000010'}});
 assert.equal(q.items.length,2);assert(q.items.every(x=>x.recordId==='variant_000010'));
});
test('player, disabled admin and test account denied before research batch load',async()=>{
 for(const config of [{role:'player'},{active:false},{testAccount:true},{role:'staff'}]){
  const a=adapter(config),result=await readTaiwanReviewQueue({adapter:a,idToken:'verified-token'});
  assert.equal(result.access,'denied');assert.equal(result.items.length,0);
  assert.equal(a.counts.batches,0);
 }
});
test('anonymous and revoked token cannot access the queue',async()=>{
 const a=adapter();assert.equal((await readTaiwanReviewQueue({adapter:a,idToken:'anonymous'})).access,'denied');
 assert.equal(a.counts.users,0);assert.equal(a.counts.batches,0);
 await assert.rejects(()=>readTaiwanReviewQueue({adapter:adapter({failToken:true}),idToken:'bad'}),/REVOKED_TOKEN/);
});
test('stale or forged pagination cursor is rejected',async()=>{
 const a=adapter();
 const first=await readTaiwanReviewQueue({adapter:a,idToken:'verified-token',request:{limit:5}});
 await assert.rejects(()=>readTaiwanReviewQueue({adapter:a,idToken:'verified-token',request:{filter:'P1',cursor:first.nextCursor}}),/TW08_STALE_OR_INVALID_CURSOR/);
 await assert.rejects(()=>readTaiwanReviewQueue({adapter:a,idToken:'verified-token',request:{cursor:'tw08:forged:10'}}),/TW08_STALE_OR_INVALID_CURSOR/);
 a.loadResearchBatch=async()=>{const b=fixture();b.parts[0].localizationStatus='confirmed';return b;};
 await assert.rejects(()=>readTaiwanReviewQueue({adapter:a,idToken:'verified-token',request:{cursor:first.nextCursor}}),/TW08_STALE_OR_INVALID_CURSOR/);
});
test('invalid request, client dataset injection and unsafe batch fail closed',async()=>{
 const a=adapter();
 for(const request of [{limit:21},{limit:0},{limit:'10'},{filter:'published'},{query:'x'.repeat(81)}]){
  await assert.rejects(()=>readTaiwanReviewQueue({adapter:a,idToken:'verified-token',request}),/TW08_REQUEST_INVALID/);
 }
 const bad=adapter({batch:{...fixture(),productionWritable:true}});
 await assert.rejects(()=>readTaiwanReviewQueue({adapter:bad,idToken:'verified-token',request:{batch:fixture()}}),/TW06_QUEUE_RESEARCH_REQUIRED/);
 await assert.rejects(()=>readTaiwanReviewQueue({adapter:{},idToken:'verified-token'}),/TW08_TRUSTED_BACKEND_ADAPTER_REQUIRED/);
});
